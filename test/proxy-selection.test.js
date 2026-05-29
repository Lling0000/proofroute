import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { AgentRuntime } from '../src/agent/runtime.js';
import { demoCatalog } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';

test('executable routing ignores cloud models without credentials', () => {
  const controller = new RouteController(demoCatalog());
  const decision = controller.route({
    prompt: 'Refactor this TypeScript service and write a regression test.',
    executableOnly: true
  });
  assert.equal(decision.model.provider, 'local');
});

test('local OpenAI-compatible models execute without Ollama adaptation or API keys', async () => {
  const upstream = await startOpenAICompatibleProvider();
  try {
    const config = {
      providers: {
        localGateway: {
          baseUrl: upstream.url,
          requiresApiKey: false
        }
      },
      models: [
        {
          id: 'local-openai',
          provider: 'localGateway',
          endpoint: '/chat/completions',
          local: true,
          contextWindow: 32768,
          inputUsdPer1M: 0,
          outputUsdPer1M: 0,
          medianLatencyMs: 40,
          throughputTokensPerSecond: 180,
          quality: {
            chat: 0.9,
            code: 0.9,
            extraction: 0.8,
            long_context: 0.8,
            reasoning: 0.8,
            writing: 0.8
          }
        }
      ]
    };
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const decision = controller.route({
      prompt: 'Refactor this local gateway call.',
      executableOnly: true
    });
    const upstreamResponse = await runtime.executeRoutedChatCompletion({
      decision,
      body: {
        messages: [{ role: 'user', content: 'Refactor this local gateway call.' }],
        max_tokens: 8
      }
    });
    const payload = JSON.parse(Buffer.from(upstreamResponse.body).toString('utf8'));
    assert.equal(upstreamResponse.status, 200);
    assert.equal(payload.choices[0].message.content, 'local openai ok');
    assert.equal(upstream.requests.length, 1);
    assert.equal(upstream.requests[0].authorization, undefined);
    assert.equal(upstream.requests[0].body.model, 'local-openai');
    assert.deepEqual(upstream.requests[0].body.messages, [{ role: 'user', content: 'Refactor this local gateway call.' }]);
  } finally {
    await upstream.close();
  }
});

test('environment can inject a local OpenAI-compatible gateway without JSON config', () => {
  const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'models', '--json'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_LOCAL_OPENAI_BASE_URL: 'http://127.0.0.1:65535/v1',
      PROOFROUTE_LOCAL_OPENAI_MODEL: 'studio-env',
      PROOFROUTE_LOCAL_OPENAI_CONTEXT_WINDOW: '64000',
      PROOFROUTE_LOCAL_OPENAI_LATENCY_MS: '90',
      PROOFROUTE_LOCAL_OPENAI_TOKENS_PER_SECOND: '220'
    },
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  const model = report.models.find((entry) => entry.id === 'studio-env');
  assert.equal(model.provider, 'localOpenai');
  assert.equal(model.local, true);
  assert.equal(model.executable, true);
  assert.equal(model.contextWindow, 64000);
  assert.equal(model.medianLatencyMs, 90);
  assert.ok(report.summary.executable >= 2);
});

function startOpenAICompatibleProvider() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    requests.push({
      authorization: req.headers.authorization,
      body
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-local',
      object: 'chat.completion',
      model: body.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'local openai ok' },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 6,
        completion_tokens: 3,
        total_tokens: 9
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
