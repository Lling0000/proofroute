import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordRouteEvent, readRouteEvents, routeEvent, summarizeRouteEvents } from '../src/agent/telemetry.js';
import { renderStats } from '../src/view/terminal.js';

test('route telemetry records routing evidence without prompt text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-telemetry-'));
  const file = join(dir, 'events.jsonl');
  try {
    const event = routeEvent({
      decision: fakeDecision(),
      status: 200,
      routerDecisionMs: 0.42,
      endToEndMs: 10.5,
      stream: true,
      actualUsage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18
      },
      actualCostUsd: 0,
      actualBaselineCostUsd: 0.02,
      actualSavingsUsd: 0.02
    });
    await recordRouteEvent(file, event);
    const raw = await readFile(file, 'utf8');
    assert.doesNotMatch(raw, /secret production prompt/);
    const events = await readRouteEvents(file);
    assert.equal(events.length, 1);
    assert.equal(events[0].model, 'llama3.2:3b');
    assert.equal(events[0].stream, true);
    assert.equal(events[0].cacheHit, false);
    assert.equal(events[0].fallbackUsed, false);
    assert.equal(events[0].routerLatencyMs, 0.42);
    assert.equal(events[0].endToEndMs, 10.5);
    assert.equal(events[0].actualInputTokens, 11);
    assert.equal(events[0].actualOutputTokens, 7);
    assert.equal(events[0].actualSavingsUsd, 0.02);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('share command can render a private ledger as markdown proof', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-share-ledger-'));
  const file = join(dir, 'events.jsonl');
  try {
    await recordRouteEvent(file, routeEvent({
      decision: fakeDecision(),
      status: 200,
      routerDecisionMs: 0.52,
      endToEndMs: 12,
      stream: false,
      actualUsage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18
      },
      actualCostUsd: 0,
      actualBaselineCostUsd: 0.02,
      actualSavingsUsd: 0.02
    }));
    const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'share', '--markdown', '--file', file], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /local telemetry ledger/);
    assert.match(result.stdout, /\$0\.020000 estimated savings/);
    assert.doesNotMatch(result.stdout, /secret production prompt/);
    assert.doesNotMatch(result.stdout, /\x1b\[/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('route telemetry summary aggregates savings and distributions', () => {
  const events = [
    {
      model: 'local-a',
      provider: 'local',
      local: true,
      intent: 'code',
      savingsUsd: 0.2,
      estimatedCostUsd: 0,
      speedup: 1.4,
      routerLatencyMs: 0.3,
      endToEndMs: 3,
      estimatedLatencyMs: 100,
      cacheHit: true,
      fallbackUsed: true,
      stream: true,
      status: 200
    },
    {
      model: 'cloud-b',
      provider: 'openai',
      local: false,
      intent: 'writing',
      savingsUsd: 0.1,
      estimatedCostUsd: 0.02,
      actualInputTokens: 5,
      actualOutputTokens: 4,
      actualTotalTokens: 9,
      actualCostUsd: 0.00002,
      actualBaselineCostUsd: 0.00008,
      actualSavingsUsd: 0.00006,
      speedup: 2,
      routerLatencyMs: 0.8,
      endToEndMs: 8,
      estimatedLatencyMs: 200,
      stream: false,
      status: 200
    }
  ];
  const summary = summarizeRouteEvents(events);
  assert.equal(summary.count, 2);
  assert.equal(summary.savingsUsd, 0.20006000000000002);
  assert.equal(summary.estimatedSavingsUsd, 0.30000000000000004);
  assert.equal(summary.actualSavingsUsd, 0.00006);
  assert.equal(summary.actualCostUsd, 0.00002);
  assert.equal(summary.actualTotalTokens, 9);
  assert.equal(summary.meteredRequests, 1);
  const output = renderStats({ path: 'events.jsonl', summary });
  assert.match(output, /actual cost/);
  assert.match(output, /actual tokens/);
  assert.equal(summary.local, 1);
  assert.equal(summary.cloud, 1);
  assert.equal(summary.streaming, 1);
  assert.equal(summary.cacheHits, 1);
  assert.equal(summary.fallbacks, 1);
  assert.equal(summary.intents.code, 1);
  assert.equal(summary.models['cloud-b'], 1);
  assert.equal(summary.p95RouterMs, 0.8);
  assert.equal(summary.p95EndToEndMs, 8);
});

function fakeDecision() {
  return {
    model: {
      id: 'llama3.2:3b',
      provider: 'local',
      local: true
    },
    intent: {
      name: 'code'
    },
    confidence: 0.91,
    inputTokens: 13,
    outputTokens: 21,
    economics: {
      estimatedCostUsd: 0,
      savingsUsd: 0.03
    },
    performance: {
      speedup: 1.7,
      estimatedLatencyMs: 120
    },
    prompt: 'secret production prompt'
  };
}
