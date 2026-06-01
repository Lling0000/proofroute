import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privacyReport } from '../src/agent/privacy.js';
import { recordRouteEvent, routeEvent } from '../src/agent/telemetry.js';
import { renderHelp, renderPrivacy } from '../src/view/terminal.js';

test('privacy proof passes on the prompt-free routing ledger', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-privacy-pass-'));
  const file = join(dir, 'events.jsonl');
  try {
    await recordRouteEvent(file, routeEvent({
      decision: fakeDecision(),
      status: 200,
      requestedModel: 'proofroute/local',
      modelSwap: true,
      routerDecisionMs: 0.33,
      endToEndMs: 9,
      stream: false,
      actualUsage: {
        inputTokens: 7,
        outputTokens: 5,
        totalTokens: 12
      },
      actualCostUsd: 0,
      actualBaselineCostUsd: 0.01,
      actualSavingsUsd: 0.01
    }));
    const report = await privacyReport(file);
    assert.equal(report.status, 'pass');
    assert.equal(report.events, 1);
    assert.equal(report.forbiddenMatchCount, 0);
    assert.equal(report.parseErrorCount, 0);
    assert.ok(report.scannedKeys > 0);
    assert.ok(report.allowedEvidenceKeys.includes('actualTotalTokens'));
    const output = renderPrivacy(report);
    assert.match(output, /PRIVACY PROOF/);
    assert.match(output, /PASS/);
    assert.match(output, /field audit/);
    assert.doesNotMatch(output, /secret production prompt/);
    assert.match(renderHelp(), /proofroute privacy/);
    const cli = spawnSync(process.execPath, ['./bin/proofroute.js', 'privacy', '--file', file, '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(cli.status, 0, cli.stderr);
    const cliReport = JSON.parse(cli.stdout);
    assert.equal(cliReport.status, 'pass');
    assert.equal(cliReport.forbiddenMatchCount, 0);
    assert.doesNotMatch(cli.stdout, /secret production prompt/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('privacy proof fails without printing prompt text or credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-privacy-fail-'));
  const file = join(dir, 'events.jsonl');
  try {
    await writeFile(file, [
      JSON.stringify({
        ts: '2026-05-29T08:00:00.000Z',
        model: 'leaky-model',
        prompt: 'secret production prompt',
        apiKey: 'sk-secret-production-key',
        nested: {
          messages: [
            {
              role: 'user',
              content: 'secret production prompt'
            }
          ]
        }
      }),
      '{"model":"broken","response":"secret production prompt"'
    ].join('\n'), 'utf8');
    const report = await privacyReport(file);
    assert.equal(report.status, 'fail');
    assert.equal(report.forbiddenMatchCount, 4);
    assert.equal(report.parseErrorCount, 1);
    assert.deepEqual(report.forbiddenMatches.map((match) => match.path), [
      '$.prompt',
      '$.apiKey',
      '$.nested.messages',
      '$.nested.messages[0].content'
    ]);
    const output = renderPrivacy(report);
    assert.match(output, /FAIL/);
    assert.match(output, /\$\.prompt/);
    assert.match(output, /Invalid JSONL record/);
    assert.doesNotMatch(output, /secret production prompt/);
    assert.doesNotMatch(output, /sk-secret-production-key/);
    const cli = spawnSync(process.execPath, ['./bin/proofroute.js', 'privacy', '--file', file, '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(cli.status, 1, cli.stderr);
    const cliReport = JSON.parse(cli.stdout);
    assert.equal(cliReport.status, 'fail');
    assert.equal(cliReport.forbiddenMatches[0].path, '$.prompt');
    assert.doesNotMatch(cli.stdout, /secret production prompt/);
    assert.doesNotMatch(cli.stdout, /sk-secret-production-key/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('privacy proof treats a missing ledger as an empty passing audit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-privacy-missing-'));
  const file = join(dir, 'missing.jsonl');
  try {
    const report = await privacyReport(file);
    assert.equal(report.status, 'pass');
    assert.equal(report.exists, false);
    assert.equal(report.events, 0);
    assert.match(renderPrivacy(report), /no records to audit/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
        backend: 'builtin'
      }
    },
    policy: 'local',
    confidence: 0.92,
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
