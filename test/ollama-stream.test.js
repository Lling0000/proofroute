import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { ollamaNdjsonToOpenAIStream } from '../src/agent/runtime.js';

test('ollama streaming frames are converted into OpenAI-compatible SSE chunks', async () => {
  const upstream = Readable.from([
    '{"message":{"content":"Hel"}}\n',
    '{"message":{"content":"lo"},"done":false}\n',
    '{"done":true}\n'
  ]);
  const decision = {
    model: { id: 'llama3.2:3b' },
    inputTokens: 3
  };
  const frames = [];
  for await (const frame of ollamaNdjsonToOpenAIStream(upstream, decision)) frames.push(frame);
  assert.ok(frames[0].startsWith('data: '));
  assert.match(frames[0], /"role":"assistant"/);
  assert.match(frames.join(''), /chat\.completion\.chunk/);
  assert.match(frames.join(''), /"content":"Hel"/);
  assert.match(frames.join(''), /"content":"lo"/);
  assert.equal(frames.at(-1), 'data: [DONE]\n\n');
});
