import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
  const sidecar = await startSidecar({
    devices: '0,1',
    deviceNames: 'RTX 4090,RTX A6000',
    deviceMemoryMb: '24576,49152',
    deviceRuntime: 'CUDA 12.4',
    deviceDriver: '550.54',
    lanes: 2
  });
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
    assert.match(check.detail, /scheduler least-inflight/);
    assert.match(check.detail, /warmed no/);
    assert.match(check.detail, /batch window 0ms/);
    assert.match(check.detail, /max batch 16/);
    assert.match(check.detail, /lanes 2/);
    assert.match(check.detail, /inflight 0/);
    assert.match(check.detail, /requests 0/);
    assert.match(check.detail, /errors 0/);
    assert.match(check.detail, /devices 0,1/);
    assert.match(check.detail, /profiles 0 RTX 4090 24576MB CUDA 12\.4 driver 550\.54/);
    const coldGate = await doctorReport({
      config,
      controller,
      classifier: { url: `${sidecar.origin}/classify`, timeoutMs: 200 },
      telemetryOverride: join(dir, 'events.jsonl'),
      requireClassifierWarmup: true
    });
    const coldCheck = coldGate.checks.find((item) => item.id === 'classifier');
    assert.equal(coldGate.status, 'fail');
    assert.equal(coldCheck.status, 'fail');
    assert.match(coldCheck.label, /cold/);
    await postJson(`${sidecar.origin}/warmup`, {});
    const warmGate = await doctorReport({
      config,
      controller,
      classifier: { url: `${sidecar.origin}/classify`, timeoutMs: 200 },
      telemetryOverride: join(dir, 'events.jsonl'),
      requireClassifierWarmup: true
    });
    const warmCheck = warmGate.checks.find((item) => item.id === 'classifier');
    assert.equal(warmGate.status, 'pass');
    assert.equal(warmCheck.status, 'pass');
    assert.match(warmCheck.detail, /warmed yes/);
  } finally {
    await sidecar.close();
    await upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('doctor strict hardware mode requires warmed nvidia-smi classifier profiles', async () => {
  const manualSidecar = await startSidecar({
    devices: '0,1',
    deviceNames: 'RTX 4090,RTX A6000',
    deviceMemoryMb: '24576,49152',
    deviceRuntime: 'CUDA 12.4',
    lanes: 2
  });
  const probedSidecar = await startSidecar({
    devices: '0,1',
    deviceProfiles: [
      { id: '0', name: 'RTX 4090', memoryMb: 24576, runtime: 'CUDA 12.4', driver: '550.54', source: 'nvidia-smi' },
      { id: '1', name: 'RTX A6000', memoryMb: 49152, runtime: 'CUDA 12.4', driver: '550.54', source: 'nvidia-smi' }
    ],
    lanes: 2
  });
  const upstream = await startProvider();
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-doctor-hardware-'));
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
    const manualReport = await doctorReport({
      config,
      controller,
      classifier: { url: `${manualSidecar.origin}/classify`, timeoutMs: 200 },
      telemetryOverride: join(dir, 'events.jsonl'),
      requireClassifierWarmup: true,
      minClassifierDevices: 2,
      minClassifierLanes: 2,
      requireClassifierHardwareProbe: true
    });
    const manualCheck = manualReport.checks.find((item) => item.id === 'classifier');
    assert.equal(manualReport.status, 'fail');
    assert.equal(manualCheck.status, 'fail');
    assert.match(manualCheck.detail, /warmup is required/);
    assert.match(manualCheck.detail, /nvidia-smi hardware profiles 0\/2/);
    assert.match(manualCheck.detail, /classifier:hardware:evidence/);
    await postJson(`${probedSidecar.origin}/warmup`, {});
    const probedReport = await doctorReport({
      config,
      controller,
      classifier: { url: `${probedSidecar.origin}/classify`, timeoutMs: 200 },
      telemetryOverride: join(dir, 'events.jsonl'),
      requireClassifierWarmup: true,
      minClassifierDevices: 2,
      minClassifierLanes: 2,
      requireClassifierHardwareProbe: true
    });
    const probedCheck = probedReport.checks.find((item) => item.id === 'classifier');
    assert.equal(probedReport.status, 'pass');
    assert.equal(probedCheck.status, 'pass');
    assert.match(probedCheck.detail, /nvidia-smi profiles 2/);
    assert.equal(probedCheck.metadata.hardwareProbeProfileCount, 2);
  } finally {
    await manualSidecar.close();
    await probedSidecar.close();
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

test('doctor probes env local OpenAI-compatible gateway through models endpoint', async () => {
  const upstream = await startOpenAICompatibleProvider();
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-doctor-'));
  try {
    const result = await runCli(['./bin/proofroute.js', 'doctor'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_LOCAL_OPENAI_BASE_URL: upstream.origin,
        PROOFROUTE_LOCAL_OPENAI_MODEL: 'studio-doctor',
        PROOFROUTE_TELEMETRY: join(dir, 'events.jsonl')
      },
      timeout: 2000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /localOpenai 200/);
    const required = await runCli(['./bin/proofroute.js', 'doctor', '--require-warmup', '--json'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_LOCAL_OPENAI_BASE_URL: upstream.origin,
        PROOFROUTE_LOCAL_OPENAI_MODEL: 'studio-doctor',
        PROOFROUTE_TELEMETRY: join(dir, 'events.jsonl')
      },
      timeout: 2000
    });
    assert.equal(required.status, 1);
    const requiredReport = JSON.parse(required.stdout);
    const requiredCheck = requiredReport.checks.find((item) => item.id === 'classifier');
    assert.equal(requiredCheck.status, 'fail');
    assert.match(requiredCheck.detail, /sidecar/);
    assert.match(requiredCheck.detail, /classifier --warmup/);
    const hardware = await runCli(['./bin/proofroute.js', 'doctor', '--strict-hardware', '--json'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_LOCAL_OPENAI_BASE_URL: upstream.origin,
        PROOFROUTE_LOCAL_OPENAI_MODEL: 'studio-doctor',
        PROOFROUTE_TELEMETRY: join(dir, 'events.jsonl')
      },
      timeout: 2000
    });
    assert.equal(hardware.status, 1);
    const hardwareReport = JSON.parse(hardware.stdout);
    const hardwareCheck = hardwareReport.checks.find((item) => item.id === 'classifier');
    assert.equal(hardwareCheck.status, 'fail');
    assert.match(hardwareCheck.detail, /2 devices/);
    assert.match(hardwareCheck.detail, /nvidia-smi hardware profiles/);
    assert.match(hardwareCheck.detail, /classifier:hardware:evidence/);
    assert.deepEqual(upstream.requests, ['/models', '/models', '/models']);
  } finally {
    await upstream.close();
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

function startOpenAICompatibleProvider() {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (req.method === 'GET' && req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
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
        requests,
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

function runCli(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Command timed out: ${args.join(' ')}`));
    }, options.timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}
