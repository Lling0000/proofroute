import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privacyReport } from './privacy.js';
import { startProxy } from './proxy.js';
import { AgentRuntime } from './runtime.js';
import { readRouteEvents } from './telemetry.js';
import { RouteController } from '../controller/route-controller.js';

export async function runSmokeTest({ prompt = 'Refactor this webhook and explain the cheapest safe model choice.', policy, throughProxy = false, matrix = false } = {}) {
  if (matrix) return runProxySmokeMatrixTest();
  if (throughProxy) return runProxySmokeTest({ prompt, policy });
  return runRuntimeSmokeTest({ prompt, policy });
}

async function runRuntimeSmokeTest({ prompt, policy }) {
  const upstream = await fakeOpenAIProvider();
  try {
    const config = smokeConfig(upstream.url);
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const routeStartedAt = performance.now();
    const decision = await controller.routeAsync({ prompt, executableOnly: true, policy });
    const routerDecisionMs = Math.max(0.01, performance.now() - routeStartedAt);
    const executeStartedAt = performance.now();
    const upstreamResponse = await runtime.executeRoutedChatCompletion({
      decision,
      body: {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 96
      }
    });
    const executionMs = Math.max(0.01, performance.now() - executeStartedAt);
    const payload = JSON.parse(Buffer.from(upstreamResponse.body).toString('utf8'));
    const content = payload.choices?.[0]?.message?.content ?? '';
    const ok = upstreamResponse.status >= 200 && upstreamResponse.status < 300 && upstream.requests.length === 1 && upstream.requests[0].model === decision.model.id;
    return {
      status: ok ? 'pass' : 'fail',
      mode: 'runtime',
      prompt,
      decision,
      routerDecisionMs,
      executionMs,
      upstream: {
        url: upstream.url,
        requests: upstream.requests
      },
      response: {
        status: upstreamResponse.status,
        content
      }
    };
  } finally {
    await upstream.close();
  }
}

async function runProxySmokeTest({ prompt, policy }) {
  const upstream = await fakeOpenAIProvider();
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-smoke-'));
  let proxy;
  try {
    const ledger = join(dir, 'events.jsonl');
    const config = smokeConfig(upstream.url, ledger);
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    let routed;
    proxy = await startProxy({
      config,
      controller,
      runtime,
      port: 0,
      telemetryOverride: ledger,
      onRoute: (route) => {
        routed = route;
      }
    });
    const preflight = await fetch(`${proxy.origin}/v1/chat/completions`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://editor.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-proofroute-policy,x-proofroute-max-cost-usd'
      }
    });
    const executeStartedAt = performance.now();
    const response = await fetch(`${proxy.origin}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer smoke-client'
      },
      body: JSON.stringify({
        model: 'smoke-premium',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 96,
        metadata: policy ? { proofroute_policy: policy } : undefined
      })
    });
    const executionMs = Math.max(0.01, performance.now() - executeStartedAt);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content ?? '';
    const decision = routed?.decision ?? await controller.routeAsync({ prompt, executableOnly: true, policy });
    const routerDecisionMs = positiveNumber(response.headers.get('x-proofroute-decision-ms')) ?? routed?.routerDecisionMs ?? 0.01;
    const exposeHeaders = preflight.headers.get('access-control-expose-headers') ?? '';
    const ok = preflight.status === 204 && proxyProofHeadersReadable(exposeHeaders) && response.status >= 200 && response.status < 300 && upstream.requests.length === 1 && upstream.requests[0].model === decision.model.id && response.headers.get('x-proofroute-model') === decision.model.id;
    if (routed?.telemetryWrite) await routed.telemetryWrite;
    return {
      status: ok ? 'pass' : 'fail',
      mode: 'proxy',
      prompt,
      decision,
      routerDecisionMs,
      executionMs,
      proxy: {
        origin: proxy.origin,
        url: proxy.url
      },
      cors: {
        status: preflight.status,
        allowHeaders: preflight.headers.get('access-control-allow-headers'),
        exposeHeaders
      },
      upstream: {
        url: upstream.url,
        requests: upstream.requests
      },
      response: {
        status: response.status,
        content,
        headers: proofHeaders(response)
      }
    };
  } finally {
    if (proxy) await proxy.close();
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function runProxySmokeMatrixTest() {
  const upstream = await fakeOpenAIProvider();
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-smoke-matrix-'));
  let proxy;
  try {
    const ledger = join(dir, 'events.jsonl');
    const config = smokeMatrixConfig(upstream.url, ledger);
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const routes = [];
    proxy = await startProxy({
      config,
      controller,
      runtime,
      port: 0,
      telemetryOverride: ledger,
      onRoute: (route) => {
        routes.push(route);
      }
    });
    const preflight = await fetch(`${proxy.origin}/v1/chat/completions`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://editor.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-proofroute-policy,x-proofroute-max-cost-usd'
      }
    });
    const exposeHeaders = preflight.headers.get('access-control-expose-headers') ?? '';
    const scenarios = [];
    const startedAt = performance.now();
    for (const scenario of smokeMatrixScenarios()) {
      const routeIndex = routes.length;
      const response = await fetch(`${proxy.origin}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer smoke-client',
          ...(scenario.maxCostUsd === undefined ? {} : { 'x-proofroute-max-cost-usd': String(scenario.maxCostUsd) })
        },
        body: JSON.stringify({
          model: scenario.requestedModel,
          messages: [{ role: 'user', content: scenario.prompt }],
          max_tokens: scenario.maxTokens,
          metadata: scenario.policy ? { proofroute_policy: scenario.policy } : undefined
        })
      });
      const payload = await response.json();
      const routed = routes[routeIndex];
      if (routed?.telemetryWrite) await routed.telemetryWrite;
      const headers = proofHeaders(response);
      const request = upstream.requests[routeIndex] ?? {};
      const content = payload.choices?.[0]?.message?.content ?? '';
      const rejectedReasons = Array.from(new Set((routed?.decision?.rejected ?? []).map((entry) => entry.reason)));
      const rejectedModels = Array.from(new Set((routed?.decision?.rejected ?? []).map((entry) => entry.model)));
      const checks = [
        response.status >= 200 && response.status < 300,
        headers.model === scenario.expectedModel,
        headers.intent === scenario.expectedIntent,
        request.model === scenario.expectedModel,
        content.includes(scenario.expectedModel),
        scenario.expectedRejectedReason ? rejectedReasons.includes(scenario.expectedRejectedReason) : true,
        scenario.maxCostUsd === undefined ? true : Number(headers.estimatedCostUsd) <= scenario.maxCostUsd
      ];
      scenarios.push({
        id: scenario.id,
        proof: scenario.proof,
        expectedModel: scenario.expectedModel,
        model: headers.model,
        requestedModel: headers.requestedModel,
        modelSwap: headers.modelSwap,
        intent: headers.intent,
        policy: headers.policy,
        runnerUp: headers.runnerUp,
        status: response.status,
        upstreamModel: request.model,
        routeCostUsd: Number(headers.estimatedCostUsd),
        baselineCostUsd: Number(headers.baselineCostUsd),
        contextUsePct: Number(headers.contextUsePct),
        contextWindow: Number(headers.contextWindow),
        speedup: Number(headers.speedup),
        savingsPct: Number(headers.savingsPct),
        routerDecisionMs: Number(headers.decisionMs),
        rejectedReasons,
        rejectedModels,
        passed: checks.every(Boolean)
      });
    }
    const ledgerEvents = await readRouteEvents(ledger);
    const privacy = await privacyReport(ledger);
    const elapsedMs = Math.max(0.01, performance.now() - startedAt);
    const routerLatencies = scenarios.map((scenario) => scenario.routerDecisionMs).filter(Number.isFinite);
    const promptFreeLedger = privacy.status === 'pass' && ledgerPromptFree(ledgerEvents);
    const ok = preflight.status === 204 && proxyProofHeadersReadable(exposeHeaders) && scenarios.every((scenario) => scenario.passed) && ledgerEvents.length === scenarios.length && promptFreeLedger;
    return {
      status: ok ? 'pass' : 'fail',
      mode: 'proxy_matrix',
      proxy: {
        origin: proxy.origin,
        url: proxy.url
      },
      cors: {
        status: preflight.status,
        allowHeaders: preflight.headers.get('access-control-allow-headers'),
        exposeHeaders
      },
      upstream: {
        url: upstream.url,
        requests: promptFreeUpstreamRequests(upstream.requests)
      },
      ledger: {
        events: ledgerEvents.length,
        promptFree: promptFreeLedger,
        privacy: {
          status: privacy.status,
          forbiddenMatchCount: privacy.forbiddenMatchCount,
          parseErrorCount: privacy.parseErrorCount
        }
      },
      aggregate: {
        count: scenarios.length,
        passed: scenarios.filter((scenario) => scenario.passed).length,
        modelSwaps: scenarios.filter((scenario) => scenario.modelSwap === 'true').length,
        p95RouterMs: percentile(routerLatencies, 0.95),
        savingsUsd: scenarios.reduce((total, scenario) => total + Math.max(0, scenario.baselineCostUsd - scenario.routeCostUsd), 0),
        averageSpeedup: average(scenarios.map((scenario) => scenario.speedup)),
        proofs: countBy(scenarios.map((scenario) => scenario.proof)),
        intents: countBy(scenarios.map((scenario) => scenario.intent)),
        models: countBy(scenarios.map((scenario) => scenario.model))
      },
      executionMs: elapsedMs,
      scenarios
    };
  } finally {
    if (proxy) await proxy.close();
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function smokeConfig(baseUrl, telemetryPath) {
  return {
    ...(telemetryPath ? { telemetry: { path: telemetryPath } } : {}),
    router: {
      softmaxTemperature: 0.82,
      latencyPenaltyMs: 900,
      costPenaltyUsd: 0.00035,
      qualityWeight: 2.1,
      localBias: 0.18,
      upstreamTimeoutMs: 1000
    },
    providers: {
      smoke: {
        baseUrl,
        apiKey: 'smoke-key'
      }
    },
    models: [
      smokeModel({
        id: 'smoke-fast',
        inputUsdPer1M: 0.1,
        outputUsdPer1M: 0.2,
        medianLatencyMs: 120,
        throughputTokensPerSecond: 180,
        quality: 0.9
      }),
      smokeModel({
        id: 'smoke-premium',
        inputUsdPer1M: 4,
        outputUsdPer1M: 12,
        medianLatencyMs: 850,
        throughputTokensPerSecond: 90,
        quality: 0.82
      })
    ]
  };
}

function smokeMatrixConfig(baseUrl, telemetryPath) {
  return {
    ...(telemetryPath ? { telemetry: { path: telemetryPath } } : {}),
    router: {
      softmaxTemperature: 0.82,
      latencyPenaltyMs: 900,
      costPenaltyUsd: 0.002,
      qualityWeight: 3.2,
      localBias: 0,
      upstreamTimeoutMs: 1000
    },
    providers: {
      smoke: {
        baseUrl,
        apiKey: 'smoke-key'
      }
    },
    models: [
      smokeMatrixModel('smoke-cheap', { all: 0.62 }, { contextWindow: 4096, inputUsdPer1M: 0.05, outputUsdPer1M: 0.1, medianLatencyMs: 100, throughputTokensPerSecond: 200 }),
      smokeMatrixModel('smoke-code-pro', { code: 0.99, writing: 0.5, extraction: 0.52, long_context: 0.5, reasoning: 0.72, chat: 0.62 }, { contextWindow: 32000, inputUsdPer1M: 2, outputUsdPer1M: 4, medianLatencyMs: 280, throughputTokensPerSecond: 130 }),
      smokeMatrixModel('smoke-writer-pro', { code: 0.52, writing: 0.99, extraction: 0.62, long_context: 0.55, reasoning: 0.7, chat: 0.66 }, { contextWindow: 32000, inputUsdPer1M: 1.5, outputUsdPer1M: 3, medianLatencyMs: 240, throughputTokensPerSecond: 120 }),
      smokeMatrixModel('smoke-tiny-context', { code: 0.55, writing: 0.5, extraction: 0.5, long_context: 0.98, reasoning: 0.6, chat: 0.6 }, { contextWindow: 1024, inputUsdPer1M: 0.2, outputUsdPer1M: 0.4, medianLatencyMs: 140, throughputTokensPerSecond: 160 }),
      smokeMatrixModel('smoke-long-context', { code: 0.6, writing: 0.6, extraction: 0.7, long_context: 0.98, reasoning: 0.85, chat: 0.65 }, { contextWindow: 200000, inputUsdPer1M: 0.6, outputUsdPer1M: 1.2, medianLatencyMs: 360, throughputTokensPerSecond: 150 }),
      smokeMatrixModel('smoke-premium', { all: 0.9 }, { inputUsdPer1M: 8, outputUsdPer1M: 16, medianLatencyMs: 850, throughputTokensPerSecond: 90 })
    ]
  };
}

function smokeMatrixScenarios() {
  return [
    {
      id: 'intent-code',
      proof: 'intent',
      requestedModel: 'smoke-premium',
      policy: 'quality',
      prompt: 'Refactor this TypeScript function, fix the stacktrace, and add a regression test. ```ts const x = 1 ```',
      maxTokens: 96,
      expectedIntent: 'code',
      expectedModel: 'smoke-code-pro'
    },
    {
      id: 'intent-writing',
      proof: 'intent',
      requestedModel: 'smoke-premium',
      policy: 'quality',
      prompt: 'Rewrite this launch README narrative with a stronger brand tone and concise developer story.',
      maxTokens: 96,
      expectedIntent: 'writing',
      expectedModel: 'smoke-writer-pro'
    },
    {
      id: 'context-window',
      proof: 'context',
      requestedModel: 'smoke-premium',
      policy: 'quality',
      prompt: 'Audit this repository migration architecture document and identify risks. '.repeat(8200),
      maxTokens: 512,
      expectedIntent: 'long_context',
      expectedModel: 'smoke-long-context',
      expectedRejectedReason: 'context_window'
    },
    {
      id: 'cost-ceiling',
      proof: 'cost',
      requestedModel: 'smoke-premium',
      prompt: 'Summarize this log and extract customer ids as JSON.',
      maxTokens: 96,
      maxCostUsd: 0.00003,
      expectedIntent: 'extraction',
      expectedModel: 'smoke-cheap',
      expectedRejectedReason: 'cost_budget'
    }
  ];
}

function smokeMatrixModel(id, quality, options = {}) {
  const all = quality.all ?? 0.6;
  return {
    id,
    provider: 'smoke',
    endpoint: '/chat/completions',
    local: false,
    contextWindow: options.contextWindow ?? 128000,
    inputUsdPer1M: options.inputUsdPer1M,
    outputUsdPer1M: options.outputUsdPer1M,
    medianLatencyMs: options.medianLatencyMs,
    throughputTokensPerSecond: options.throughputTokensPerSecond,
    quality: {
      code: quality.code ?? all,
      reasoning: quality.reasoning ?? all,
      writing: quality.writing ?? all,
      extraction: quality.extraction ?? all,
      chat: quality.chat ?? all,
      long_context: quality.long_context ?? all
    }
  };
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function smokeModel({ id, inputUsdPer1M, outputUsdPer1M, medianLatencyMs, throughputTokensPerSecond, quality }) {
  return {
    id,
    provider: 'smoke',
    endpoint: '/chat/completions',
    local: false,
    contextWindow: 128000,
    inputUsdPer1M,
    outputUsdPer1M,
    medianLatencyMs,
    throughputTokensPerSecond,
    quality: {
      code: quality,
      reasoning: quality,
      writing: quality,
      extraction: quality,
      chat: quality,
      long_context: quality
    }
  };
}

function fakeOpenAIProvider() {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }
    const body = JSON.parse(await readBody(req));
    requests.push({
      model: body.model,
      authorization: req.headers.authorization,
      messages: Array.isArray(body.messages) ? body.messages.length : 0,
      maxTokens: body.max_tokens
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-smoke',
      object: 'chat.completion',
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: `smoke ok via ${body.model}`
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 5,
        total_tokens: 13
      }
    }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function proofHeaders(response) {
  return {
    model: response.headers.get('x-proofroute-model'),
    requestedModel: response.headers.get('x-proofroute-requested-model'),
    modelSwap: response.headers.get('x-proofroute-model-swap'),
    policy: response.headers.get('x-proofroute-policy'),
    intent: response.headers.get('x-proofroute-intent'),
    runnerUp: response.headers.get('x-proofroute-runner-up'),
    cache: response.headers.get('x-proofroute-cache'),
    stream: response.headers.get('x-proofroute-stream'),
    usageSource: response.headers.get('x-proofroute-usage-source'),
    estimatedTokens: response.headers.get('x-proofroute-estimated-tokens'),
    contextWindow: response.headers.get('x-proofroute-context-window'),
    contextUsePct: response.headers.get('x-proofroute-context-use-pct'),
    classifierBackend: response.headers.get('x-proofroute-classifier-backend'),
    classifierCircuit: response.headers.get('x-proofroute-classifier-circuit'),
    classifierFailures: response.headers.get('x-proofroute-classifier-failures'),
    savedUsd: response.headers.get('x-proofroute-saved-usd'),
    savingsPct: response.headers.get('x-proofroute-savings-pct'),
    speedup: response.headers.get('x-proofroute-speedup'),
    estimatedCostUsd: response.headers.get('x-proofroute-estimated-cost-usd'),
    baselineCostUsd: response.headers.get('x-proofroute-baseline-cost-usd'),
    estimatedLatencyMs: response.headers.get('x-proofroute-estimated-latency-ms'),
    baselineLatencyMs: response.headers.get('x-proofroute-baseline-latency-ms'),
    routerOverheadPct: response.headers.get('x-proofroute-router-overhead-pct'),
    decisionMs: response.headers.get('x-proofroute-decision-ms'),
    actualTokens: response.headers.get('x-proofroute-actual-tokens'),
    actualCostUsd: response.headers.get('x-proofroute-actual-cost-usd'),
    actualSavedUsd: response.headers.get('x-proofroute-actual-saved-usd'),
    latencyMs: response.headers.get('x-proofroute-latency-ms'),
    serverTiming: response.headers.get('server-timing')
  };
}

function proxyProofHeadersReadable(exposeHeaders) {
  return [
    'x-proofroute-model',
    'x-proofroute-requested-model',
    'x-proofroute-model-swap',
    'x-proofroute-policy',
    'x-proofroute-runner-up',
    'x-proofroute-context-use-pct',
    'x-proofroute-speedup',
    'x-proofroute-classifier-backend',
    'x-proofroute-actual-tokens'
  ].every((header) => exposeHeaders.includes(header));
}

function promptFreeUpstreamRequests(requests) {
  return requests.map((request) => ({
    model: request.model,
    authorizationPresent: Boolean(request.authorization),
    messages: request.messages,
    maxTokens: request.maxTokens
  }));
}

function ledgerPromptFree(events) {
  return !/Refactor|Rewrite|Audit|Summarize|TypeScript|customer ids|stacktrace|README narrative/i.test(JSON.stringify(events));
}

function average(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((total, value) => total + value, 0) / finite.length : 0;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
