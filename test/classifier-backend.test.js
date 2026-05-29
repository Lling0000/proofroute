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
