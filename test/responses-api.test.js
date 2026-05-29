import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProxy } from '../src/agent/proxy.js';
import { AgentRuntime } from '../src/agent/runtime.js';
import { readRouteEvents } from '../src/agent/telemetry.js';

test('runtime adapts Responses API input into a response object', async () => {
  const upstream = await fakeOpenAI({ stream: false });
  try {
    const runtime = new AgentRuntime({
      providers: {
        openai: {
          baseUrl: upstream.url,
          apiKey: 'test-key'
        }
      }
    });
    const result = await runtime.executeResponse({
      decision: cloudDecision(),
      body: {
        instructions: 'Be brief.',
        max_output_tokens: 12,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Say hello.'
              }
            ]
          }
        ]
      }
    });
    assert.equal(result.status, 200);
    const payload = JSON.parse(result.body.toString('utf8'));
    assert.equal(payload.object, 'response');
    assert.equal(payload.output_text, 'hello from chat');
    assert.equal(payload.output[0].content[0].type, 'output_text');
    assert.equal(payload.proofroute.intent, 'chat');
    assert.equal(upstream.requests.length, 1);
    assert.equal(upstream.requests[0].messages[0].role, 'system');
    assert.equal(upstream.requests[0].messages[1].content, 'Say hello.');
    assert.equal(upstream.requests[0].max_tokens, 12);
  } finally {
    await upstream.close();
  }
});

test('runtime adapts streamed chat chunks into Responses API SSE', async () => {
  const upstream = await fakeOpenAI({ stream: true });
  try {
    const runtime = new AgentRuntime({
      providers: {
        openai: {
          baseUrl: upstream.url,
          apiKey: 'test-key'
        }
      }
    });
    const result = await runtime.executeResponse({
      decision: cloudDecision(),
      body: {
        input: 'Say hello.',
        stream: true
      }
    });
    assert.equal(result.headers['content-type'], 'text/event-stream; charset=utf-8');
    const frames = [];
    for await (const chunk of result.body) frames.push(Buffer.from(chunk).toString('utf8'));
    const output = frames.join('');
    assert.match(output, /event: response\.created/);
    assert.match(output, /event: response\.output_text\.delta/);
    assert.match(output, /"delta":"hello"/);
    assert.match(output, /event: response\.completed/);
  } finally {
    await upstream.close();
  }
});

test('proxy accepts Responses API requests through the transparent route', async () => {
  const upstream = await fakeOpenAI({ stream: false });
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-responses-'));
  const port = await freePort();
  const configPath = join(dir, 'router.json');
  const telemetryPath = join(dir, 'events.jsonl');
  let proxy;
  try {
    await writeFile(configPath, JSON.stringify(proxyConfig(upstream.url, telemetryPath), null, 2), 'utf8');
    proxy = spawn(process.execPath, ['./bin/proofroute.js', 'proxy', '--port', String(port), '--config', configPath], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForProxy(proxy);
    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-test',
        max_output_tokens: 7,
        input: 'Explain this simple question quickly.'
      })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-proofroute-model'), 'gpt-test');
    assert.equal(response.headers.get('x-proofroute-intent'), 'chat');
    assert.equal(response.headers.get('x-proofroute-cache'), 'miss');
    assert.equal(response.headers.get('x-proofroute-actual-tokens'), '6');
    assert.equal(response.headers.get('x-proofroute-actual-cost-usd'), '0.000009');
    const payload = await response.json();
    assert.equal(payload.object, 'response');
    assert.equal(payload.output_text, 'hello from chat');
    assert.equal(upstream.requests.at(-1).max_tokens, 7);
    const events = await waitForEvents(telemetryPath);
    assert.equal(events.length, 1);
    assert.equal(events[0].actualInputTokens, 3);
    assert.equal(events[0].actualOutputTokens, 3);
    assert.equal(events[0].actualTotalTokens, 6);
    assert.equal(events[0].actualCostUsd, 0.000009);
  } finally {
    if (proxy) {
      proxy.kill('SIGTERM');
      await new Promise((resolve) => proxy.once('exit', resolve));
    }
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('proxy adapts legacy Completions API requests through the transparent route', async () => {
  const upstream = await fakeOpenAI({ stream: false });
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-completions-'));
  let proxy;
  try {
    const telemetryPath = join(dir, 'events.jsonl');
    proxy = await startProxy({ config: proxyConfig(upstream.url, telemetryPath), port: 0 });
    const response = await fetch(`${proxy.origin}/v1/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-test',
        max_tokens: 7,
        prompt: 'Say hello through the legacy completions endpoint.'
      })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-proofroute-model'), 'gpt-test');
    assert.equal(response.headers.get('x-proofroute-actual-tokens'), '6');
    const payload = await response.json();
    assert.equal(payload.object, 'text_completion');
    assert.equal(payload.choices[0].text, 'hello from chat');
    assert.equal(upstream.requests.at(-1).messages[0].content, 'Say hello through the legacy completions endpoint.');
    assert.equal(upstream.requests.at(-1).max_tokens, 7);
    const events = await waitForEvents(telemetryPath);
    assert.equal(events.length, 1);
    assert.equal(events[0].actualTotalTokens, 6);
  } finally {
    if (proxy) await proxy.close();
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
});

async function waitForEvents(path) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const events = await readRouteEvents(path);
    if (events.length > 0) return events;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return readRouteEvents(path);
}

function fakeOpenAI({ stream }) {
  const requests = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.url, '/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer test-key');
    const body = await readBody(req);
    requests.push(JSON.parse(body));
    if (stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"hello"},"index":0,"finish_reason":null}]}\n\n');
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'hello from chat'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        input_tokens: 3,
        output_tokens: 3,
        total_tokens: 6
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

function proxyConfig(baseUrl, telemetryPath) {
  return {
    telemetry: {
      path: telemetryPath
    },
    providers: {
      openai: {
        baseUrl,
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

function cloudDecision() {
  return {
    model: {
      id: 'gpt-test',
      provider: 'openai',
      endpoint: '/chat/completions',
      local: false
    },
    inputTokens: 3,
    outputTokens: 3,
    intent: { name: 'chat' },
    confidence: 0.91,
    economics: { estimatedCostUsd: 0.001, savingsUsd: 0.002 },
    performance: { speedup: 1.3, estimatedLatencyMs: 100 }
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on('error', reject);
  });
}

function waitForProxy(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('proxy did not become ready')), 2000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('proofroute proxy listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      clearTimeout(timer);
      reject(new Error(String(chunk)));
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`proxy exited with ${code}`));
    });
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
