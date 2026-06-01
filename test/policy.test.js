import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from '../src/config.js';
import { policyWeights, resolvePolicy, RouteController } from '../src/controller/route-controller.js';

test('policy weights expose distinct routing priorities', () => {
  assert.ok(policyWeights('save').cost > policyWeights('balanced').cost);
  assert.ok(policyWeights('quality').quality > policyWeights('balanced').quality);
  assert.ok(policyWeights('local').local > policyWeights('fast').local);
  assert.equal(resolvePolicy('LOCAL'), 'local');
  assert.equal(resolvePolicy('auto'), 'balanced');
  assert.equal(resolvePolicy('made-up'), 'balanced');
});

test('local policy can move a short code prompt to an executable local model', () => {
  const controller = new RouteController(demoCatalog());
  const balanced = controller.route({ prompt: 'Fix this TypeScript function and add a regression test.', policy: 'balanced' });
  const local = controller.route({ prompt: 'Fix this TypeScript function and add a regression test.', policy: 'local' });
  const invalid = controller.route({ prompt: 'Fix this TypeScript function and add a regression test.', policy: 'made-up' });
  assert.equal(balanced.policy, 'balanced');
  assert.equal(local.policy, 'local');
  assert.equal(invalid.policy, 'balanced');
  assert.equal(balanced.model.id, 'deepseek-coder-v2');
  assert.equal(local.model.local, true);
});
