#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyIntent } from '../src/controller/intent.js';

const backend = String(process.env.PROOFROUTE_ACCELERATOR_BACKEND ?? 'accelerator-template');
const devices = normalizeDevices(process.env.PROOFROUTE_ACCELERATOR_DEVICES ?? process.env.PROOFROUTE_ACCELERATOR_DEVICE ?? process.env.CUDA_VISIBLE_DEVICES);
const scheduler = normalizeScheduler(process.env.PROOFROUTE_ACCELERATOR_SCHEDULER);
const modulePath = process.env.PROOFROUTE_ACCELERATOR_MODULE;
const accelerator = modulePath ? await import(pathToFileURL(resolve(modulePath)).href) : {};
let nextDeviceIndex = 0;

await warmAccelerator();

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

for await (const line of input) {
  if (!line.trim()) continue;
  try {
    const body = JSON.parse(line);
    if (Array.isArray(body.prompts)) {
      process.stdout.write(`${JSON.stringify({
        id: body.id,
        data: await classifyMany(body.prompts)
      })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({
        id: body.id,
        ...(await classifyOne(body.prompt))
      })}\n`);
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      error: error.message
    })}\n`);
  }
}

async function classifyOne(prompt) {
  const rows = await classifyMany([prompt]);
  return rows[0];
}

async function classifyMany(prompts) {
  const startedAt = performance.now();
  const normalized = prompts.map((prompt) => String(prompt ?? ''));
  const assignments = assignDevices(normalized.length);
  const shardSizes = countShardSizes(assignments);
  const rows = await classifyWithAccelerator(normalized, assignments);
  const elapsedMs = Math.max(0, performance.now() - startedAt);
  const decisionMs = normalized.length > 0 ? elapsedMs / normalized.length : elapsedMs;
  return normalized.map((prompt, index) => {
    const assignment = assignments[index] ?? deviceAssignment(0);
    return enrichIntent(rows[index] ?? classifyIntent(prompt), {
      decisionMs,
      batchMode: normalized.length > 1 ? 'explicit' : 'single',
      batchSize: normalized.length,
      device: assignment.device,
      deviceOrdinal: assignment.ordinal,
      shardSize: shardSizes.get(assignment.device) ?? normalized.length
    });
  });
}

async function classifyWithAccelerator(prompts, assignments) {
  if (typeof accelerator.classifyMany === 'function') {
    const rows = new Array(prompts.length);
    await Promise.all(groupPrompts(prompts, assignments).map(async (group) => {
      const result = await accelerator.classifyMany(group.prompts, deviceContext(group.assignment, {
        batchSize: prompts.length,
        shardSize: group.prompts.length
      }));
      const data = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : [];
      group.indexes.forEach((originalIndex, index) => {
        rows[originalIndex] = data[index];
      });
    }));
    return rows;
  }
  if (typeof accelerator.classify === 'function') {
    return Promise.all(prompts.map((prompt, index) => accelerator.classify(prompt, deviceContext(assignments[index] ?? deviceAssignment(index), {
      batchSize: prompts.length,
      shardSize: 1
    }))));
  }
  return prompts.map((prompt) => classifyIntent(prompt));
}

async function warmAccelerator() {
  if (typeof accelerator.warmupAll === 'function') {
    await accelerator.warmupAll({
      backend,
      devices,
      device: devices[0],
      deviceCount: devices.length,
      scheduler
    });
    return;
  }
  if (typeof accelerator.warmup === 'function') {
    await Promise.all(devices.map((device, ordinal) => accelerator.warmup(deviceContext({ device, ordinal }, {
      batchSize: 0,
      shardSize: 0
    }))));
  }
}

function enrichIntent(intent, metadata) {
  const fallback = classifyIntent('');
  const safe = intent && typeof intent.name === 'string' ? intent : fallback;
  return {
    ...safe,
    confidence: typeof safe.confidence === 'number' ? safe.confidence : fallback.confidence,
    ranked: Array.isArray(safe.ranked) ? safe.ranked : fallback.ranked,
    features: {
      ...fallback.features,
      ...safe.features,
      backend,
      source: 'accelerator-worker',
      device: metadata.device,
      devices,
      deviceCount: devices.length,
      deviceOrdinal: metadata.deviceOrdinal,
      scheduler,
      shardSize: metadata.shardSize,
      batchMode: metadata.batchMode,
      batchSize: metadata.batchSize,
      decisionMs: metadata.decisionMs
    }
  };
}

function assignDevices(count) {
  const start = nextDeviceIndex;
  const assignments = Array.from({ length: count }, (_, index) => scheduler === 'sticky-batch' ? deviceAssignment(start) : deviceAssignment(start + index));
  if (count > 0) nextDeviceIndex = (start + (scheduler === 'sticky-batch' ? 1 : count)) % devices.length;
  return assignments;
}

function deviceAssignment(position) {
  const ordinal = ((position % devices.length) + devices.length) % devices.length;
  return {
    device: devices[ordinal],
    ordinal
  };
}

function deviceContext(assignment, metadata) {
  return {
    backend,
    device: assignment.device,
    devices,
    deviceCount: devices.length,
    deviceOrdinal: assignment.ordinal,
    scheduler,
    batchSize: metadata.batchSize,
    shardSize: metadata.shardSize
  };
}

function groupPrompts(prompts, assignments) {
  const groups = new Map();
  prompts.forEach((prompt, index) => {
    const assignment = assignments[index] ?? deviceAssignment(index);
    const key = assignment.device;
    if (!groups.has(key)) {
      groups.set(key, {
        assignment,
        prompts: [],
        indexes: []
      });
    }
    const group = groups.get(key);
    group.prompts.push(prompt);
    group.indexes.push(index);
  });
  return Array.from(groups.values());
}

function countShardSizes(assignments) {
  const counts = new Map();
  for (const assignment of assignments) {
    counts.set(assignment.device, (counts.get(assignment.device) ?? 0) + 1);
  }
  return counts;
}

function normalizeDevices(value) {
  const text = String(value ?? '').trim();
  const parsed = text ? text.split(',').map((entry) => entry.trim()).filter(Boolean) : [];
  return parsed.length ? parsed : ['cpu'];
}

function normalizeScheduler(value) {
  return String(value ?? 'round-robin').trim().toLowerCase() === 'sticky-batch' ? 'sticky-batch' : 'round-robin';
}
