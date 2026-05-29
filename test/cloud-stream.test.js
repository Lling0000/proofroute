import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { AgentRuntime, anthropicSseToOpenAIStream } from '../src/agent/runtime.js';

test('OpenAI-compatible streaming provider is passed through as SSE', async () => {
  const upstream = await fakeOpenAIStream();
  try {
    const runtime = new AgentRuntime({
      providers: {
        openai: {
          baseUrl: upstream.url,
          apiKey: 'test-key'
        }
      }
    });
    const response = await runtime.executeChatCompletion({
      decision: cloudDecision('gpt-test', 'openai'),
      body: {
        stream: true,
        messages: [{ role: 'user', content: 'hello' }]
      }
    });
    assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8');
    const frames = [];
    for await (const chunk of response.body) frames.push(Buffer.from(chunk).toString('utf8'));
    assert.match(frames.join(''), /chat\.completion\.chunk/);
    assert.match(frames.join(''), /data: \[DONE\]/);
  } finally {
    await upstream.close();
  }
});

test('Anthropic SSE frames are converted into OpenAI-compatible chunks', async () => {
  const upstream = Readable.from([
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}\n\n',
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}\n\n',
    'event: message_delta\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
    'event: message_stop\n',
    'data: {"type":"message_stop"}\n\n'
  ]);
  const frames = [];
  for await (const frame of anthropicSseToOpenAIStream(upstream, cloudDecision('claude-test', 'anthropic'))) frames.push(frame);
  const output = frames.join('');
  assert.match(frames[0], /"role":"assistant"/);
  assert.match(output, /"content":"Hel"/);
  assert.match(output, /"content":"lo"/);
  assert.match(output, /"finish_reason":"stop"/);
  assert.equal(frames.at(-1), 'data: [DONE]\n\n');
});

function cloudDecision(id, provider) {
  return {
    model: {
      id,
      provider,
      local: false,
      endpoint: '/chat/completions'
    },
    inputTokens: 4,
    outputTokens: 8,
    intent: { name: 'chat' },
    confidence: 0.9,
    economics: { estimatedCostUsd: 0.001, savingsUsd: 0.002 },
    performance: { speedup: 1.2, estimatedLatencyMs: 100 }
  };
}

function fakeOpenAIStream() {
  const server = createServer((req, res) => {
    assert.equal(req.url, '/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"hi"},"index":0,"finish_reason":null}]}\n\n');
    res.end('data: [DONE]\n\n');
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
