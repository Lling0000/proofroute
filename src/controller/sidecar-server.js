import { createServer } from 'node:http';
import { classifyIntent } from './intent.js';

export const DEFAULT_CLASSIFIER_SIDECAR_PORT = 8788;

export function createClassifierSidecar({ classify = classifyIntent, classifyMany, lanes = 1, backend = 'sidecar-builtin', devices = [], maxBytes = 1024 * 1024 } = {}) {
  const openedAt = performance.now();
  const safeLanes = normalizePositiveInteger(lanes, 1);
  const safeDevices = normalizeDevices(devices);
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
  function reserveLane() {
    const lane = nextLane;
    nextLane = (nextLane + 1) % safeLanes;
    const device = safeDevices.length > 0 ? safeDevices[lane % safeDevices.length] : undefined;
    laneInflight[lane] += 1;
    laneMetrics[lane].peakInflight = Math.max(laneMetrics[lane].peakInflight, laneInflight[lane]);
    return { backend, lane, lanes: safeLanes, device, devices: safeDevices };
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
      decisionMs
    });
  }
  async function classifyBatch(prompts, startedAt) {
    if (typeof classifyMany !== 'function') {
      return Promise.all(prompts.map((prompt) => classifyOne(prompt, startedAt)));
    }
    const contexts = prompts.map(() => reserveLane());
    let intents;
    let ok = false;
    let decisionMs = 0;
    try {
      intents = await classifyMany(prompts, {
        backend,
        lanes: safeLanes,
        devices: safeDevices,
        items: contexts
      });
      ok = true;
    } finally {
      contexts.forEach((context) => {
        decisionMs = releaseLane(context, startedAt, ok);
      });
    }
    const rows = Array.isArray(intents) ? intents : [];
    return prompts.map((prompt, index) => {
      return enrichIntent(rows[index], {
        ...contexts[index],
        requests: requests - prompts.length + index + 1,
        decisionMs
      });
    });
  }
  return createServer(async (req, res) => {
    const startedAt = performance.now();
    try {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (req.method === 'GET' && pathname === '/health') {
        return sendJson(res, 200, healthSnapshot());
      }
      if (req.method === 'GET' && pathname === '/metrics') {
        return sendJson(res, 200, metricsSnapshot());
      }
      if (req.method !== 'POST' || !['/classify', '/classify/batch'].includes(pathname)) {
        return sendJson(res, 404, {
          error: {
            message: 'Supported routes are GET /health, GET /metrics, POST /classify, and POST /classify/batch.'
          }
        });
      }
      const body = await readJson(req, maxBytes);
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
          lanes: safeLanes,
          devices: safeDevices,
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
      lanes: safeLanes,
      devices: safeDevices,
      inflight: laneInflight.reduce((total, count) => total + count, 0),
      laneInflight,
      requests,
      errors,
      uptimeMs: Math.max(0, performance.now() - openedAt)
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
      lane: metadata.lane,
      lanes: metadata.lanes,
      device: metadata.device,
      devices: metadata.devices,
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

function normalizeDevices(value) {
  const entries = Array.isArray(value) ? value : String(value).split(',');
  return entries.map((entry) => String(entry).trim()).filter(Boolean);
}
