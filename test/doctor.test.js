import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctorReport } from '../src/agent/doctor.js';
import { demoCatalog, mergeConfig } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';
import { createClassifierSidecar } from '../src/controller/sidecar-server.js';
import { renderDoctor } from '../src/view/terminal.js';

test('doctor warns when an executable local provider is not reachable yet', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-doctor-'));
  try {
    const port = await freePort();
    const config = mergeConfig(demoCatalog(), {
      telemetry: { path: join(dir, 'events.jsonl') },
      providers: {
        local: {
          baseUrl: `http://127.0.0.1:${port}`,
          kind: 'ollama'
        }
      }
    });
    const controller = new RouteController(config);
    const report = await doctorReport({ config, controller, classifier: {}, telemetryOverride: join(dir, 'events.jsonl') });
    const upstream = report.checks.find((item) => item.id === 'upstream');
    assert.equal(report.status, 'warn');
    assert.ok(report.summary.executableModels >= 1);
    assert.equal(report.summary.classifier, 'builtin');
    assert.equal(upstream.status, 'warn');
    assert.match(renderDoctor(report), /DOCTOR/);
    assert.match(renderDoctor(report), /executable models/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('doctor verifies a healthy executable upstream', async () => {
  const upstream = await startProvider();
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-doctor-'));
  try {
    const config = mergeConfig(demoCatalog(), {
      telemetry: { path: join(dir, 'events.jsonl') },
      providers: {
        local: {
          baseUrl: upstream.origin,
          kind: 'ollama'
        }
      }
    });
    const controller = new RouteController(config);
    const report = await doctorReport({ config, controller, classifier: {}, telemetryOverride: join(dir, 'events.jsonl') });
    const check = report.checks.find((item) => item.id === 'upstream');
    assert.equal(report.status, 'pass');
    assert.equal(check.status, 'pass');
    assert.match(check.detail, /local 200/);
    assert.equal(report.summary.providerHealth.healthy, 1);
  } finally {
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('doctor verifies a healthy classifier sidecar', async () => {
  const sidecar = await startSidecar({ devices: '0,1', lanes: 2 });
  const upstream = await startProvider();
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-doctor-'));
  try {
    const config = mergeConfig(demoCatalog(), {
      telemetry: { path: join(dir, 'events.jsonl') },
      providers: {
        local: {
          baseUrl: upstream.origin,
          kind: 'ollama'
        }
      }
    });
    const controller = new RouteController(config);
    const report = await doctorReport({
      config,
      controller,
      classifier: { url: `${sidecar.origin}/classify`, timeoutMs: 200 },
      telemetryOverride: join(dir, 'events.jsonl')
    });
    const check = report.checks.find((item) => item.id === 'classifier');
    assert.equal(report.status, 'pass');
    assert.equal(check.status, 'pass');
    assert.match(check.detail, /lanes 2/);
    assert.match(check.detail, /inflight 0/);
    assert.match(check.detail, /requests 0/);
    assert.match(check.detail, /errors 0/);
    assert.match(check.detail, /devices 0,1/);
  } finally {
    await sidecar.close();
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('doctor warns when a configured classifier sidecar is unavailable', async () => {
  const upstream = await startProvider();
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-doctor-'));
  try {
    const port = await freePort();
    const config = mergeConfig(demoCatalog(), {
      telemetry: { path: join(dir, 'events.jsonl') },
      providers: {
        local: {
          baseUrl: upstream.origin,
          kind: 'ollama'
        }
      }
    });
    const controller = new RouteController(config);
    const report = await doctorReport({
      config,
      controller,
      classifier: { url: `http://127.0.0.1:${port}/classify`, timeoutMs: 10 },
      telemetryOverride: join(dir, 'events.jsonl')
    });
    const check = report.checks.find((item) => item.id === 'classifier');
    assert.equal(report.status, 'warn');
    assert.equal(check.status, 'warn');
    assert.match(check.label, /unavailable/);
  } finally {
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('doctor fails when no model is executable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-doctor-'));
  try {
    const config = {
      telemetry: { path: join(dir, 'events.jsonl') },
      providers: {
        openai: {
          baseUrl: 'https://example.test/v1'
        }
      },
      models: [
        {
          id: 'cloud-only',
          provider: 'openai',
          endpoint: '/chat/completions',
          local: false,
          contextWindow: 8192,
          inputUsdPer1M: 1,
          outputUsdPer1M: 2,
          medianLatencyMs: 100,
          throughputTokensPerSecond: 50,
          quality: { chat: 0.8 }
        }
      ]
    };
    const controller = new RouteController(config);
    const report = await doctorReport({ config, controller, classifier: {}, telemetryOverride: join(dir, 'events.jsonl') });
    assert.equal(report.status, 'fail');
    assert.ok(report.checks.some((check) => check.id === 'executable' && check.status === 'fail'));
  } finally {
    await rm(dir, { recursive: true, force: true });
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

function startProvider() {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
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

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on('error', reject);
  });
}
