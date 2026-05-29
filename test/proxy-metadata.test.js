import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRuntime } from '../src/agent/runtime.js';
import { demoCatalog, mergeConfig } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';

test('model list exposes only executable OpenAI-compatible model metadata', () => {
  const config = demoCatalog();
  const controller = new RouteController(config);
  const runtime = new AgentRuntime(config);
  const list = runtime.modelList({ controller });
  assert.equal(list.object, 'list');
  assert.ok(list.data.length > 0);
  assert.ok(list.data.every((model) => model.object === 'model'));
  assert.ok(list.data.every((model) => model.llm_router.provider === 'local'));
});

test('readiness reflects executable local and cloud coverage', () => {
  const config = mergeConfig(demoCatalog(), {
    providers: {
      openai: {
        baseUrl: 'https://example.test/v1',
        apiKey: 'test-key'
      }
    }
  });
  const controller = new RouteController(config);
  const runtime = new AgentRuntime(config);
  const ready = runtime.readiness({ controller });
  assert.equal(ready.ok, true);
  assert.ok(ready.executable_models > 1);
  assert.ok(ready.providers.includes('local'));
  assert.ok(ready.providers.includes('openai'));
  assert.ok(ready.cloud_models > 0);
});
