import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { ExternalClassifier } from '../src/controller/gpu-classifier.js';
import { createClassifierSidecar } from '../src/controller/sidecar-server.js';

test('classifier sidecar exposes health and classification contract', async () => {
  const sidecar = await startSidecar({
    backend: 'mock-gpu',
    devices: '0,1',
    deviceNames: 'RTX 4090,RTX A6000',
    deviceMemoryMb: '24576,49152',
    deviceRuntime: 'CUDA 12.4',
    deviceDriver: '550.54',
    lanes: 4
  });
  try {
    const health = await getJson(`${sidecar.origin}/health`);
    assert.equal(health.ok, true);
    assert.equal(health.name, 'proofroute-classifier');
    assert.equal(health.backend, 'mock-gpu');
    assert.equal(health.scheduler, 'least-inflight');
    assert.equal(health.batchWindowMs, 0);
    assert.equal(health.maxBatchSize, 16);
    assert.equal(health.requireWarmup, false);
    assert.equal(health.pendingBatch, 0);
    assert.equal(health.batches, 0);
    assert.equal(health.microBatches, 0);
    assert.equal(health.warmed, false);
    assert.equal(health.warmups, 0);
    assert.equal(health.warmupRequests, 0);
    assert.equal(health.lanes, 4);
    assert.deepEqual(health.devices, ['0', '1']);
    assert.deepEqual(health.deviceProfiles, [
      { id: '0', name: 'RTX 4090', memoryMb: 24576, runtime: 'CUDA 12.4', driver: '550.54' },
      { id: '1', name: 'RTX A6000', memoryMb: 49152, runtime: 'CUDA 12.4', driver: '550.54' }
    ]);
    assert.equal(health.inflight, 0);
    assert.deepEqual(health.laneInflight, [0, 0, 0, 0]);
    assert.equal(health.requests, 0);
    assert.equal(health.errors, 0);
    assert.equal(typeof health.uptimeMs, 'number');
    const intent = await postJson(`${sidecar.origin}/classify`, {
      prompt: 'Refactor this payment function, explain the stacktrace, and add a regression test.'
    });
    assert.equal(intent.name, 'code');
    assert.equal(intent.features.backend, 'mock-gpu');
    assert.equal(intent.features.source, 'sidecar');
    assert.equal(intent.features.scheduler, 'least-inflight');
    assert.equal(intent.features.batchMode, 'single');
    assert.equal(intent.features.batchSize, 1);
    assert.equal(intent.features.lanes, 4);
    assert.equal(intent.features.lane, 0);
    assert.equal(intent.features.device, '0');
    assert.deepEqual(intent.features.devices, ['0', '1']);
    assert.deepEqual(intent.features.deviceProfile, { id: '0', name: 'RTX 4090', memoryMb: 24576, runtime: 'CUDA 12.4', driver: '550.54' });
    assert.equal(intent.features.requests, 1);
    assert.equal(typeof intent.features.decisionMs, 'number');
    assert.ok(intent.ranked.length > 0);
    const secondIntent = await postJson(`${sidecar.origin}/classify`, {
      prompt: 'Rewrite this README launch copy so the result is concise and vivid.'
    });
    assert.equal(secondIntent.features.lane, 1);
    assert.equal(secondIntent.features.device, '1');
    assert.equal(secondIntent.features.requests, 2);
    const batch = await postJson(`${sidecar.origin}/classify/batch`, {
      prompts: [
        'Extract customer ids and invoice totals into JSON.',
        'Compare these algorithms and explain the tradeoffs.',
        'Write launch copy for the README.'
      ]
    });
    assert.equal(batch.object, 'list');
    assert.equal(batch.scheduler, 'least-inflight');
    assert.equal(batch.batchMode, 'single');
    assert.equal(batch.count, 3);
    assert.deepEqual(batch.deviceProfiles.map((profile) => profile.name), ['RTX 4090', 'RTX A6000']);
    assert.deepEqual(batch.data.map((intent) => intent.features.lane), [2, 3, 0]);
    assert.deepEqual(batch.data.map((intent) => intent.features.device), ['0', '1', '0']);
    assert.deepEqual(batch.data.map((intent) => intent.name), ['extraction', 'reasoning', 'writing']);
    const after = await getJson(`${sidecar.origin}/health`);
    assert.equal(after.inflight, 0);
    assert.equal(after.requests, 5);
    assert.equal(after.errors, 0);
    const metrics = await getJson(`${sidecar.origin}/metrics`);
    assert.equal(metrics.object, 'proofroute.classifier.metrics');
    assert.equal(metrics.scheduler, 'least-inflight');
    assert.equal(metrics.batches, 0);
    assert.equal(metrics.microBatches, 0);
    assert.equal(metrics.requests, 5);
    assert.deepEqual(metrics.laneRequests, [2, 1, 1, 1]);
    assert.deepEqual(metrics.laneErrors, [0, 0, 0, 0]);
    assert.equal(metrics.laneMetrics[0].device, '0');
    assert.equal(metrics.laneMetrics[1].device, '1');
    assert.deepEqual(metrics.laneMetrics[0].deviceProfile, { id: '0', name: 'RTX 4090', memoryMb: 24576, runtime: 'CUDA 12.4', driver: '550.54' });
    assert.deepEqual(metrics.laneMetrics[1].deviceProfile, { id: '1', name: 'RTX A6000', memoryMb: 49152, runtime: 'CUDA 12.4', driver: '550.54' });
    assert.ok(metrics.laneMetrics.every((lane) => lane.averageDecisionMs >= 0));
    assert.ok(metrics.laneMetrics.every((lane) => lane.maxDecisionMs >= 0));
    const invalid = await fetch(`${sidecar.origin}/classify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{'
    });
    assert.equal(invalid.status, 400);
  } finally {
    await sidecar.close();
  }
});

test('classifier sidecar warms the accelerator path without echoing prompts', async () => {
  const sidecar = await startSidecar({ backend: 'warm-gpu', lanes: 2 });
  try {
    const warmup = await postJson(`${sidecar.origin}/warmup`, {
      prompts: [
        'secret warmup prompt about code',
        'secret warmup prompt about JSON'
      ]
    });
    assert.equal(warmup.object, 'proofroute.classifier.warmup');
    assert.equal(warmup.ok, true);
    assert.equal(warmup.backend, 'warm-gpu');
    assert.equal(warmup.count, 2);
    assert.equal(typeof warmup.elapsedMs, 'number');
    assert.deepEqual(warmup.intents.map((intent) => intent.batchMode), ['single', 'single']);
    assert.doesNotMatch(JSON.stringify(warmup), /secret warmup prompt/);
    const health = await getJson(`${sidecar.origin}/health`);
    assert.equal(health.warmed, true);
    assert.equal(health.warmups, 1);
    assert.equal(health.warmupRequests, 2);
    assert.equal(health.requests, 2);
    const metrics = await getJson(`${sidecar.origin}/metrics`);
    assert.equal(metrics.warmed, true);
    assert.equal(metrics.lastWarmupMs, health.lastWarmupMs);
  } finally {
    await sidecar.close();
  }
});

test('classifier sidecar readiness can require warmup before traffic', async () => {
  const sidecar = await startSidecar({ backend: 'ready-gpu', requireWarmup: true });
  try {
    const coldResponse = await fetch(`${sidecar.origin}/ready`);
    assert.equal(coldResponse.status, 503);
    const cold = await coldResponse.json();
    assert.equal(cold.object, 'proofroute.classifier.ready');
    assert.equal(cold.ok, false);
    assert.equal(cold.ready, false);
    assert.equal(cold.requireWarmup, true);
    assert.equal(cold.warmed, false);
    await postJson(`${sidecar.origin}/warmup`, {});
    const ready = await getJson(`${sidecar.origin}/ready`);
    assert.equal(ready.ok, true);
    assert.equal(ready.ready, true);
    assert.equal(ready.warmed, true);
    assert.equal(ready.warmups, 1);
  } finally {
    await sidecar.close();
  }
});

test('classifier sidecar CLI can warm immediately after startup', async () => {
  const child = spawn(process.execPath, ['./bin/proofroute-classifier.js', '--port', '0', '--warmup', '--backend', 'cli-warm'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const output = await waitForOutput(child, /warmed 3 prompts through cli-warm/);
    assert.match(output, /listening/);
    assert.doesNotMatch(output, /Refactor this function/);
  } finally {
    child.kill('SIGTERM');
    await waitForExit(child);
  }
});

test('classifier sidecar CLI can launch the linear artifact worker directly', async () => {
  const child = spawn(process.execPath, [
    './bin/proofroute-classifier.js',
    '--port',
    '0',
    '--warmup',
    '--require-warmup',
    '--backend',
    'linear-artifact',
    '--lanes',
    '2',
    '--devices',
    '0,1',
    '--device-names',
    'RTX 4090,RTX A6000',
    '--device-memory-mb',
    '24576,49152',
    '--device-runtime',
    'CUDA 12.4',
    '--device-driver',
    '550.54',
    '--scheduler',
    'least-inflight',
    '--batch-window-ms',
    '0',
    '--max-batch-size',
    '16',
    '--persistent-command',
    'node ./examples/accelerator-worker.js',
    '--accelerator-module',
    'examples/linear-accelerator-module.js',
    '--accelerator-model',
    'examples/linear-intent-model.json'
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const output = await waitForOutput(child, /warmed 3 prompts through linear-artifact/);
    assert.match(output, /listening/);
    assert.match(output, /linear-artifact/);
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/classify/);
    assert.ok(match);
    const origin = `http://127.0.0.1:${match[1]}`;
    const health = await getJson(`${origin}/health`);
    assert.equal(health.deviceProfiles[0].name, 'RTX 4090');
    assert.equal(health.deviceProfiles[1].memoryMb, 49152);
    const batch = await postJson(`${origin}/classify/batch`, {
      prompts: [
        'Refactor the TypeScript webhook and add a regression test.',
        'Extract invoice totals into JSON rows.',
        'Rewrite the launch memo in a sharper tone.',
        'Compare routing algorithms and reason about latency tradeoffs.'
      ]
    });
    assert.equal(batch.object, 'list');
    assert.equal(batch.count, 4);
    assert.equal(batch.batchMode, 'explicit');
    assert.deepEqual(batch.data.map((intent) => intent.name), ['code', 'extraction', 'writing', 'reasoning']);
    assert.deepEqual(batch.data.map((intent) => intent.features.adapter), [
      'linear-accelerator-module',
      'linear-accelerator-module',
      'linear-accelerator-module',
      'linear-accelerator-module'
    ]);
    assert.deepEqual(batch.data.map((intent) => intent.features.artifact), [
      'proofroute-linear-intent-v1',
      'proofroute-linear-intent-v1',
      'proofroute-linear-intent-v1',
      'proofroute-linear-intent-v1'
    ]);
    const devices = batch.data.map((intent) => intent.features.device);
    const moduleDevices = batch.data.map((intent) => intent.features.moduleDevice);
    const lanes = batch.data.map((intent) => intent.features.lane);
    assert.deepEqual([...devices].sort(), ['0', '0', '1', '1']);
    assert.deepEqual([...moduleDevices].sort(), ['0', '0', '1', '1']);
    assert.deepEqual([...lanes].sort((a, b) => a - b), [0, 0, 1, 1]);
    assert.ok(alternates(devices));
    assert.ok(alternates(moduleDevices));
    assert.ok(alternates(lanes));
    assert.deepEqual(batch.data.map((intent) => intent.features.warmed), [true, true, true, true]);
    assert.doesNotMatch(JSON.stringify(batch), /launch memo/);
  } finally {
    child.kill('SIGTERM');
    await waitForExit(child);
  }
});

test('linear accelerator sidecar launcher script boots the artifact worker', async () => {
  const child = spawn('sh', ['examples/linear-accelerator-sidecar.sh'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_CLASSIFIER_PORT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const output = await waitForOutput(child, /warmed 3 prompts through linear-artifact/);
    assert.match(output, /listening/);
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/classify/);
    assert.ok(match);
    const origin = `http://127.0.0.1:${match[1]}`;
    const batch = await postJson(`${origin}/classify/batch`, {
      prompts: [
        'Refactor the TypeScript webhook and add a regression test.',
        'Extract invoice totals into JSON rows.',
        'Rewrite the launch memo in a sharper tone.',
        'Compare routing algorithms and reason about latency tradeoffs.'
      ]
    });
    assert.equal(batch.object, 'list');
    assert.equal(batch.count, 4);
    assert.deepEqual([...new Set(batch.data.map((intent) => intent.features.device))].sort(), ['0', '1']);
    assert.deepEqual([...new Set(batch.data.map((intent) => intent.features.moduleDevice))].sort(), ['0', '1']);
    assert.ok(batch.data.every((intent) => intent.features.artifact === 'proofroute-linear-intent-v1'));
  } finally {
    child.kill('SIGTERM');
    await waitForExit(child);
  }
});

test('linear local sidecar launcher proves a manual CPU artifact profile', async () => {
  const child = spawn('sh', ['examples/linear-local-classifier-sidecar.sh'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_CLASSIFIER_PORT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const output = await waitForOutput(child, /warmed 3 prompts through linear-local-artifact/);
    assert.match(output, /listening/);
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/classify/);
    assert.ok(match);
    const origin = `http://127.0.0.1:${match[1]}`;
    const health = await getJson(`${origin}/health`);
    assert.deepEqual(health.devices, ['cpu']);
    assert.equal(health.deviceProfiles[0].source, 'manual');
    assert.equal(health.deviceProfiles[0].runtime, 'node');
    const batch = await postJson(`${origin}/classify/batch`, {
      prompts: [
        'Refactor the TypeScript webhook and add a regression test.',
        'Extract invoice totals into JSON rows.'
      ]
    });
    assert.equal(batch.object, 'list');
    assert.deepEqual([...new Set(batch.data.map((intent) => intent.features.device))], ['cpu']);
    assert.deepEqual([...new Set(batch.data.map((intent) => intent.features.moduleDevice))], ['cpu']);
    assert.ok(batch.data.every((intent) => intent.features.artifact === 'proofroute-linear-intent-v1'));
    assert.doesNotMatch(JSON.stringify(batch), /invoice totals/);
  } finally {
    child.kill('SIGTERM');
    await waitForExit(child);
  }
});

test('ONNX accelerator sidecar launcher script boots with an ORT-like runtime', async () => {
  const child = spawn('sh', ['examples/onnx-accelerator-sidecar.sh'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_CLASSIFIER_PORT: '0',
      PROOFROUTE_CLASSIFIER_BACKEND: 'onnx-runtime',
      PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200',
      PROOFROUTE_ONNX_RUNTIME_PACKAGE: '../test/fixtures/mock-onnx-runtime.js',
      PROOFROUTE_ONNX_MODEL: '',
      PROOFROUTE_ACCELERATOR_MODEL: '',
      PROOFROUTE_ONNX_EXECUTION_PROVIDERS: 'cuda,cpu'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const output = await waitForOutput(child, /warmed 3 prompts through onnx-runtime/);
    assert.match(output, /listening/);
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/classify/);
    assert.ok(match);
    const origin = `http://127.0.0.1:${match[1]}`;
    const batch = await postJson(`${origin}/classify/batch`, {
      prompts: [
        'Refactor the TypeScript webhook and add a regression test.',
        'Extract invoice totals into JSON rows.',
        'Rewrite the launch memo in a sharper tone.',
        'Compare routing algorithms and reason about latency tradeoffs.'
      ]
    });
    assert.equal(batch.object, 'list');
    assert.equal(batch.count, 4);
    assert.deepEqual(batch.data.map((intent) => intent.name), ['code', 'extraction', 'writing', 'reasoning']);
    assert.deepEqual(batch.data.map((intent) => intent.features.adapter), [
      'onnx-accelerator-module',
      'onnx-accelerator-module',
      'onnx-accelerator-module',
      'onnx-accelerator-module'
    ]);
    assert.deepEqual(batch.data.map((intent) => intent.features.model), [
      'linear-intent-model.onnx',
      'linear-intent-model.onnx',
      'linear-intent-model.onnx',
      'linear-intent-model.onnx'
    ]);
    assert.deepEqual(batch.data.map((intent) => intent.features.executionProviders.join(',')), ['cuda,cpu', 'cuda,cpu', 'cuda,cpu', 'cuda,cpu']);
    assert.deepEqual([...new Set(batch.data.map((intent) => intent.features.device))].sort(), ['0', '1']);
    assert.deepEqual(batch.data.map((intent) => intent.features.warmed), [true, true, true, true]);
    assert.doesNotMatch(JSON.stringify(batch), /launch memo/);
  } finally {
    child.kill('SIGTERM');
    await waitForExit(child);
  }
});

test('classifier sidecar microbatches concurrent single-prompt requests for batch backends', async () => {
  const calls = [];
  const sidecar = await startSidecar({
    lanes: 4,
    devices: '0,1',
    batchWindowMs: 50,
    maxBatchSize: 2,
    classify() {
      throw new Error('single classifier should not run when microbatching is active');
    },
    async classifyMany(prompts, metadata) {
      calls.push({ prompts, metadata });
      return prompts.map((prompt) => ({
        name: prompt.includes('JSON') ? 'extraction' : 'code',
        confidence: 0.97,
        ranked: [],
        features: {}
      }));
    }
  });
  try {
    const firstRequest = postJson(`${sidecar.origin}/classify`, { prompt: 'Refactor this failing test.' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondRequest = postJson(`${sidecar.origin}/classify`, { prompt: 'Extract invoice totals into JSON.' });
    const [first, second] = await Promise.all([firstRequest, secondRequest]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].prompts, [
      'Refactor this failing test.',
      'Extract invoice totals into JSON.'
    ]);
    assert.equal(calls[0].metadata.batchMode, 'microbatch');
    assert.equal(calls[0].metadata.batchSize, 2);
    assert.equal(calls[0].metadata.maxBatchSize, 2);
    assert.deepEqual(calls[0].metadata.items.map((item) => item.lane), [0, 1]);
    assert.equal(first.name, 'code');
    assert.equal(second.name, 'extraction');
    assert.equal(first.features.batchMode, 'microbatch');
    assert.equal(second.features.batchMode, 'microbatch');
    assert.equal(first.features.batchSize, 2);
    assert.equal(second.features.batchSize, 2);
    assert.deepEqual([first.features.lane, second.features.lane], [0, 1]);
    const metrics = await getJson(`${sidecar.origin}/metrics`);
    assert.equal(metrics.requests, 2);
    assert.equal(metrics.batches, 1);
    assert.equal(metrics.microBatches, 1);
    assert.equal(metrics.averageBatchSize, 2);
    assert.equal(metrics.maxObservedBatchSize, 2);
    assert.deepEqual(metrics.laneRequests, [1, 1, 0, 0]);
  } finally {
    await sidecar.close();
  }
});

test('classifier sidecar sends new work to the least busy lane', async () => {
  let releaseSlow = () => {};
  let slowStarted = () => {};
  const slowStartedPromise = new Promise((resolve) => {
    slowStarted = resolve;
  });
  const slowGate = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  const sidecar = await startSidecar({
    lanes: 2,
    async classify(prompt, context) {
      if (prompt === 'slow') {
        slowStarted(context);
        await slowGate;
      }
      return {
        name: 'chat',
        confidence: 0.99,
        ranked: [],
        features: {}
      };
    }
  });
  try {
    const slow = postJson(`${sidecar.origin}/classify`, { prompt: 'slow' });
    const slowContext = await slowStartedPromise;
    assert.equal(slowContext.lane, 0);
    const firstFast = await postJson(`${sidecar.origin}/classify`, { prompt: 'fast-one' });
    assert.equal(firstFast.features.lane, 1);
    const secondFast = await postJson(`${sidecar.origin}/classify`, { prompt: 'fast-two' });
    assert.equal(secondFast.features.scheduler, 'least-inflight');
    assert.equal(secondFast.features.lane, 1);
    releaseSlow();
    const slowIntent = await slow;
    assert.equal(slowIntent.features.lane, 0);
    const metrics = await getJson(`${sidecar.origin}/metrics`);
    assert.deepEqual(metrics.laneRequests, [1, 2]);
  } finally {
    releaseSlow();
    await sidecar.close();
  }
});

test('external URL classifier can consume the reference sidecar', async () => {
  const sidecar = await startSidecar({ lanes: 2 });
  try {
    const classifier = new ExternalClassifier({ url: `${sidecar.origin}/classify`, timeoutMs: 200 });
    const intent = await classifier.classifyAsync('Rewrite this README launch copy so it is sharper and easier to share.');
    assert.equal(intent.name, 'writing');
    assert.equal(intent.features.backend, 'external-url');
    assert.equal(intent.features.source, 'sidecar');
    assert.equal(intent.features.lanes, 2);
    assert.equal(intent.features.lane, 0);
    const intents = await classifier.classifyMany([
      'Extract invoices into JSON.',
      'Refactor this flaky test and explain the stacktrace.'
    ]);
    assert.deepEqual(intents.map((entry) => entry.name), ['extraction', 'code']);
    assert.deepEqual(intents.map((entry) => entry.features.lane), [1, 0]);
  } finally {
    await sidecar.close();
  }
});

test('classifier sidecar can call a batch backend once', async () => {
  let calls = 0;
  const sidecar = await startSidecar({
    lanes: 3,
    classify() {
      throw new Error('single classifier should not run for batch');
    },
    async classifyMany(prompts) {
      calls += 1;
      return prompts.map((prompt) => ({
        name: prompt.includes('JSON') ? 'extraction' : 'code',
        confidence: 0.98,
        ranked: [],
        features: { source: 'batch-backend' }
      }));
    }
  });
  try {
    const batch = await postJson(`${sidecar.origin}/classify/batch`, {
      prompts: [
        'Extract invoices into JSON.',
        'Refactor this flaky test.'
      ]
    });
    assert.equal(calls, 1);
    assert.equal(batch.batchMode, 'explicit');
    assert.deepEqual(batch.data.map((intent) => intent.name), ['extraction', 'code']);
    assert.deepEqual(batch.data.map((intent) => intent.features.lane), [0, 1]);
    assert.deepEqual(batch.data.map((intent) => intent.features.batchMode), ['explicit', 'explicit']);
    assert.deepEqual(batch.data.map((intent) => intent.features.batchSize), [2, 2]);
    assert.ok(batch.data.every((intent) => intent.features.source === 'sidecar'));
    const health = await getJson(`${sidecar.origin}/health`);
    assert.equal(health.requests, 2);
    const metrics = await getJson(`${sidecar.origin}/metrics`);
    assert.equal(metrics.batches, 1);
    assert.equal(metrics.microBatches, 0);
    assert.equal(metrics.averageBatchSize, 2);
    assert.deepEqual(metrics.laneRequests, [1, 1, 0]);
  } finally {
    await sidecar.close();
  }
});

test('classifier sidecar metrics count backend failures without prompt text', async () => {
  const sidecar = await startSidecar({
    lanes: 2,
    async classify() {
      throw new Error('classifier backend failed');
    }
  });
  try {
    const response = await fetch(`${sidecar.origin}/classify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ prompt: 'secret prompt that must not be reflected' })
    });
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.doesNotMatch(JSON.stringify(payload), /secret prompt/);
    const metrics = await getJson(`${sidecar.origin}/metrics`);
    assert.equal(metrics.requests, 1);
    assert.equal(metrics.errors, 1);
    assert.deepEqual(metrics.laneRequests, [1, 0]);
    assert.deepEqual(metrics.laneErrors, [1, 0]);
    assert.doesNotMatch(JSON.stringify(metrics), /secret prompt/);
  } finally {
    await sidecar.close();
  }
});

function startSidecar(options) {
  const server = createClassifierSidecar(options);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200);
  return response.json();
}

function waitForOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${pattern}. Output: ${output}`));
    }, 2000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (!pattern.test(output)) return;
      cleanup();
      resolve(output);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Process exited with ${code}. Output: ${output}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', resolve);
  });
}

function alternates(values) {
  return values.length > 1 && values.every((value, index, array) => index === 0 || value !== array[index - 1]);
}
