import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from '../src/config.js';
import { classifyIntent, stableSoftmax } from '../src/controller/intent.js';
import { RouteController } from '../src/controller/route-controller.js';

test('stableSoftmax remains finite for extreme logits', () => {
  const probabilities = stableSoftmax([10000, 9999, -10000], 0.1);
  assert.equal(probabilities.length, 3);
  assert.ok(probabilities.every(Number.isFinite));
  assert.ok(Math.abs(probabilities.reduce((total, value) => total + value, 0) - 1) < 1e-12);
  assert.ok(probabilities[0] > probabilities[1]);
});

test('intent classifier recognizes code-heavy prompts', () => {
  const intent = classifyIntent('Refactor this TypeScript function, fix the stacktrace, and add a regression test. ```ts const x = 1 ```');
  assert.equal(intent.name, 'code');
  assert.ok(intent.confidence > 0.5);
  assert.ok(intent.features.hasCodeFence);
});

test('intent classifier normalizes plural reasoning vocabulary', () => {
  const intent = classifyIntent('Compare these routing algorithms and explain the cost, latency, and quality tradeoffs.');
  assert.equal(intent.name, 'reasoning');
});

test('route controller returns a complete economic decision', () => {
  const controller = new RouteController(demoCatalog());
  const decision = controller.route({ prompt: 'Write a focused SQL migration test and explain the production bug.' });
  assert.ok(decision.model.id);
  assert.ok(decision.ranked.length > 0);
  assert.ok(decision.economics.savingsUsd >= 0);
  assert.ok(decision.performance.estimatedLatencyMs > 0);
});
