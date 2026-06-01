import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedClientModel, requestedModel, requestedPolicy, routeModelSwap, startProxy } from '../src/agent/proxy.js';
import { RouteController } from '../src/controller/route-controller.js';

test('agent proxy can read routing policy aliases from the model field', () => {
  assert.equal(requestedPolicy({ model: 'proofroute/local' }, {}), 'local');
  assert.equal(requestedPolicy({ model: 'proofroute:auto' }, {}), 'balanced');
  assert.equal(requestedClientModel({ model: ' proofroute/fast ' }), 'proofroute/fast');
  assert.equal(requestedModel({ model: 'proofroute/fast' }), undefined);
  assert.equal(requestedModel({ model: 'gpt-test' }), 'gpt-test');
  assert.equal(routeModelSwap('proofroute/fast', 'gpt-test'), true);
  assert.equal(routeModelSwap('gpt-test', 'gpt-test'), false);
  assert.equal(requestedPolicy({ model: 'proofroute/local', metadata: { proofroute_policy: 'quality' } }, {}), 'quality');
  assert.equal(requestedPolicy({ model: 'proofroute/local' }, { 'x-proofroute-policy': 'save' }), 'save');
});

test('agent proxy handles browser preflight and malformed JSON before routing', async () => {
  const proxy = await startProxy({ config: proxyConfig(), port: 0 });
  try {
    const preflight = await fetch(`${proxy.origin}/v1/chat/completions`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://editor.example',
        'access-control-request-method': 'POST'
      }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.equal(preflight.headers.get('timing-allow-origin'), '*');
    assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
    assert.match(preflight.headers.get('access-control-allow-headers'), /x-proofroute-max-cost-usd/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-model/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-requested-model/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-model-swap/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-router-overhead-pct/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-policy/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-stream/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-usage-source/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-estimated-tokens/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-classifier-backend/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-classifier-circuit/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-classifier-failures/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /server-timing/);
    const malformed = await fetch(`${proxy.origin}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{"messages":'
    });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get('access-control-allow-origin'), '*');
    assert.match(malformed.headers.get('access-control-expose-headers'), /x-proofroute-decision-ms/);
    const payload = await malformed.json();
    assert.match(payload.error.message, /Malformed JSON request body/);
  } finally {
    await proxy.close();
  }
});

test('agent proxy exposes classifier guard proof as browser-readable headers', async () => {
  const config = proxyConfig();
  const controller = new RouteController(config, {
    classify: () => ({
      name: 'code',
      confidence: 0.99,
      ranked: [{ name: 'code', probability: 0.99 }],
      features: {
        backend: 'external-url',
        classifierCircuitOpen: true,
        classifierFailures: 3
      }
    })
  });
  const runtime = {
    executeRoutedChatCompletion: async ({ decision }) => ({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-proofroute-model': 'spoofed-upstream-model',
        'x-proofroute-classifier-backend': 'spoofed-upstream-classifier',
        'server-timing': 'upstream;dur=999'
      },
      body: Buffer.from(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: decision.model.id,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7
        }
      }))
    })
  };
  const proxy = await startProxy({ config, controller, runtime, port: 0 });
  try {
    const response = await fetch(`${proxy.origin}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'proofroute/fast',
        messages: [{ role: 'user', content: 'Refactor this test without leaking text into headers.' }],
        max_tokens: 16
      })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-proofroute-model'), 'gpt-test');
    assert.equal(response.headers.get('x-proofroute-requested-model'), 'proofroute/fast');
    assert.equal(response.headers.get('x-proofroute-model-swap'), 'true');
    assert.ok(Number(response.headers.get('x-proofroute-router-overhead-pct')) >= 0);
    assert.equal(response.headers.get('x-proofroute-stream'), 'false');
    assert.equal(response.headers.get('x-proofroute-usage-source'), 'actual');
    assert.ok(Number(response.headers.get('x-proofroute-estimated-tokens')) > 0);
    assert.equal(response.headers.get('x-proofroute-classifier-backend'), 'external-url');
    assert.equal(response.headers.get('x-proofroute-classifier-circuit'), 'open');
    assert.equal(response.headers.get('x-proofroute-classifier-failures'), '3');
    assert.match(response.headers.get('server-timing'), /proofroute-router;dur=/);
    assert.match(response.headers.get('server-timing'), /proofroute-total;dur=/);
    assert.doesNotMatch(response.headers.get('server-timing'), /upstream/);
    assert.doesNotMatch([...response.headers.entries()].map(([key, value]) => `${key}:${value}`).join('\n'), /Refactor this test/);
  } finally {
    await proxy.close();
  }
});

test('agent proxy marks streamed routes as estimate-backed proof', async () => {
  const runtime = {
    executeRoutedChatCompletion: async () => ({
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      body: streamingBody()
    })
  };
  const proxy = await startProxy({ config: proxyConfig(), runtime, port: 0 });
  try {
    const response = await fetch(`${proxy.origin}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: 'user', content: 'Stream this response without logging prompt text.' }],
        max_tokens: 16
      })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-proofroute-stream'), 'true');
    assert.equal(response.headers.get('x-proofroute-usage-source'), 'estimate');
    assert.equal(response.headers.get('x-proofroute-actual-tokens'), null);
    assert.ok(Number(response.headers.get('x-proofroute-estimated-tokens')) > 0);
    assert.match(await response.text(), /stream ok/);
  } finally {
    await proxy.close();
  }
});

test('agent proxy returns explicit no-route responses for impossible budgets', async () => {
  const proxy = await startProxy({ config: proxyConfig(), port: 0 });
  try {
    const response = await fetch(`${proxy.origin}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'secret prompt that must not appear in errors' }],
        max_tokens: 64,
        metadata: {
          proofroute_max_cost_usd: 0
        }
      })
    });
    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.error.code, 'no_route');
    assert.match(payload.error.message, /No configured executable model/);
    assert.equal(payload.error.details.rejected[0].reason, 'cost_budget');
    assert.doesNotMatch(JSON.stringify(payload), /secret prompt/);
  } finally {
    await proxy.close();
  }
});

test('agent proxy accepts routing constraints from headers', async () => {
  const proxy = await startProxy({ config: proxyConfig(), port: 0 });
  try {
    const response = await fetch(`${proxy.origin}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-proofroute-max-cost-usd': '0'
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'header budget prompt that must stay private' }],
        max_tokens: 64
      })
    });
    assert.equal(response.status, 422);
    const payload = await response.json();
    assert.equal(payload.error.code, 'no_route');
    assert.equal(payload.error.details.maxCostUsd, 0);
    assert.equal(payload.error.details.rejected[0].reason, 'cost_budget');
    assert.doesNotMatch(JSON.stringify(payload), /header budget prompt/);
  } finally {
    await proxy.close();
  }
});

async function* streamingBody() {
  yield 'data: {"choices":[{"delta":{"content":"stream ok"}}]}\n\n';
  yield 'data: [DONE]\n\n';
}

function proxyConfig() {
  return {
    providers: {
      openai: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key'
      }
    },
    models: [
      {
        id: 'gpt-test',
        provider: 'openai',
        endpoint: '/chat/completions',
        local: false,
        contextWindow: 8192,
        inputUsdPer1M: 1,
        outputUsdPer1M: 2,
        medianLatencyMs: 50,
        throughputTokensPerSecond: 100,
        quality: {
          chat: 0.9,
          code: 0.8,
          extraction: 0.8,
          long_context: 0.8,
          reasoning: 0.8,
          writing: 0.8
        }
      }
    ]
  };
}
