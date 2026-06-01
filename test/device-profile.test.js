import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filterDeviceProfiles, parseNvidiaSmiCsv } from '../src/controller/device-profile.js';

test('nvidia-smi parser normalizes prompt-free device profiles', () => {
  const profiles = parseNvidiaSmiCsv([
    '0, NVIDIA GeForce RTX 4090, 24564, 550.54.14',
    '1, NVIDIA RTX A6000, 49140, 550.54.14'
  ].join('\n'));
  assert.deepEqual(profiles, [
    { id: '0', name: 'NVIDIA GeForce RTX 4090', memoryMb: 24564, runtime: 'CUDA', driver: '550.54.14', source: 'nvidia-smi' },
    { id: '1', name: 'NVIDIA RTX A6000', memoryMb: 49140, runtime: 'CUDA', driver: '550.54.14', source: 'nvidia-smi' }
  ]);
  assert.deepEqual(filterDeviceProfiles(profiles, '1'), [
    { id: '1', name: 'NVIDIA RTX A6000', memoryMb: 49140, runtime: 'CUDA', driver: '550.54.14', source: 'nvidia-smi' }
  ]);
});

test('classifier CLI auto-detects nvidia-smi device profiles before listening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-device-profile-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const smi = join(bin, 'nvidia-smi');
  await writeFile(smi, [
    '#!/bin/sh',
    'printf "%s\\n" "0, NVIDIA GeForce RTX 4090, 24564, 550.54.14" "1, NVIDIA RTX A6000, 49140, 550.54.14"'
  ].join('\n'));
  await chmod(smi, 0o755);
  const child = spawn(process.execPath, [
    './bin/proofroute-classifier.js',
    '--port',
    '0',
    '--backend',
    'auto-gpu',
    '--lanes',
    '2'
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env.PATH}`,
      PROOFROUTE_GPU_AUTO_DETECT: 'true',
      PROOFROUTE_GPU_DETECT_TIMEOUT_MS: '10000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const output = await waitForOutput(child, /listening/);
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/classify/);
    assert.ok(match);
    const health = await getJson(`http://127.0.0.1:${match[1]}/health`);
    assert.deepEqual(health.devices, ['0', '1']);
    assert.equal(health.deviceProfiles[0].name, 'NVIDIA GeForce RTX 4090');
    assert.equal(health.deviceProfiles[0].memoryMb, 24564);
    assert.equal(health.deviceProfiles[0].runtime, 'CUDA');
    assert.equal(health.deviceProfiles[0].source, 'nvidia-smi');
    assert.equal(health.deviceProfiles[1].driver, '550.54.14');
  } finally {
    child.kill('SIGTERM');
    await waitForExit(child);
    await rm(directory, { recursive: true, force: true });
  }
});

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

function waitForOutput(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}. Output was ${output}`)), 15000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    function onData(chunk) {
      output += chunk;
      if (pattern.test(output)) {
        clearTimeout(timeout);
        resolve(output);
      }
    }
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once('exit', resolve);
  });
}
