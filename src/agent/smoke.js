import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProxy } from './proxy.js';
import { AgentRuntime } from './runtime.js';
import { RouteController } from '../controller/route-controller.js';

export async function runSmokeTest({ prompt = 'Refactor this webhook and explain the cheapest safe model choice.', policy, throughProxy = false } = {}) {
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
    const ok = preflight.status === 204 && exposeHeaders.includes('x-proofroute-model') && exposeHeaders.includes('x-proofroute-requested-model') && exposeHeaders.includes('x-proofroute-model-swap') && exposeHeaders.includes('x-proofroute-policy') && exposeHeaders.includes('x-proofroute-runner-up') && exposeHeaders.includes('x-proofroute-context-use-pct') && exposeHeaders.includes('x-proofroute-speedup') && exposeHeaders.includes('x-proofroute-classifier-backend') && exposeHeaders.includes('x-proofroute-actual-tokens') && response.status >= 200 && response.status < 300 && upstream.requests.length === 1 && upstream.requests[0].model === decision.model.id && response.headers.get('x-proofroute-model') === decision.model.id;
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
        headers: {
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
          actualTokens: response.headers.get('x-proofroute-actual-tokens'),
          actualCostUsd: response.headers.get('x-proofroute-actual-cost-usd'),
          actualSavedUsd: response.headers.get('x-proofroute-actual-saved-usd'),
          latencyMs: response.headers.get('x-proofroute-latency-ms'),
          serverTiming: response.headers.get('server-timing')
        }
      }
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
      messages: Array.isArray(body.messages) ? body.messages.length : 0
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

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
