import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from '../src/config.js';
import { policyWeights, RouteController } from '../src/controller/route-controller.js';

test('policy weights expose distinct routing priorities', () => {
  assert.ok(policyWeights('save').cost > policyWeights('balanced').cost);
  assert.ok(policyWeights('quality').quality > policyWeights('balanced').quality);
  assert.ok(policyWeights('local').local > policyWeights('fast').local);
});

test('local policy can move a short code prompt to an executable local model', () => {
  const controller = new RouteController(demoCatalog());
  const balanced = controller.route({ prompt: 'Fix this TypeScript function and add a regression test.', policy: 'balanced' });
  const local = controller.route({ prompt: 'Fix this TypeScript function and add a regression test.', policy: 'local' });
  assert.equal(balanced.model.id, 'deepseek-coder-v2');
  assert.equal(local.model.local, true);
});
