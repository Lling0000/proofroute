import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordRouteEvent, readRouteEvents, recentRouteEvents, routeEventsInWindow, routeEvent, summarizeRouteEvents } from '../src/agent/telemetry.js';
import { renderStats } from '../src/view/terminal.js';

test('route telemetry records routing evidence without prompt text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-telemetry-'));
  const file = join(dir, 'events.jsonl');
  try {
    const event = routeEvent({
      decision: fakeDecision(),
      status: 200,
      requestedModel: 'proofroute/local',
      modelSwap: true,
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
    assert.equal(events[0].requestedModel, 'proofroute/local');
    assert.equal(events[0].modelSwap, true);
    assert.equal(events[0].policy, 'local');
    assert.equal(events[0].classifierBackend, 'builtin-circuit-open');
    assert.equal(events[0].classifierCircuitOpen, true);
    assert.equal(events[0].classifierFailures, 3);
    assert.equal(events[0].stream, true);
    assert.equal(events[0].cacheHit, false);
    assert.equal(events[0].fallbackUsed, false);
    assert.equal(events[0].routerLatencyMs, 0.42);
    assert.ok(Math.abs(events[0].routerOverheadPct - 0.35) < 0.000001);
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
      requestedModel: 'proofroute/local',
      modelSwap: true,
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
    assert.match(result.stdout, /Policy mix was local:1/);
    assert.match(result.stdout, /Classifier mix was builtin-circuit-open:1/);
    assert.doesNotMatch(result.stdout, /secret production prompt/);
    assert.doesNotMatch(result.stdout, /\x1b\[/);
    const svgPath = join(dir, 'proof.svg');
    const svg = spawnSync(process.execPath, ['./bin/proofroute.js', 'share', '--svg', '--file', file, '--out', svgPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(svg.status, 0, svg.stderr);
    assert.equal(svg.stdout, '');
    const svgText = await readFile(svgPath, 'utf8');
    assert.match(svgText, /^<svg/);
    assert.match(svgText, /ProofRoute/);
    assert.doesNotMatch(svgText, /secret production prompt/);
    const strictGuard = spawnSync(process.execPath, ['./bin/proofroute.js', 'prove', '--file', file, '--min-requests', '1', '--max-classifier-circuit-open', '0', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(strictGuard.status, 1, strictGuard.stderr);
    const strictReport = JSON.parse(strictGuard.stdout);
    const strictCheck = strictReport.checks.find((check) => check.id === 'classifier_circuit');
    assert.equal(strictReport.status, 'fail');
    assert.equal(strictCheck.pass, false);
    assert.equal(strictCheck.value, 1);
    const toleratedGuard = spawnSync(process.execPath, ['./bin/proofroute.js', 'prove', '--file', file, '--min-requests', '1', '--max-classifier-circuit-open', '1'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(toleratedGuard.status, 0, toleratedGuard.stderr);
    assert.match(toleratedGuard.stdout, /classifier guard/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stats command exposes recent prompt-free route receipts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-stats-ledger-'));
  const file = join(dir, 'events.jsonl');
  try {
    await recordRouteEvent(file, routeEvent({
      decision: fakeDecision(),
      status: 200,
      requestedModel: 'proofroute/local',
      modelSwap: true,
      routerDecisionMs: 0.31,
      endToEndMs: 9,
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
    await recordRouteEvent(file, routeEvent({
      decision: {
        ...fakeDecision(),
        model: {
          id: 'gpt-latest',
          provider: 'openai',
          local: false
        },
        intent: {
          name: 'writing'
        },
        policy: 'fast'
      },
      status: 200,
      requestedModel: 'proofroute/fast',
      modelSwap: true,
      routerDecisionMs: 0.44,
      endToEndMs: 14,
      stream: true
    }));
    const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'stats', '--file', file, '--json', '--recent', '1'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.recent.length, 1);
    assert.equal(report.recent[0].model, 'gpt-latest');
    assert.equal(report.recent[0].requestedModel, 'proofroute/fast');
    assert.equal(report.recent[0].modelSwap, true);
    assert.equal(report.recent[0].policy, 'fast');
    assert.equal(report.recent[0].intent, 'writing');
    assert.equal(report.recent[0].stream, true);
    assert.doesNotMatch(result.stdout, /secret production prompt/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stats command keeps valid proof visible when a ledger line is malformed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-stats-malformed-ledger-'));
  const file = join(dir, 'events.jsonl');
  try {
    await recordRouteEvent(file, routeEvent({
      decision: fakeDecision(),
      status: 200,
      requestedModel: 'proofroute/local',
      modelSwap: true,
      routerDecisionMs: 0.31,
      endToEndMs: 9,
      stream: false
    }));
    await appendFile(file, '{"prompt":"secret production prompt","apiKey":"sk-secret"\n', 'utf8');
    const json = spawnSync(process.execPath, ['./bin/proofroute.js', 'stats', '--file', file, '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(json.status, 0, json.stderr);
    const report = JSON.parse(json.stdout);
    assert.equal(report.summary.count, 1);
    assert.equal(report.ledger.records, 2);
    assert.equal(report.ledger.valid, 1);
    assert.equal(report.ledger.errorCount, 1);
    assert.equal(report.ledger.errors[0].message, 'Invalid JSONL record');
    assert.doesNotMatch(json.stdout, /secret production prompt|sk-secret/);
    const terminal = spawnSync(process.execPath, ['./bin/proofroute.js', 'stats', '--file', file], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(terminal.status, 0, terminal.stderr);
    assert.match(terminal.stdout, /ledger parse guard/);
    assert.match(terminal.stdout, /line 2/);
    assert.doesNotMatch(terminal.stdout, /secret production prompt|sk-secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stats watch can render a single live ledger pulse', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-watch-ledger-'));
  const file = join(dir, 'events.jsonl');
  try {
    await recordRouteEvent(file, routeEvent({
      decision: fakeDecision(),
      status: 200,
      requestedModel: 'proofroute/local',
      modelSwap: true,
      routerDecisionMs: 0.29,
      endToEndMs: 8,
      stream: false
    }));
    const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'stats', '--watch', '--ticks', '1', '--interval-ms', '1', '--file', file], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /live tick 1/);
    assert.match(result.stdout, /latest routes/);
    assert.doesNotMatch(result.stdout, /secret production prompt/);
    const json = spawnSync(process.execPath, ['./bin/proofroute.js', 'stats', '--watch', '--ticks', '1', '--interval-ms', '1', '--file', file, '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(json.status, 0, json.stderr);
    const report = JSON.parse(json.stdout);
    assert.equal(report.watch.tick, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ledger commands can scope proof to a current session window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-since-ledger-'));
  const file = join(dir, 'events.jsonl');
  try {
    await recordRouteEvent(file, {
      ...routeEvent({
        decision: fakeDecision(),
        status: 200,
        requestedModel: 'proofroute/local',
        modelSwap: true,
        routerDecisionMs: 0.31,
        endToEndMs: 9,
        stream: false
      }),
      ts: '2026-05-29T08:00:00.000Z'
    });
    await recordRouteEvent(file, {
      ...routeEvent({
        decision: {
          ...fakeDecision(),
          model: {
            id: 'gpt-session',
            provider: 'openai',
            local: false
          },
          intent: {
            name: 'reasoning'
          },
          policy: 'quality'
        },
        status: 200,
        requestedModel: 'proofroute/quality',
        modelSwap: true,
        routerDecisionMs: 0.41,
        endToEndMs: 13,
        stream: true
      }),
      ts: '2026-05-29T09:00:00.000Z'
    });
    const cutoff = '2026-05-29T08:30:00.000Z';
    const stats = spawnSync(process.execPath, ['./bin/proofroute.js', 'stats', '--file', file, '--json', '--since', cutoff], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(stats.status, 0, stats.stderr);
    const statsReport = JSON.parse(stats.stdout);
    assert.equal(statsReport.summary.count, 1);
    assert.equal(statsReport.window.total, 2);
    assert.equal(statsReport.window.matched, 1);
    assert.equal(statsReport.recent[0].model, 'gpt-session');
    assert.equal(statsReport.recent[0].policy, 'quality');
    const share = spawnSync(process.execPath, ['./bin/proofroute.js', 'share', '--markdown', '--file', file, '--since', cutoff], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(share.status, 0, share.stderr);
    assert.match(share.stdout, /routed 1 prompts/);
    assert.match(share.stdout, /since 2026-05-29T08:30:00.000Z/);
    const prove = spawnSync(process.execPath, ['./bin/proofroute.js', 'prove', '--file', file, '--since', cutoff, '--json', '--min-requests', '1', '--max-router-overhead-pct', '1'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(prove.status, 0, prove.stderr);
    const proofReport = JSON.parse(prove.stdout);
    assert.equal(proofReport.status, 'pass');
    assert.equal(proofReport.aggregate.count, 1);
    assert.equal(proofReport.window.matched, 1);
    assert.ok(proofReport.checks.find((check) => check.id === 'router_overhead'));
    const tune = spawnSync(process.execPath, ['./bin/proofroute.js', 'tune', '--file', file, '--since', cutoff, '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(tune.status, 0, tune.stderr);
    const tuneReport = JSON.parse(tune.stdout);
    assert.equal(tuneReport.summary.count, 1);
    assert.equal(tuneReport.window.matched, 1);
    assert.doesNotMatch(`${stats.stdout}\n${share.stdout}\n${prove.stdout}\n${tune.stdout}`, /secret production prompt/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('route telemetry summary aggregates savings and distributions', () => {
  const events = [
    {
      ts: '2026-05-29T08:00:00.000Z',
      model: 'local-a',
      provider: 'local',
      local: true,
      intent: 'code',
      policy: 'local',
      savingsUsd: 0.2,
      estimatedCostUsd: 0,
      speedup: 1.4,
      routerLatencyMs: 0.3,
      endToEndMs: 3,
      estimatedLatencyMs: 100,
      cacheHit: true,
      fallbackUsed: true,
      classifierBackend: 'builtin-circuit-open',
      classifierCircuitOpen: true,
      stream: true,
      status: 200,
      requestedModel: 'gpt-4.1',
      modelSwap: true
    },
    {
      ts: '2026-05-29T08:01:00.000Z',
      model: 'cloud-b',
      provider: 'openai',
      local: false,
      intent: 'writing',
      policy: 'save',
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
      classifierBackend: 'external-url',
      classifierCircuitOpen: false,
      stream: false,
      status: 200,
      requestedModel: 'cloud-b',
      modelSwap: false
    }
  ];
  const summary = summarizeRouteEvents(events);
  const recent = recentRouteEvents(events, 2);
  assert.equal(summary.count, 2);
  assert.equal(summary.savingsUsd, 0.20006000000000002);
  assert.equal(summary.estimatedSavingsUsd, 0.30000000000000004);
  assert.equal(summary.actualSavingsUsd, 0.00006);
  assert.equal(summary.actualCostUsd, 0.00002);
  assert.equal(summary.actualTotalTokens, 9);
  assert.equal(summary.meteredRequests, 1);
  const summaryOutput = renderStats({ path: 'events.jsonl', summary });
  assert.match(summaryOutput, /actual cost/);
  assert.match(summaryOutput, /actual tokens/);
  assert.equal(summary.local, 1);
  assert.equal(summary.cloud, 1);
  assert.equal(summary.streaming, 1);
  assert.equal(summary.cacheHits, 1);
  assert.equal(summary.fallbacks, 1);
  assert.equal(summary.modelSwaps, 1);
  assert.equal(summary.p95RouterOverheadPct, 0.4);
  assert.equal(summary.averageRouterOverheadPct, 0.35);
  assert.equal(summary.classifierCircuitOpen, 1);
  assert.equal(summary.intents.code, 1);
  assert.equal(summary.policies.local, 1);
  assert.equal(summary.policies.save, 1);
  assert.equal(summary.requestedModels['gpt-4.1'], 1);
  assert.equal(summary.requestedModels['cloud-b'], 1);
  assert.equal(summary.classifierBackends['builtin-circuit-open'], 1);
  assert.equal(summary.classifierBackends['external-url'], 1);
  assert.equal(summary.models['cloud-b'], 1);
  assert.equal(summary.p95RouterMs, 0.8);
  assert.equal(summary.p95EndToEndMs, 8);
  assert.equal(recent[0].model, 'cloud-b');
  assert.equal(recent[1].requestedModel, 'gpt-4.1');
  assert.equal(recent[1].modelSwap, true);
  assert.equal(recent[0].policy, 'save');
  assert.equal(recent[0].savingsUsd, 0.00006);
  assert.equal(recent[0].routerOverheadPct, 0.4);
  const recentOutput = renderStats({ path: 'events.jsonl', summary, recent });
  assert.match(recentOutput, /latest routes/);
  assert.match(recentOutput, /policy mix local:1, save:1/);
  assert.match(recentOutput, /classifier guard/);
  assert.match(recentOutput, /model swaps/);
  assert.match(recentOutput, /router overhead/);
  assert.match(recentOutput, /requested mix gpt-4\.1:1, cloud-b:1/);
  assert.match(recentOutput, /classifier mix builtin-circuit-open:1, external-url:1/);
  assert.match(recentOutput, /external-url/);
  assert.match(recentOutput, /cloud-b/);
  assert.match(recentOutput, /08:01:00/);
});

test('route event windows accept durations and ISO timestamps', () => {
  const events = [
    { ts: '2026-05-29T08:00:00.000Z', model: 'old' },
    { ts: '2026-05-29T09:00:00.000Z', model: 'new' }
  ];
  const duration = routeEventsInWindow(events, '30m', new Date('2026-05-29T09:15:00.000Z'));
  assert.equal(duration.events.length, 1);
  assert.equal(duration.events[0].model, 'new');
  assert.equal(duration.window.cutoff, '2026-05-29T08:45:00.000Z');
  const timestamp = routeEventsInWindow(events, '2026-05-29T08:30:00.000Z');
  assert.equal(timestamp.events.length, 1);
  assert.equal(timestamp.window.matched, 1);
  assert.throws(() => routeEventsInWindow(events, 'soon-ish'), /Invalid --since value/);
});

function fakeDecision() {
  return {
    model: {
      id: 'llama3.2:3b',
      provider: 'local',
      local: true
    },
    intent: {
      name: 'code',
      features: {
        backend: 'builtin-circuit-open',
        classifierCircuitOpen: true,
        classifierFailures: 3
      }
    },
    policy: 'local',
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
