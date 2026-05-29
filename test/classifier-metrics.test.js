import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { classifierMetricsReport } from '../src/agent/doctor.js';
import { createClassifierSidecar } from '../src/controller/sidecar-server.js';
import { renderClassifierMetrics, renderHelp } from '../src/view/terminal.js';

test('classifier metrics command renders sidecar accelerator proof', async () => {
  const sidecar = await startSidecar({ backend: 'mock-gpu', devices: '0,1', lanes: 2 });
  try {
    await postJson(`${sidecar.origin}/classify`, { prompt: 'Refactor this webhook and add a regression test.' });
    await postJson(`${sidecar.origin}/classify`, { prompt: 'Extract customer ids into JSON.' });
    const report = await classifierMetricsReport({
      classifier: { url: `${sidecar.origin}/classify`, timeoutMs: 200 }
    });
    assert.equal(report.status, 'pass');
    assert.equal(report.metrics.backend, 'mock-gpu');
    assert.equal(report.metrics.requests, 2);
    assert.deepEqual(report.metrics.devices, ['0', '1']);
    assert.deepEqual(report.metrics.laneMetrics.map((lane) => lane.requests), [1, 1]);
    const output = renderClassifierMetrics(report);
    assert.match(output, /CLASSIFIER ACCELERATOR/);
    assert.match(output, /mock-gpu/);
    assert.match(output, /lane 0/);
    assert.match(output, /gpu 0/);
    assert.match(renderHelp(), /proofroute classifier/);
    const cli = await runCli(['./bin/proofroute.js', 'classifier'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /CLASSIFIER ACCELERATOR/);
    assert.match(cli.stdout, /2 classifications/);
  } finally {
    await sidecar.close();
  }
});

test('classifier metrics report explains builtin mode without sidecar', async () => {
  const report = await classifierMetricsReport({ classifier: {} });
  assert.equal(report.status, 'warn');
  assert.equal(report.mode, 'builtin');
  assert.match(renderClassifierMetrics(report), /Built-in classifier/);
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
