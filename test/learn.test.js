import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('learn command trains from calibration report shape and exports ONNX', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-learn-'));
  try {
    const samplesPath = join(directory, 'calibration.json');
    const modelPath = join(directory, 'trained.json');
    const onnxPath = join(directory, 'trained.onnx');
    await writeFile(samplesPath, `${JSON.stringify({
      samples: [
        { id: 'contrarian-writing', expectedIntent: 'writing', actualIntent: 'code', prompt: 'Refactor this bug stacktrace test and rewrite the launch story.' },
        { id: 'code-anchor', expectedIntent: 'code', actualIntent: 'code', prompt: 'Fix this TypeScript bug and add a regression test.' }
      ],
      aggregate: {
        accuracy: 0.5
      }
    }, null, 2)}\n`);
    const json = spawnSync(process.execPath, [
      './bin/proofroute.js',
      'learn',
      '--samples',
      samplesPath,
      '--out',
      modelPath,
      '--onnx-out',
      onnxPath,
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
    assert.equal(json.status, 0, json.stderr);
    const report = JSON.parse(json.stdout);
    assert.equal(report.object, 'proofroute.intent_training');
    assert.equal(report.samples.count, 2);
    assert.equal(report.training.accuracyBefore, 0.5);
    assert.equal(report.training.accuracyAfter, 1);
    assert.equal(report.onnxOut, onnxPath);
    const artifact = JSON.parse(await readFile(modelPath, 'utf8'));
    assert.equal(artifact.training.sampleCount, 2);
    assert.ok(artifact.weights.writing.refactor > 0);
    const onnx = await readFile(onnxPath);
    assert.match(onnx.toString('latin1'), /MatMul/);
    const human = spawnSync(process.execPath, [
      './bin/proofroute.js',
      'learn',
      '--samples',
      samplesPath,
      '--out',
      join(directory, 'trained-human.json'),
      '--epochs',
      '12',
      '--learning-rate',
      '0.8'
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout, /INTENT LEARNING/);
    assert.match(human.stdout, /50\.0% -> 100\.0% accuracy/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
