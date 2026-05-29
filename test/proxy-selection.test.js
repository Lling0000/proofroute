import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';

test('executable routing ignores cloud models without credentials', () => {
  const controller = new RouteController(demoCatalog());
  const decision = controller.route({
    prompt: 'Refactor this TypeScript service and write a regression test.',
    executableOnly: true
  });
  assert.equal(decision.model.provider, 'local');
});
