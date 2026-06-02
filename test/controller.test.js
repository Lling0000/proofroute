import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { demoCatalog } from '../src/config.js';
import { classifyIntent, stableSoftmax } from '../src/controller/intent.js';
import { NoRouteError, RouteController } from '../src/controller/route-controller.js';
import { renderDecision, renderRouteMarkdown, renderRouteTrace } from '../src/view/terminal.js';

test('stableSoftmax remains finite for extreme logits', () => {
  const probabilities = stableSoftmax([10000, 9999, -10000], 0.1);
  assert.equal(probabilities.length, 3);
  assert.ok(probabilities.every(Number.isFinite));
  assert.ok(Math.abs(probabilities.reduce((total, value) => total + value, 0) - 1) < 1e-12);
  assert.ok(probabilities[0] > probabilities[1]);
});

test('intent classifier recognizes code-heavy prompts', () => {
  const intent = classifyIntent('Refactor this TypeScript function, fix the stacktrace, and add a regression test. ```ts const x = 1 ```');
  assert.equal(intent.name, 'code');
  assert.ok(intent.confidence > 0.5);
  assert.ok(intent.features.hasCodeFence);
});

test('intent classifier normalizes plural reasoning vocabulary', () => {
  const intent = classifyIntent('Compare these routing algorithms and explain the cost, latency, and quality tradeoffs.');
  assert.equal(intent.name, 'reasoning');
});

test('route controller returns a complete economic decision', () => {
  const controller = new RouteController(demoCatalog());
  const decision = controller.route({ prompt: 'Write a focused SQL migration test and explain the production bug.' });
  assert.ok(decision.model.id);
  assert.ok(decision.ranked.length > 0);
  assert.ok(decision.economics.savingsUsd >= 0);
  assert.ok(decision.performance.estimatedLatencyMs > 0);
  assert.equal(typeof decision.ranked[0].logit, 'number');
  assert.equal(typeof decision.ranked[0].components.quality, 'number');
  assert.equal(typeof decision.ranked[0].components.cost, 'number');
  assert.equal(typeof decision.ranked[0].components.latency, 'number');
  assert.equal(typeof decision.ranked[0].contextWindow, 'number');
  const output = renderDecision(decision);
  assert.match(output, /balanced/);
  assert.match(output, /policy/);
  assert.match(output, /decision receipt/);
  assert.match(output, /cost fit/);
  assert.match(output, /speed fit/);
  assert.match(output, /context/);
  assert.doesNotMatch(output, /NaN|Infinity/);
});

test('route trace renders scoring contributions for the winning model', () => {
  const controller = new RouteController(demoCatalog());
  const decision = controller.route({ prompt: 'Write a focused SQL migration test and explain the production bug.' });
  const output = renderRouteTrace(decision);
  assert.match(output, /ROUTING TRACE/);
  assert.match(output, /decision receipt/);
  assert.match(output, /cost fit/);
  assert.match(output, /speed fit/);
  assert.match(output, /context/);
  assert.match(output, /quality/);
  assert.match(output, /latency/);
  assert.match(output, /balanced/);
  assert.match(output, /single-prompt proof/);
  assert.match(output, /provider calls 0/);
  assert.match(output, /classifier builtin/);
  assert.match(output, /prompt text not printed/);
  assert.match(output, /copy line/);
  assert.doesNotMatch(output, /NaN|Infinity/);
  assert.doesNotMatch(output, /Write a focused SQL migration test|production bug/);
});

test('route markdown renders a prompt-free single-prompt receipt', () => {
  const controller = new RouteController(demoCatalog());
  const decision = controller.route({ prompt: 'secret production prompt: refactor webhook and explain the incident.' });
  const output = renderRouteMarkdown(decision);
  assert.match(output, /single-prompt routing receipt/);
  assert.match(output, /Decision receipt:/);
  assert.match(output, /provider calls were 0/);
  assert.match(output, /Prompt text was not printed|prompt text was not printed/);
  assert.match(output, /Stable Softmax/);
  assert.doesNotMatch(output, /\x1b\[/);
  assert.doesNotMatch(output, /secret production prompt|refactor webhook|incident/);
});

test('route command can emit markdown trace without leaking prompt text', () => {
  const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'route', '--trace', '--markdown', '--prompt', 'secret production prompt: refactor webhook and explain the incident.'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 2000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /single-prompt routing receipt/);
  assert.match(result.stdout, /Decision receipt:/);
  assert.match(result.stdout, /provider calls 0/);
  assert.doesNotMatch(result.stdout, /\x1b\[/);
  assert.doesNotMatch(result.stdout, /secret production prompt|refactor webhook|incident/);
});

test('route controller records models rejected by context window gates', () => {
  const controller = new RouteController({
    providers: {
      local: {
        baseUrl: 'http://127.0.0.1:11434',
        kind: 'ollama'
      }
    },
    models: [
      contextModel('tiny-local', 512, 0.9),
      contextModel('roomy-local', 4096, 0.8)
    ]
  });
  const decision = controller.route({ prompt: 'Audit this long migration plan.', tokens: 1200 });
  assert.equal(decision.model.id, 'roomy-local');
  assert.equal(decision.rejected.length, 1);
  assert.equal(decision.rejected[0].model, 'tiny-local');
  assert.equal(decision.rejected[0].reason, 'context_window');
  assert.equal(decision.rejected[0].requiredTokens, 1620);
  const output = renderRouteTrace(decision);
  assert.match(output, /filtered model/);
  assert.match(output, /context_window/);
});

test('route controller respects explicit output token budgets for context fit', () => {
  const controller = new RouteController({
    providers: {
      local: {
        baseUrl: 'http://127.0.0.1:11434',
        kind: 'ollama'
      }
    },
    models: [
      contextModel('precise-small', 1200, 0.95),
      contextModel('roomy-large', 4096, 0.6)
    ]
  });
  const defaultBudget = controller.route({ prompt: 'Audit this migration plan.', tokens: 1000 });
  const explicitBudget = controller.route({ prompt: 'Audit this migration plan.', tokens: 1000, outputTokens: 100 });
  assert.equal(defaultBudget.outputTokens, 350);
  assert.equal(defaultBudget.model.id, 'roomy-large');
  assert.equal(defaultBudget.rejected[0].model, 'precise-small');
  assert.equal(explicitBudget.outputTokens, 100);
  assert.equal(explicitBudget.model.id, 'precise-small');
  assert.equal(explicitBudget.rejected.length, 0);
});

test('route controller records models rejected by max cost budget', () => {
  const controller = new RouteController({
    providers: {
      openai: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key'
      }
    },
    models: [
      budgetModel('premium', 0.95, 50, 100),
      budgetModel('frugal', 0.6, 0.1, 0.2)
    ]
  });
  const decision = controller.route({ prompt: 'Explain this simple request.', tokens: 1000, outputTokens: 1000, maxCostUsd: 0.001 });
  assert.equal(decision.model.id, 'frugal');
  assert.equal(decision.rejected.length, 1);
  assert.equal(decision.rejected[0].model, 'premium');
  assert.equal(decision.rejected[0].reason, 'cost_budget');
  assert.equal(decision.rejected[0].maxCostUsd, 0.001);
  assert.ok(decision.rejected[0].estimatedCostUsd > 0.001);
  const output = renderRouteTrace(decision);
  assert.match(output, /cost_budget/);
});

test('route controller records models rejected by max latency budget', () => {
  const controller = new RouteController({
    providers: {
      openai: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key'
      }
    },
    models: [
      latencyModel('slow-premium', 0.95, 5000),
      latencyModel('fast-frugal', 0.6, 25)
    ]
  });
  const decision = controller.route({ prompt: 'Explain this simple request.', tokens: 100, outputTokens: 100, maxLatencyMs: 1500 });
  assert.equal(decision.model.id, 'fast-frugal');
  assert.equal(decision.rejected.length, 1);
  assert.equal(decision.rejected[0].model, 'slow-premium');
  assert.equal(decision.rejected[0].reason, 'latency_budget');
  assert.equal(decision.rejected[0].maxLatencyMs, 1500);
  assert.ok(decision.rejected[0].estimatedLatencyMs > 1500);
  const output = renderRouteTrace(decision);
  assert.match(output, /latency_budget/);
});

test('route controller throws structured evidence when every model is rejected', () => {
  const controller = new RouteController({
    providers: {
      openai: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key'
      }
    },
    models: [
      budgetModel('premium', 0.95, 50, 100),
      budgetModel('frugal', 0.6, 0.1, 0.2)
    ]
  });
  assert.throws(() => {
    controller.route({ prompt: 'Explain this simple request.', tokens: 1000, outputTokens: 1000, maxCostUsd: 0 });
  }, (error) => {
    assert.ok(error instanceof NoRouteError);
    assert.equal(error.code, 'no_route');
    assert.equal(error.status, 422);
    assert.equal(error.details.rejected.length, 2);
    assert.ok(error.details.rejected.every((entry) => entry.reason === 'cost_budget'));
    assert.equal(error.details.maxCostUsd, 0);
    return true;
  });
});

function contextModel(id, contextWindow, quality) {
  return {
    id,
    provider: 'local',
    endpoint: '/api/chat',
    local: true,
    contextWindow,
    inputUsdPer1M: 0,
    outputUsdPer1M: 0,
    medianLatencyMs: 100,
    throughputTokensPerSecond: 100,
    quality: {
      chat: quality,
      code: quality,
      reasoning: quality,
      writing: quality,
      extraction: quality,
      long_context: quality
    }
  };
}

function budgetModel(id, quality, inputUsdPer1M, outputUsdPer1M) {
  return {
    id,
    provider: 'openai',
    endpoint: '/chat/completions',
    local: false,
    contextWindow: 8192,
    inputUsdPer1M,
    outputUsdPer1M,
    medianLatencyMs: 100,
    throughputTokensPerSecond: 100,
    quality: {
      chat: quality,
      code: quality,
      reasoning: quality,
      writing: quality,
      extraction: quality,
      long_context: quality
    }
  };
}

function latencyModel(id, quality, medianLatencyMs) {
  return {
    id,
    provider: 'openai',
    endpoint: '/chat/completions',
    local: false,
    contextWindow: 8192,
    inputUsdPer1M: 0.1,
    outputUsdPer1M: 0.2,
    medianLatencyMs,
    throughputTokensPerSecond: 100,
    quality: {
      chat: quality,
      code: quality,
      reasoning: quality,
      writing: quality,
      extraction: quality,
      long_context: quality
    }
  };
}
