import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRuntime } from '../src/agent/runtime.js';
import { demoCatalog } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';

test('calibration reports accuracy, savings, and routing latency', async () => {
  const config = demoCatalog();
  const runtime = new AgentRuntime(config);
  const controller = new RouteController(config);
  const report = await runtime.calibrate({
    controller,
    samples: [
      { id: 'code', intent: 'code', prompt: 'Fix this TypeScript bug and add a regression test.' },
      { id: 'extract', intent: 'extraction', prompt: 'Extract names and totals into strict JSON.' }
    ]
  });
  assert.equal(report.aggregate.count, 2);
  assert.ok(report.aggregate.accuracy >= 0.5);
  assert.ok(report.aggregate.savingsUsd >= 0);
  assert.ok(report.aggregate.p95RouterMs > 0);
  assert.ok(report.aggregate.models[report.samples[0].model] >= 1);
});
