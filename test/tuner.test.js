import test from 'node:test';
import assert from 'node:assert/strict';
import { exportTunedConfig, tuneFromEvents } from '../src/agent/tuner.js';
import { renderTune } from '../src/view/terminal.js';

test('tuner keeps current policy when no telemetry exists', () => {
  const report = tuneFromEvents([], { router: { policy: 'balanced' } });
  assert.equal(report.recommendedPolicy, 'balanced');
  assert.equal(report.confidence, 0.1);
  assert.deepEqual(report.routerPatch, { policy: 'balanced' });
});

test('tuner recommends save policy for cloud-heavy low-savings traffic', () => {
  const events = Array.from({ length: 8 }, (_, index) => ({
    model: `cloud-${index % 2}`,
    provider: 'openai',
    local: false,
    intent: 'chat',
    savingsUsd: 0.00001,
    estimatedCostUsd: 0.002,
    speedup: 1.1,
    routerLatencyMs: 0.8,
    endToEndMs: 300,
    estimatedLatencyMs: 250,
    stream: index % 2 === 0,
    status: 200
  }));
  const report = tuneFromEvents(events, { router: { policy: 'balanced', costPenaltyUsd: 0.00035 } });
  assert.equal(report.recommendedPolicy, 'save');
  assert.ok(report.routerPatch.costPenaltyUsd < 0.00035);
  assert.ok(report.confidence >= 0.58);
  assert.match(renderTune({ path: 'events.jsonl', ...report }), /balanced -> save/);
});

test('tuner export merges router patch without telemetry-only metadata', () => {
  const config = {
    router: {
      policy: 'balanced',
      costPenaltyUsd: 0.00035,
      qualityWeight: 2.1
    },
    models: [{ id: 'keep-me' }]
  };
  const tuned = exportTunedConfig(config, {
    routerPatch: {
      policy: 'save',
      costPenaltyUsd: 0.00028,
      streamingObserved: true
    }
  });
  assert.equal(tuned.router.policy, 'save');
  assert.equal(tuned.router.costPenaltyUsd, 0.00028);
  assert.equal(tuned.router.qualityWeight, 2.1);
  assert.equal(tuned.router.streamingObserved, undefined);
  assert.equal(tuned.models[0].id, 'keep-me');
});
