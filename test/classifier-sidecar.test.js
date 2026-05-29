import test from 'node:test';
import assert from 'node:assert/strict';
import { ExternalClassifier } from '../src/controller/gpu-classifier.js';
import { createClassifierSidecar } from '../src/controller/sidecar-server.js';

test('classifier sidecar exposes health and classification contract', async () => {
  const sidecar = await startSidecar({ backend: 'mock-gpu', devices: '0,1', lanes: 4 });
  try {
    const health = await getJson(`${sidecar.origin}/health`);
    assert.equal(health.ok, true);
    assert.equal(health.name, 'proofroute-classifier');
    assert.equal(health.backend, 'mock-gpu');
    assert.equal(health.lanes, 4);
    assert.deepEqual(health.devices, ['0', '1']);
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
    assert.equal(intent.features.lanes, 4);
    assert.equal(intent.features.lane, 0);
    assert.equal(intent.features.device, '0');
    assert.deepEqual(intent.features.devices, ['0', '1']);
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
    assert.equal(batch.count, 3);
    assert.deepEqual(batch.data.map((intent) => intent.features.lane), [2, 3, 0]);
    assert.deepEqual(batch.data.map((intent) => intent.features.device), ['0', '1', '0']);
    assert.deepEqual(batch.data.map((intent) => intent.name), ['extraction', 'reasoning', 'writing']);
    const after = await getJson(`${sidecar.origin}/health`);
    assert.equal(after.inflight, 0);
    assert.equal(after.requests, 5);
    assert.equal(after.errors, 0);
    const metrics = await getJson(`${sidecar.origin}/metrics`);
    assert.equal(metrics.object, 'proofroute.classifier.metrics');
    assert.equal(metrics.requests, 5);
    assert.deepEqual(metrics.laneRequests, [2, 1, 1, 1]);
    assert.deepEqual(metrics.laneErrors, [0, 0, 0, 0]);
    assert.equal(metrics.laneMetrics[0].device, '0');
    assert.equal(metrics.laneMetrics[1].device, '1');
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
    assert.deepEqual(batch.data.map((intent) => intent.name), ['extraction', 'code']);
    assert.deepEqual(batch.data.map((intent) => intent.features.lane), [0, 1]);
    assert.ok(batch.data.every((intent) => intent.features.source === 'sidecar'));
    const health = await getJson(`${sidecar.origin}/health`);
    assert.equal(health.requests, 2);
    const metrics = await getJson(`${sidecar.origin}/metrics`);
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
