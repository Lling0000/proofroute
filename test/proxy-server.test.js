import test from 'node:test';
import assert from 'node:assert/strict';
import { startProxy } from '../src/agent/proxy.js';

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
    assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
    assert.match(preflight.headers.get('access-control-allow-headers'), /x-proofroute-max-cost-usd/);
    assert.match(preflight.headers.get('access-control-expose-headers'), /x-proofroute-model/);
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
