import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AgentRuntime } from '../src/agent/runtime.js';

test('runtime retries a fallback model after retryable upstream failure', async () => {
  const upstream = await fakeOpenAI();
  try {
    const runtime = new AgentRuntime({
      providers: {
        openai: {
          baseUrl: upstream.url,
          apiKey: 'test-key'
        }
      },
      models: [
        model('primary-model'),
        model('fallback-model')
      ]
    });
    const response = await runtime.executeRoutedChatCompletion({
      decision: decision(),
      body: {
        messages: [{ role: 'user', content: 'hello' }]
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.decision.model.id, 'fallback-model');
    assert.equal(response.fallback.from, 'primary-model');
    assert.equal(response.fallback.to, 'fallback-model');
    assert.deepEqual(upstream.models, ['primary-model', 'fallback-model']);
  } finally {
    await upstream.close();
  }
});

test('runtime retries a fallback model after upstream timeout', async () => {
  const upstream = await fakeOpenAI({ primaryDelayMs: Infinity });
  try {
    const runtime = new AgentRuntime({
      router: {
        upstreamTimeoutMs: 100
      },
      providers: {
        openai: {
          baseUrl: upstream.url,
          apiKey: 'test-key'
        }
      },
      models: [
        model('primary-model'),
        model('fallback-model')
      ]
    });
    const response = await runtime.executeRoutedChatCompletion({
      decision: decision(),
      body: {
        messages: [{ role: 'user', content: 'hello' }]
      }
    });
    assert.equal(response.status, 200);
    assert.equal(response.decision.model.id, 'fallback-model');
    assert.equal(response.fallback.from, 'primary-model');
    assert.equal(response.fallback.to, 'fallback-model');
    assert.equal(response.fallback.status, 599);
    assert.deepEqual(upstream.models, ['primary-model', 'fallback-model']);
  } finally {
    await upstream.close();
  }
});

function fakeOpenAI({ primaryDelayMs = 0 } = {}) {
  const models = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.url, '/chat/completions');
    const body = JSON.parse(await readBody(req));
    models.push(body.model);
    if (body.model === 'primary-model') {
      if (primaryDelayMs === Infinity) return;
      if (primaryDelayMs > 0) {
        const timer = setTimeout(() => {
          if (res.destroyed) return;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            choices: [
              {
                message: {
                  content: 'primary late'
                }
              }
            ]
          }));
        }, primaryDelayMs);
        timer.unref?.();
        return;
      }
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'temporarily unavailable' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [
        {
          message: {
            content: 'fallback ok'
          }
        }
      ]
    }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        models,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function decision() {
  return {
    model: model('primary-model'),
    fallback: {
      model: 'fallback-model',
      provider: 'openai',
      probability: 0.41,
      estimatedCostUsd: 0.002,
      estimatedLatencyMs: 140
    },
    inputTokens: 4,
    outputTokens: 8,
    intent: { name: 'chat' },
    confidence: 0.6,
    economics: { estimatedCostUsd: 0.001, savingsUsd: 0.003 },
    performance: { speedup: 1.2, estimatedLatencyMs: 100 }
  };
}

function model(id) {
  return {
    id,
    provider: 'openai',
    endpoint: '/chat/completions',
    local: false
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
