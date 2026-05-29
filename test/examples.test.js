import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ExternalClassifier } from '../src/controller/gpu-classifier.js';
import { RouteController } from '../src/controller/route-controller.js';

test('example classifier command supports single and batch contracts', () => {
  const single = runClassifier({ prompt: 'Refactor this payment handler and add a test.' });
  assert.equal(single.name, 'code');
  assert.ok(single.confidence > 0);
  const batch = runClassifier({
    prompts: [
      'Extract invoices into JSON.',
      'Rewrite this README launch note.'
    ]
  });
  assert.deepEqual(batch.data.map((intent) => intent.name), ['extraction', 'writing']);
});

test('local OpenAI-compatible example config is executable without credentials', async () => {
  const config = JSON.parse(await readFile(join(process.cwd(), 'examples/local-openai-router.json'), 'utf8'));
  const classifier = new ExternalClassifier(config.classifier);
  const controller = new RouteController(config, classifier);
  const decision = await controller.routeAsync({
    prompt: 'Refactor this local model gateway and write a regression test.',
    executableOnly: true
  });
  assert.equal(controller.executableModels().length, 1);
  assert.equal(decision.model.provider, 'lmstudio');
  assert.equal(decision.model.local, true);
  assert.equal(decision.intent.features.backend, 'external');
});

test('init can emit the local OpenAI-compatible preset', () => {
  const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'init', '--preset', 'local-openai'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  const controller = new RouteController(config);
  assert.equal(config.providers.lmstudio.requiresApiKey, false);
  assert.equal(controller.executableModels()[0].provider, 'lmstudio');
});

test('JSON examples stay parseable', async () => {
  for (const path of ['examples/router.json', 'examples/local-openai-router.json', 'examples/samples.json']) {
    const parsed = JSON.parse(await readFile(join(process.cwd(), path), 'utf8'));
    assert.ok(parsed);
  }
});

function runClassifier(payload) {
  const result = spawnSync(process.execPath, ['examples/classifier-command.js'], {
    cwd: process.cwd(),
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
