import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AgentRuntime } from '../src/agent/runtime.js';
import { RouteController } from '../src/controller/route-controller.js';

test('runtime converts streamed local Ollama responses into OpenAI SSE', async () => {
  const upstream = await fakeOllama();
  try {
    const config = {
      router: {
        policy: 'local'
      },
      providers: {
        local: {
          baseUrl: upstream.url,
          kind: 'ollama'
        }
      },
      models: [
        {
          id: 'llama3.2:3b',
          provider: 'local',
          endpoint: '/api/chat',
          local: true,
          contextWindow: 8192,
          inputUsdPer1M: 0,
          outputUsdPer1M: 0,
          medianLatencyMs: 25,
          throughputTokensPerSecond: 100,
          quality: { chat: 0.8, code: 0.8, extraction: 0.8, long_context: 0.8, reasoning: 0.8, writing: 0.8 }
        }
      ]
    };
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const decision = controller.route({ prompt: 'say hi', executableOnly: true, policy: 'local' });
    const response = await runtime.executeChatCompletion({
      decision,
      body: {
        stream: true,
        messages: [{ role: 'user', content: 'say hi' }]
      }
    });
    assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8');
    const frames = [];
    for await (const frame of response.body) frames.push(frame);
    const output = frames.join('');
    assert.match(output, /chat\.completion\.chunk/);
    assert.match(output, /"content":"hi"/);
    assert.match(output, /data: \[DONE\]/);
  } finally {
    await upstream.close();
  }
});

function fakeOllama() {
  const server = createServer((req, res) => {
    assert.equal(req.url, '/api/chat');
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write('{"message":{"content":"hi"},"done":false}\n');
    res.end('{"done":true}\n');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}
