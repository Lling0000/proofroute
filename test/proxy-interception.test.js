import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startProxy } from '../src/agent/proxy.js';
import { RouteController } from '../src/controller/route-controller.js';

test('transparent proxy sends extracted prompts to classifier without leaking them to headers or telemetry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-proxy-interception-'));
  const telemetryPath = join(dir, 'events.jsonl');
  const classifiedPrompts = [];
  const telemetryWrites = [];
  const controller = new RouteController(proxyConfig(telemetryPath), {
    classifyAsync: async (prompt) => {
      classifiedPrompts.push(prompt);
      return {
        name: prompt.includes('JSON') ? 'extraction' : 'chat',
        confidence: 0.97,
        ranked: [{ name: 'chat', probability: 0.97 }],
        features: {
          backend: 'test-capture',
          classifierCircuitOpen: false,
          classifierFailures: 0
        }
      };
    }
  });
  const proxy = await startProxy({
    config: proxyConfig(telemetryPath),
    controller,
    runtime: fakeRuntime(),
    port: 0,
    onRoute: ({ telemetryWrite }) => telemetryWrites.push(telemetryWrite)
  });
  const secrets = {
    chat: 'CHAT_SECRET_PROMPT_alpha_7421',
    responses: 'RESPONSES_SECRET_PROMPT_beta_9135',
    completions: 'COMPLETIONS_SECRET_PROMPT_gamma_2846'
  };

  try {
    const responses = [
      await fetch(`${proxy.origin}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'proofroute/fast',
          messages: [
            { role: 'system', content: 'Classify the next user message.' },
            { role: 'user', content: `Route this chat request: ${secrets.chat}` }
          ],
          max_tokens: 8
        })
      }),
      await fetch(`${proxy.origin}/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'proofroute/fast',
          instructions: 'Return compact JSON.',
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: `Extract this Responses payload into JSON: ${secrets.responses}`
                }
              ]
            }
          ],
          max_output_tokens: 8
        })
      }),
      await fetch(`${proxy.origin}/v1/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'proofroute/fast',
          prompt: `Complete this legacy prompt: ${secrets.completions}`,
          max_tokens: 8
        })
      })
    ];

    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-proofroute-classifier-backend'), 'test-capture');
      assertNoSecret(headerText(response), secrets);
      await response.arrayBuffer();
    }
    await Promise.all(telemetryWrites);

    assert.equal(classifiedPrompts.length, 3);
    assert.match(classifiedPrompts[0], new RegExp(secrets.chat));
    assert.match(classifiedPrompts[1], new RegExp(secrets.responses));
    assert.match(classifiedPrompts[1], /Return compact JSON/);
    assert.match(classifiedPrompts[2], new RegExp(secrets.completions));

    const ledger = await readFile(telemetryPath, 'utf8');
    assert.equal(ledger.trim().split(/\r?\n/).length, 3);
    assert.match(ledger, /"classifierBackend":"test-capture"/);
    assertNoSecret(ledger, secrets);
  } finally {
    await proxy.close();
    await rm(dir, { recursive: true, force: true });
  }
});

function fakeRuntime() {
  return {
    executeRoutedChatCompletion: async ({ decision }) => chatResult(decision),
    executeResponse: async ({ decision }) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({
        id: 'resp-test',
        object: 'response',
        output_text: 'ok',
        model: decision.model.id,
        usage: {
          input_tokens: 5,
          output_tokens: 2,
          total_tokens: 7
        }
      }))
    }),
    executeCompletion: async ({ decision }) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({
        id: 'cmpl-test',
        object: 'text_completion',
        model: decision.model.id,
        choices: [{ text: 'ok', index: 0, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 2,
          total_tokens: 7
        }
      }))
    })
  };
}

function chatResult(decision) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
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
  };
}

function headerText(response) {
  return [...response.headers.entries()].map(([key, value]) => `${key}: ${value}`).join('\n');
}

function assertNoSecret(text, secrets) {
  for (const secret of Object.values(secrets)) {
    assert.doesNotMatch(text, new RegExp(secret));
  }
}

function proxyConfig(telemetryPath) {
  return {
    telemetry: {
      path: telemetryPath
    },
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
