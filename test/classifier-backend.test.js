import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';

test('route controller accepts a pluggable classifier backend', () => {
  const classifier = {
    classify() {
      return {
        name: 'writing',
        confidence: 0.99,
        ranked: [{ name: 'writing', probability: 0.99, score: 4 }],
        features: { backend: 'test' }
      };
    }
  };
  const controller = new RouteController(demoCatalog(), classifier);
  const decision = controller.route({ prompt: 'Pretend this looks like code but route it as writing.' });
  assert.equal(decision.intent.name, 'writing');
  assert.equal(decision.intent.features.backend, 'test');
});

test('route controller accepts an async classifier backend', async () => {
  const classifier = {
    async classifyAsync() {
      return {
        name: 'extraction',
        confidence: 0.98,
        ranked: [{ name: 'extraction', probability: 0.98, score: 4 }],
        features: { backend: 'async-test' }
      };
    },
    classify() {
      return {
        name: 'code',
        confidence: 0.5,
        ranked: [],
        features: { backend: 'sync-test' }
      };
    }
  };
  const controller = new RouteController(demoCatalog(), classifier);
  const decision = await controller.routeAsync({ prompt: 'Pretend this is code but route it as extraction.' });
  assert.equal(decision.intent.name, 'extraction');
  assert.equal(decision.intent.features.backend, 'async-test');
});

test('route controller caches repeated classifier decisions by prompt fingerprint', () => {
  let calls = 0;
  const classifier = {
    classify() {
      calls += 1;
      return {
        name: 'writing',
        confidence: 0.99,
        ranked: [{ name: 'writing', probability: 0.99, score: 4 }],
        features: { backend: 'cache-test' }
      };
    }
  };
  const controller = new RouteController(demoCatalog(), classifier);
  const first = controller.route({ prompt: 'Rewrite this launch note.' });
  const second = controller.route({ prompt: 'Rewrite this launch note.' });
  assert.equal(calls, 1);
  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
  assert.doesNotMatch(second.cache.key, /Rewrite/);
});

test('route controller caches repeated async classifier decisions', async () => {
  let calls = 0;
  const classifier = {
    async classifyAsync() {
      calls += 1;
      return {
        name: 'extraction',
        confidence: 0.98,
        ranked: [{ name: 'extraction', probability: 0.98, score: 4 }],
        features: { backend: 'async-cache-test' }
      };
    },
    classify() {
      throw new Error('sync classifier should not run');
    }
  };
  const controller = new RouteController(demoCatalog(), classifier);
  const first = await controller.routeAsync({ prompt: 'Extract ids into JSON.' });
  const second = await controller.routeAsync({ prompt: 'Extract ids into JSON.' });
  assert.equal(calls, 1);
  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
});

test('route controller batches classifier misses while preserving cache hits', async () => {
  let calls = 0;
  const classifier = {
    async classifyMany(prompts) {
      calls += 1;
      return prompts.map((prompt) => ({
        name: prompt.includes('JSON') ? 'extraction' : 'writing',
        confidence: 0.97,
        ranked: [],
        features: { backend: 'batch-test' }
      }));
    },
    classify() {
      throw new Error('sync classifier should not run');
    }
  };
  const controller = new RouteController(demoCatalog(), classifier);
  const first = await controller.routeBatchAsync([
    { prompt: 'Extract ids into JSON.' },
    { prompt: 'Rewrite this launch note.' }
  ]);
  const second = await controller.routeBatchAsync([
    { prompt: 'Extract ids into JSON.' },
    { prompt: 'Rewrite this launch note.' }
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first.map((decision) => decision.intent.name), ['extraction', 'writing']);
  assert.ok(first.every((decision) => decision.cache.hit === false));
  assert.ok(second.every((decision) => decision.cache.hit === true));
});
