import { createServer } from 'node:http';
import { classifyIntent } from './intent.js';

export const DEFAULT_CLASSIFIER_SIDECAR_PORT = 8788;

export function createClassifierSidecar({ classify = classifyIntent, classifyMany, lanes = 1, backend = 'sidecar-builtin', devices = [], deviceProfiles, deviceNames, deviceMemoryMb, deviceRuntime, deviceDriver, scheduler = 'least-inflight', batchWindowMs = 0, maxBatchSize = 16, requireWarmup = false, maxBytes = 1024 * 1024 } = {}) {
  const openedAt = performance.now();
  const safeLanes = normalizePositiveInteger(lanes, 1);
  const safeDevices = normalizeDevices(devices);
  const safeDeviceProfiles = normalizeDeviceProfiles({
    devices: safeDevices,
    profiles: deviceProfiles,
    names: deviceNames,
    memoryMb: deviceMemoryMb,
    runtime: deviceRuntime,
    driver: deviceDriver
  });
  const safeScheduler = normalizeScheduler(scheduler);
  const safeBatchWindowMs = normalizeNonNegativeNumber(batchWindowMs, 0);
  const safeMaxBatchSize = normalizePositiveInteger(maxBatchSize, 16);
  const safeRequireWarmup = Boolean(requireWarmup);
  const laneInflight = Array.from({ length: safeLanes }, () => 0);
  const laneMetrics = Array.from({ length: safeLanes }, () => ({
    requests: 0,
    errors: 0,
    peakInflight: 0,
    totalDecisionMs: 0,
    maxDecisionMs: 0
  }));
  let nextLane = 0;
  let requests = 0;
  let errors = 0;
  let batches = 0;
  let microBatches = 0;
  let totalBatchSize = 0;
  let maxObservedBatchSize = 0;
  let warmed = false;
  let warmups = 0;
  let warmupRequests = 0;
  let lastWarmupMs = 0;
  const pendingSingles = [];
  let batchTimer;
  let batchTimerKind = '';
  function reserveLane() {
    const lane = selectLane();
    nextLane = (nextLane + 1) % safeLanes;
    const device = safeDevices.length > 0 ? safeDevices[lane % safeDevices.length] : undefined;
    const deviceProfile = device === undefined ? undefined : safeDeviceProfiles.find((profile) => profile.id === device);
    laneInflight[lane] += 1;
    laneMetrics[lane].peakInflight = Math.max(laneMetrics[lane].peakInflight, laneInflight[lane]);
    return { backend, scheduler: safeScheduler, lane, lanes: safeLanes, device, devices: safeDevices, deviceProfile, deviceProfiles: safeDeviceProfiles };
  }
  function selectLane() {
    if (safeScheduler !== 'least-inflight') return nextLane;
    let bestLane = nextLane;
    let bestInflight = laneInflight[bestLane];
    for (let offset = 1; offset < safeLanes; offset += 1) {
      const lane = (nextLane + offset) % safeLanes;
      if (laneInflight[lane] < bestInflight) {
        bestLane = lane;
        bestInflight = laneInflight[lane];
      }
    }
    return bestLane;
  }
  function releaseLane(context, startedAt, ok) {
    const decisionMs = Math.max(0, performance.now() - startedAt);
    laneInflight[context.lane] -= 1;
    requests += 1;
    const metrics = laneMetrics[context.lane];
    metrics.requests += 1;
    metrics.totalDecisionMs += decisionMs;
    metrics.maxDecisionMs = Math.max(metrics.maxDecisionMs, decisionMs);
    if (!ok) {
      errors += 1;
      metrics.errors += 1;
    }
    return decisionMs;
  }
  async function classifyOne(prompt, startedAt) {
    if (typeof classifyMany === 'function' && safeMaxBatchSize > 1) {
      return enqueueSingle(prompt, startedAt);
    }
    return classifyDirect(prompt, startedAt);
  }
  async function classifyDirect(prompt, startedAt) {
    const context = reserveLane();
    let intent;
    let ok = false;
    let decisionMs = 0;
    try {
      intent = await classify(prompt, context);
      ok = true;
    } finally {
      decisionMs = releaseLane(context, startedAt, ok);
    }
    return enrichIntent(intent, {
      ...context,
      requests,
      decisionMs,
      batchMode: 'single',
      batchSize: 1
    });
  }
  function enqueueSingle(prompt, startedAt) {
    const context = reserveLane();
    return new Promise((resolve, reject) => {
      pendingSingles.push({ prompt, startedAt, context, resolve, reject });
      if (pendingSingles.length >= safeMaxBatchSize) {
        flushPendingSingles();
      } else {
        schedulePendingSingles();
      }
    });
  }
  function schedulePendingSingles() {
    if (batchTimer !== undefined) return;
    const flush = () => {
      batchTimer = undefined;
      batchTimerKind = '';
      flushPendingSingles();
    };
    if (safeBatchWindowMs > 0) {
      batchTimerKind = 'timeout';
      batchTimer = setTimeout(flush, safeBatchWindowMs);
    } else {
      batchTimerKind = 'immediate';
      batchTimer = setImmediate(flush);
    }
  }
  function flushPendingSingles() {
    if (batchTimer !== undefined) {
      if (batchTimerKind === 'timeout') clearTimeout(batchTimer);
      if (batchTimerKind === 'immediate') clearImmediate(batchTimer);
      batchTimer = undefined;
      batchTimerKind = '';
    }
    const items = pendingSingles.splice(0, safeMaxBatchSize);
    if (pendingSingles.length > 0) schedulePendingSingles();
    if (items.length === 0) return;
    void executeMicroBatch(items);
  }
  async function executeMicroBatch(items) {
    recordBatch(items.length, true);
    const prompts = items.map((item) => item.prompt);
    const contexts = items.map((item) => item.context);
    let intents;
    try {
      intents = await classifyMany(prompts, {
        backend,
        scheduler: safeScheduler,
        lanes: safeLanes,
        devices: safeDevices,
        deviceProfiles: safeDeviceProfiles,
        items: contexts,
        batchMode: 'microbatch',
        batchSize: items.length,
        batchWindowMs: safeBatchWindowMs,
        maxBatchSize: safeMaxBatchSize
      });
    } catch (error) {
      items.forEach((item) => {
        releaseLane(item.context, item.startedAt, false);
        item.reject(error);
      });
      return;
    }
    const rows = Array.isArray(intents) ? intents : [];
    items.forEach((item, index) => {
      const decisionMs = releaseLane(item.context, item.startedAt, true);
      item.resolve(enrichIntent(rows[index], {
        ...item.context,
        requests,
        decisionMs,
        batchMode: 'microbatch',
        batchSize: items.length
      }));
    });
  }
  async function classifyBatch(prompts, startedAt) {
    if (typeof classifyMany !== 'function') {
      return Promise.all(prompts.map((prompt) => classifyDirect(prompt, startedAt)));
    }
    const contexts = prompts.map(() => reserveLane());
    recordBatch(prompts.length, false);
    let intents;
    let ok = false;
    const decisionTimes = [];
    try {
      intents = await classifyMany(prompts, {
        backend,
        scheduler: safeScheduler,
        lanes: safeLanes,
        devices: safeDevices,
        deviceProfiles: safeDeviceProfiles,
        items: contexts,
        batchMode: 'explicit',
        batchSize: prompts.length,
        batchWindowMs: safeBatchWindowMs,
        maxBatchSize: safeMaxBatchSize
      });
      ok = true;
    } finally {
      contexts.forEach((context) => {
        decisionTimes.push(releaseLane(context, startedAt, ok));
      });
    }
    const rows = Array.isArray(intents) ? intents : [];
    return prompts.map((prompt, index) => {
      return enrichIntent(rows[index], {
        ...contexts[index],
        requests: requests - prompts.length + index + 1,
        decisionMs: decisionTimes[index] ?? 0,
        batchMode: 'explicit',
        batchSize: prompts.length
      });
    });
  }
  function recordBatch(size, micro) {
    batches += 1;
    if (micro) microBatches += 1;
    totalBatchSize += size;
    maxObservedBatchSize = Math.max(maxObservedBatchSize, size);
  }
  async function warmup(prompts, startedAt) {
    const data = await classifyBatch(prompts, startedAt);
    lastWarmupMs = Math.max(0, performance.now() - startedAt);
    warmed = true;
    warmups += 1;
    warmupRequests += data.length;
    return {
      object: 'proofroute.classifier.warmup',
      ok: true,
      backend,
      scheduler: safeScheduler,
      batchWindowMs: safeBatchWindowMs,
      maxBatchSize: safeMaxBatchSize,
      count: data.length,
      elapsedMs: lastWarmupMs,
      intents: data.map((intent) => ({
        name: intent.name,
        confidence: intent.confidence,
        lane: intent.features?.lane,
        device: intent.features?.device,
        deviceProfile: intent.features?.deviceProfile,
        batchMode: intent.features?.batchMode,
        batchSize: intent.features?.batchSize
      }))
    };
  }
  return createServer(async (req, res) => {
    const startedAt = performance.now();
    try {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (req.method === 'GET' && pathname === '/health') {
        return sendJson(res, 200, healthSnapshot());
      }
      if (req.method === 'GET' && pathname === '/ready') {
        const ready = readySnapshot();
        return sendJson(res, ready.ready ? 200 : 503, ready);
      }
      if (req.method === 'GET' && pathname === '/metrics') {
        return sendJson(res, 200, metricsSnapshot());
      }
      if (req.method !== 'POST' || !['/classify', '/classify/batch', '/warmup'].includes(pathname)) {
        return sendJson(res, 404, {
          error: {
            message: 'Supported routes are GET /health, GET /ready, GET /metrics, POST /warmup, POST /classify, and POST /classify/batch.'
          }
        });
      }
      const body = await readJson(req, maxBytes);
      if (pathname === '/warmup') {
        const prompts = body.prompts === undefined ? defaultWarmupPrompts() : body.prompts;
        if (!Array.isArray(prompts) || prompts.some((prompt) => typeof prompt !== 'string')) {
          return sendJson(res, 400, {
            error: {
              message: 'Expected JSON body with an optional prompts array of strings.'
            }
          });
        }
        return sendJson(res, 200, await warmup(prompts, startedAt));
      }
      if (pathname === '/classify/batch') {
        if (!Array.isArray(body.prompts) || body.prompts.some((prompt) => typeof prompt !== 'string')) {
          return sendJson(res, 400, {
            error: {
              message: 'Expected JSON body with a prompts array of strings.'
            }
          });
        }
        const data = await classifyBatch(body.prompts, startedAt);
        return sendJson(res, 200, {
          object: 'list',
          backend,
          scheduler: safeScheduler,
          batchMode: typeof classifyMany === 'function' ? 'explicit' : 'single',
          batchWindowMs: safeBatchWindowMs,
          maxBatchSize: safeMaxBatchSize,
          lanes: safeLanes,
          devices: safeDevices,
          deviceProfiles: safeDeviceProfiles,
          count: data.length,
          data
        });
      }
      if (typeof body.prompt !== 'string') {
        return sendJson(res, 400, {
          error: {
            message: 'Expected JSON body with a string prompt field.'
          }
        });
      }
      return sendJson(res, 200, await classifyOne(body.prompt, startedAt));
    } catch (error) {
      const status = error.code === 'PAYLOAD_TOO_LARGE' ? 413 : error.code === 'BAD_JSON' ? 400 : 500;
      return sendJson(res, status, {
        error: {
          message: error.message
        }
      });
    }
  });

  function healthSnapshot() {
    return {
      ok: true,
      name: 'proofroute-classifier',
      backend,
      scheduler: safeScheduler,
      batchWindowMs: safeBatchWindowMs,
      maxBatchSize: safeMaxBatchSize,
      requireWarmup: safeRequireWarmup,
      pendingBatch: pendingSingles.length,
      batches,
      microBatches,
      averageBatchSize: batches > 0 ? totalBatchSize / batches : 0,
      maxObservedBatchSize,
      warmed,
      warmups,
      warmupRequests,
      lastWarmupMs,
      lanes: safeLanes,
      devices: safeDevices,
      deviceProfiles: safeDeviceProfiles,
      inflight: laneInflight.reduce((total, count) => total + count, 0),
      laneInflight,
      requests,
      errors,
      uptimeMs: Math.max(0, performance.now() - openedAt)
    };
  }

  function readySnapshot() {
    const ready = !safeRequireWarmup || warmed;
    return {
      ...healthSnapshot(),
      object: 'proofroute.classifier.ready',
      ok: ready,
      ready,
      requireWarmup: safeRequireWarmup
    };
  }

  function metricsSnapshot() {
    return {
      ...healthSnapshot(),
      object: 'proofroute.classifier.metrics',
      laneRequests: laneMetrics.map((entry) => entry.requests),
      laneErrors: laneMetrics.map((entry) => entry.errors),
      laneMetrics: laneMetrics.map((entry, lane) => ({
        lane,
        device: safeDevices.length > 0 ? safeDevices[lane % safeDevices.length] : undefined,
        deviceProfile: safeDevices.length > 0 ? safeDeviceProfiles[lane % safeDevices.length] : undefined,
        requests: entry.requests,
        errors: entry.errors,
        inflight: laneInflight[lane],
        peakInflight: entry.peakInflight,
        averageDecisionMs: entry.requests > 0 ? entry.totalDecisionMs / entry.requests : 0,
        maxDecisionMs: entry.maxDecisionMs
      }))
    };
  }
}

function enrichIntent(intent, metadata) {
  const fallback = classifyIntent('');
  const safeIntent = intent && typeof intent.name === 'string' ? intent : fallback;
  return {
    ...safeIntent,
    confidence: typeof safeIntent.confidence === 'number' ? safeIntent.confidence : fallback.confidence,
    ranked: Array.isArray(safeIntent.ranked) ? safeIntent.ranked : fallback.ranked,
    features: {
      ...fallback.features,
      ...safeIntent.features,
      backend: metadata.backend,
      source: 'sidecar',
      scheduler: metadata.scheduler,
      batchMode: metadata.batchMode,
      batchSize: metadata.batchSize,
      lane: metadata.lane,
      lanes: metadata.lanes,
      device: metadata.device,
      devices: metadata.devices,
      deviceProfile: metadata.deviceProfile,
      deviceProfiles: metadata.deviceProfiles,
      requests: metadata.requests,
      decisionMs: metadata.decisionMs
    }
  };
}

async function readJson(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`Payload is larger than ${maxBytes} bytes.`);
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.code = 'BAD_JSON';
    throw error;
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeDevices(value) {
  const entries = Array.isArray(value) ? value : String(value).split(',');
  return entries.map((entry) => String(entry).trim()).filter(Boolean);
}

function normalizeDeviceProfiles({ devices, profiles, names, memoryMb, runtime, driver }) {
  if (!Array.isArray(devices) || devices.length === 0) return [];
  const profileEntries = normalizeProfileEntries(profiles);
  const nameEntries = normalizeMetadataEntries(names);
  const memoryEntries = normalizeMetadataEntries(memoryMb);
  const runtimeEntries = normalizeMetadataEntries(runtime);
  const driverEntries = normalizeMetadataEntries(driver);
  return devices.map((device, index) => {
    const entry = profileForDevice(profileEntries, device, index);
    const profile = { id: String(entry.id ?? device) };
    const name = firstText(entry.name, metadataAt(nameEntries, index));
    const parsedMemory = optionalNumber(firstValue(entry.memoryMb, entry.memoryMB, entry.memory, metadataAt(memoryEntries, index)));
    const runtimeLabel = firstText(entry.runtime, entry.executionProvider, metadataAt(runtimeEntries, index));
    const driverLabel = firstText(entry.driver, metadataAt(driverEntries, index));
    const sourceLabel = firstText(entry.source);
    if (name) profile.name = name;
    if (parsedMemory !== undefined) profile.memoryMb = parsedMemory;
    if (runtimeLabel) profile.runtime = runtimeLabel;
    if (driverLabel) profile.driver = driverLabel;
    if (sourceLabel) profile.source = sourceLabel;
    return profile;
  });
}

function normalizeProfileEntries(value) {
  if (value === undefined || value === null || value === '') return [];
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (Array.isArray(parsed)) {
    return parsed.map((entry, index) => normalizeProfileEntry(entry, index)).filter(Boolean);
  }
  if (parsed && typeof parsed === 'object') {
    return Object.entries(parsed).map(([id, entry], index) => normalizeProfileEntry({ id, ...(entry && typeof entry === 'object' ? entry : { name: entry }) }, index)).filter(Boolean);
  }
  return [];
}

function normalizeProfileEntry(entry, index) {
  if (!entry || typeof entry !== 'object') return undefined;
  return {
    ...entry,
    index,
    id: entry.id === undefined ? undefined : String(entry.id)
  };
}

function profileForDevice(entries, device, index) {
  return entries.find((entry) => entry.id === device) ?? entries[index] ?? {};
}

function normalizeMetadataEntries(value) {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim());
  return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
}

function metadataAt(entries, index) {
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  return entries[index] ?? (entries.length === 1 ? entries[0] : undefined);
}

function firstText(...values) {
  const found = values.find((value) => String(value ?? '').trim().length > 0);
  return found === undefined ? undefined : String(found).trim();
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim().length > 0);
}

function optionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeScheduler(value) {
  return value === 'round-robin' ? 'round-robin' : 'least-inflight';
}

function defaultWarmupPrompts() {
  return [
    'Refactor this function and add a regression test.',
    'Extract invoice totals into JSON.',
    'Compare these routing policies and explain the latency tradeoff.'
  ];
}
