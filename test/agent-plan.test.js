import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AgentRuntime } from '../src/agent/runtime.js';
import { demoCatalog } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';
import { renderAgentExecution } from '../src/view/terminal.js';

test('agent planner creates parallel assignments with aggregate economics', async () => {
  const config = demoCatalog();
  const runtime = new AgentRuntime(config);
  const controller = new RouteController(config);
  const plan = await runtime.planAgents({
    prompt: 'Ship the proxy, review the code, and rewrite the README for launch.',
    controller
  });
  assert.ok(plan.assignments.length >= 4);
  assert.ok(plan.assignments.every((assignment) => assignment.model));
  assert.ok(plan.aggregate.criticalPathMs > 0);
  assert.ok(plan.aggregate.savingsUsd >= 0);
});

test('agent runtime executes fanout roles concurrently through providers', async () => {
  const upstream = await startFanoutProvider();
  try {
    const config = fanoutConfig(upstream.url);
    const runtime = new AgentRuntime(config);
    const controller = new RouteController(config);
    const report = await runtime.executeAgentPlan({
      prompt: 'Ship the proxy, review the code, and rewrite the README for launch.',
      controller,
      maxTokens: 32
    });
    assert.equal(report.status, 'pass');
    assert.ok(report.assignments.length >= 4);
    assert.ok(report.assignments.every((assignment) => assignment.status === 200));
    assert.ok(report.aggregate.actualTokens > 0);
    assert.ok(upstream.maxInflight() > 1);
    const output = renderAgentExecution(report);
    assert.match(output, /AGENT EXECUTION/);
    assert.match(output, /actual tokens/);
  } finally {
    await upstream.close();
  }
});

test('agent fanout batches executable routing before provider dispatch', async () => {
  const upstream = await startFanoutProvider();
  try {
    const batches = [];
    const classifier = {
      async classifyMany(prompts) {
        batches.push(prompts);
        return prompts.map(() => ({
          name: 'code',
          confidence: 0.99,
          ranked: [],
          features: { backend: 'fanout-batch' }
        }));
      },
      classify() {
        throw new Error('sync classifier should not run');
      }
    };
    const config = fanoutConfig(upstream.url);
    const runtime = new AgentRuntime(config);
    const controller = new RouteController(config, classifier);
    const report = await runtime.executeAgentPlan({
      prompt: 'Ship the proxy, review the code, and keep the implementation tight.',
      controller,
      maxTokens: 32
    });
    assert.equal(report.status, 'pass');
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, report.assignments.length);
    assert.ok(upstream.maxInflight() > 1);
  } finally {
    await upstream.close();
  }
});

function startFanoutProvider() {
  const requests = [];
  let inflight = 0;
  let maxInflight = 0;
  const server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    requests.push(body);
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((resolve) => setTimeout(resolve, 25));
    inflight -= 1;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: `chatcmpl-${requests.length}`,
      object: 'chat.completion',
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `fanout ok ${requests.length} via ${body.model}`
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14
      }
    }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        maxInflight: () => maxInflight,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function fanoutConfig(baseUrl) {
  return {
    providers: {
      fanout: {
        baseUrl,
        apiKey: 'fanout-key'
      }
    },
    models: [
      {
        id: 'fanout-fast',
        provider: 'fanout',
        endpoint: '/chat/completions',
        local: false,
        contextWindow: 128000,
        inputUsdPer1M: 0.2,
        outputUsdPer1M: 0.4,
        medianLatencyMs: 80,
        throughputTokensPerSecond: 200,
        quality: {
          code: 0.9,
          reasoning: 0.9,
          writing: 0.9,
          extraction: 0.9,
          chat: 0.9,
          long_context: 0.9
        }
      }
    ]
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
