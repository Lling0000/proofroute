import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRuntime } from '../src/agent/runtime.js';
import { demoCatalog } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';

test('agent planner creates parallel assignments with aggregate economics', async () => {
  const config = demoCatalog();
  const runtime = new AgentRuntime(config);
  const controller = new RouteController(config);
  const plan = await runtime.planAgents({
    prompt: 'Ship the proxy, review the code, and rewrite the README for launch.',
    controller
  });
  assert.ok(plan.assignments.length >= 4);
  assert.ok(plan.assignments.every((assignment) => assignment.model));
  assert.ok(plan.aggregate.criticalPathMs > 0);
  assert.ok(plan.aggregate.savingsUsd >= 0);
});
