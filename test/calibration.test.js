import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('calibrate command writes a JSON report that learn can consume', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-calibrate-'));
  try {
    const samplesPath = join(directory, 'samples.json');
    const reportPath = join(directory, 'calibration.json');
    const modelPath = join(directory, 'trained.json');
    await writeFile(samplesPath, `${JSON.stringify([
      { id: 'contrarian-writing', intent: 'writing', prompt: 'Refactor this bug stacktrace test and rewrite the launch story.' },
      { id: 'code-anchor', intent: 'code', prompt: 'Fix this TypeScript bug and add a regression test.' }
    ], null, 2)}\n`);
    const calibrate = spawnSync(process.execPath, [
      './bin/proofroute.js',
      'calibrate',
      '--file',
      samplesPath,
      '--json',
      '--out',
      reportPath
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(calibrate.status, 0, calibrate.stderr);
    assert.equal(calibrate.stdout, '');
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.samples.length, 2);
    assert.equal(report.samples[0].expectedIntent, 'writing');
    const learn = spawnSync(process.execPath, [
      './bin/proofroute.js',
      'learn',
      '--samples',
      reportPath,
      '--out',
      modelPath,
      '--epochs',
      '12',
      '--learning-rate',
      '0.8',
      '--json'
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(learn.status, 0, learn.stderr);
    const training = JSON.parse(learn.stdout);
    assert.equal(training.object, 'proofroute.intent_training');
    assert.equal(training.training.accuracyAfter, 1);
    const artifact = JSON.parse(await readFile(modelPath, 'utf8'));
    assert.equal(artifact.training.sampleCount, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
