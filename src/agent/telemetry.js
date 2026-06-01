import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export function telemetryPath(config, override) {
  return resolve(override ?? config.telemetry?.path ?? '.proofroute/events.jsonl');
}

export async function recordRouteEvent(path, event) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(sanitizeEvent(event))}\n`, 'utf8');
}

export async function readRouteEvents(path) {
  try {
    const text = await readFile(path, 'utf8');
    return text.split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function readRouteEventsWithDiagnostics(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { events: [], errors: [], records: 0, bytes: 0, exists: false };
    }
    throw error;
  }
  const events = [];
  const errors = [];
  let records = 0;
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    records += 1;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      errors.push({ line: index + 1, message: 'Invalid JSONL record' });
    }
  });
  return {
    events,
    errors,
    records,
    bytes: Buffer.byteLength(text, 'utf8'),
    exists: true
  };
}

export function routeEvent({ decision, requestedModel, modelSwap, status, elapsedMs, routerDecisionMs, routerOverheadPct, endToEndMs, stream, fallback, actualUsage, actualCostUsd, actualBaselineCostUsd, actualSavingsUsd }) {
  const decisionMs = routerDecisionMs ?? elapsedMs ?? 0;
  const classifier = decision.intent?.features ?? {};
  const requested = requestedModel ?? decision.requestedModel;
  const estimatedLatencyMs = decision.performance?.estimatedLatencyMs;
  return sanitizeEvent({
    ts: new Date().toISOString(),
    model: decision.model.id,
    requestedModel: requested,
    modelSwap: modelSwap ?? Boolean(requested && requested !== decision.model.id),
    provider: decision.model.provider,
    local: Boolean(decision.model.local),
    policy: decision.policy,
    intent: decision.intent.name,
    classifierBackend: classifier.backend,
    classifierCircuitOpen: classifier.classifierCircuitOpen,
    classifierFailures: classifier.classifierFailures,
    confidence: decision.confidence,
    inputTokens: decision.inputTokens,
    outputTokens: decision.outputTokens,
    estimatedCostUsd: decision.economics.estimatedCostUsd,
    savingsUsd: decision.economics.savingsUsd,
    actualInputTokens: actualUsage?.inputTokens,
    actualOutputTokens: actualUsage?.outputTokens,
    actualTotalTokens: actualUsage?.totalTokens,
    actualCostUsd,
    actualBaselineCostUsd,
    actualSavingsUsd,
    speedup: decision.performance.speedup,
    estimatedLatencyMs: decision.performance.estimatedLatencyMs,
    routerDecisionMs: decisionMs,
    routerLatencyMs: decisionMs,
    routerOverheadPct: routerOverheadPct ?? routerOverheadPercent(decisionMs, estimatedLatencyMs),
    endToEndMs: endToEndMs ?? elapsedMs ?? decisionMs,
    cacheHit: Boolean(decision.cache?.hit),
    fallbackUsed: Boolean(fallback),
    stream: Boolean(stream),
    status
  });
}

export function summarizeRouteEvents(events) {
  const count = events.length;
  const estimatedSavingsUsd = sum(events, 'savingsUsd');
  const savingsUsd = events.reduce((total, event) => total + bestSavings(event), 0);
  const estimatedCostUsd = sum(events, 'estimatedCostUsd');
  const meteredEvents = events.filter((event) => finite(event.actualTotalTokens) > 0);
  const routerLatencies = events.map((event) => event.routerLatencyMs).filter(Number.isFinite);
  const endToEndLatencies = events.map((event) => event.endToEndMs).filter(Number.isFinite);
  const estimatedLatencies = events.map((event) => event.estimatedLatencyMs).filter(Number.isFinite);
  const routerOverheads = events.map(routerOverheadForEvent).filter(Number.isFinite);
  return {
    count,
    savingsUsd,
    estimatedSavingsUsd,
    estimatedCostUsd,
    actualCostUsd: sum(events, 'actualCostUsd'),
    actualBaselineCostUsd: sum(events, 'actualBaselineCostUsd'),
    actualSavingsUsd: sum(events, 'actualSavingsUsd'),
    actualInputTokens: sum(events, 'actualInputTokens'),
    actualOutputTokens: sum(events, 'actualOutputTokens'),
    actualTotalTokens: sum(events, 'actualTotalTokens'),
    meteredRequests: meteredEvents.length,
    averageSpeedup: count ? sum(events, 'speedup') / count : 0,
    p50RouterMs: percentile(routerLatencies, 0.5),
    p95RouterMs: percentile(routerLatencies, 0.95),
    p95EndToEndMs: percentile(endToEndLatencies, 0.95),
    p95EstimatedLatencyMs: percentile(estimatedLatencies, 0.95),
    p95RouterOverheadPct: percentile(routerOverheads, 0.95),
    averageRouterOverheadPct: count ? routerOverheads.reduce((total, value) => total + value, 0) / count : 0,
    cacheHits: events.filter((event) => event.cacheHit).length,
    fallbacks: events.filter((event) => event.fallbackUsed).length,
    modelSwaps: events.filter((event) => event.modelSwap).length,
    classifierCircuitOpen: events.filter((event) => event.classifierCircuitOpen).length,
    streaming: events.filter((event) => event.stream).length,
    local: events.filter((event) => event.local).length,
    cloud: events.filter((event) => !event.local).length,
    intents: countBy(events.map((event) => event.intent)),
    policies: countBy(events.map((event) => event.policy ?? 'unknown')),
    requestedModels: countBy(events.map((event) => event.requestedModel || 'none')),
    classifierBackends: countBy(events.map((event) => event.classifierBackend ?? 'unknown')),
    models: countBy(events.map((event) => event.model)),
    providers: countBy(events.map((event) => event.provider)),
    statuses: countBy(events.map((event) => String(event.status ?? 'unknown')))
  };
}

export function recentRouteEvents(events, limit = 5) {
  const parsed = Number(limit);
  const count = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 5;
  if (count === 0) return [];
  return events.slice(-count).reverse().map((event) => {
    return {
      ts: String(event.ts ?? ''),
      model: String(event.model ?? ''),
      requestedModel: String(event.requestedModel ?? ''),
      modelSwap: Boolean(event.modelSwap),
      provider: String(event.provider ?? ''),
      local: Boolean(event.local),
      policy: String(event.policy ?? 'unknown'),
      intent: String(event.intent ?? ''),
      classifierBackend: String(event.classifierBackend ?? 'unknown'),
      classifierCircuitOpen: Boolean(event.classifierCircuitOpen),
      savingsUsd: bestSavings(event),
      actualTotalTokens: finite(event.actualTotalTokens),
      routerLatencyMs: finite(event.routerLatencyMs),
      routerOverheadPct: routerOverheadForEvent(event),
      endToEndMs: finite(event.endToEndMs),
      stream: Boolean(event.stream),
      fallbackUsed: Boolean(event.fallbackUsed),
      status: Number.isFinite(Number(event.status)) ? Number(event.status) : 0
    };
  });
}

export function routeEventsInWindow(events, since, now = new Date()) {
  if (since === undefined) return { events, window: undefined };
  if (since === true) throw new Error('Pass --since a duration like 30m, 1h, 7d, or an ISO timestamp.');
  const cutoff = sinceCutoff(since, now);
  const cutoffMs = cutoff.getTime();
  const filtered = events.filter((event) => {
    const timestamp = Date.parse(event.ts);
    return Number.isFinite(timestamp) && timestamp >= cutoffMs;
  });
  return {
    events: filtered,
    window: {
      since: String(since),
      cutoff: cutoff.toISOString(),
      total: events.length,
      matched: filtered.length
    }
  };
}

export function sinceCutoff(value, now = new Date()) {
  const text = String(value ?? '').trim();
  const duration = text.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2].toLowerCase();
    const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return new Date(now.getTime() - amount * units[unit]);
  }
  const timestamp = Date.parse(text);
  if (Number.isFinite(timestamp)) return new Date(timestamp);
  throw new Error(`Invalid --since value "${text}". Use a duration like 30m, 1h, 7d, or an ISO timestamp.`);
}

function sanitizeEvent(event) {
  return {
    ts: String(event.ts ?? new Date().toISOString()),
    model: String(event.model ?? ''),
    requestedModel: String(event.requestedModel ?? ''),
    modelSwap: Boolean(event.modelSwap),
    provider: String(event.provider ?? ''),
    local: Boolean(event.local),
    policy: String(event.policy ?? 'unknown'),
    intent: String(event.intent ?? ''),
    classifierBackend: String(event.classifierBackend ?? 'unknown'),
    classifierCircuitOpen: Boolean(event.classifierCircuitOpen),
    classifierFailures: finite(event.classifierFailures),
    confidence: finite(event.confidence),
    inputTokens: finite(event.inputTokens),
    outputTokens: finite(event.outputTokens),
    estimatedCostUsd: finite(event.estimatedCostUsd),
    savingsUsd: finite(event.savingsUsd),
    actualInputTokens: finite(event.actualInputTokens),
    actualOutputTokens: finite(event.actualOutputTokens),
    actualTotalTokens: finite(event.actualTotalTokens),
    actualCostUsd: finite(event.actualCostUsd),
    actualBaselineCostUsd: finite(event.actualBaselineCostUsd),
    actualSavingsUsd: finite(event.actualSavingsUsd),
    speedup: finite(event.speedup),
    estimatedLatencyMs: finite(event.estimatedLatencyMs),
    routerLatencyMs: finite(event.routerLatencyMs),
    routerDecisionMs: finite(event.routerDecisionMs ?? event.routerLatencyMs),
    routerOverheadPct: finite(event.routerOverheadPct),
    endToEndMs: finite(event.endToEndMs ?? event.routerLatencyMs),
    cacheHit: Boolean(event.cacheHit),
    fallbackUsed: Boolean(event.fallbackUsed),
    stream: Boolean(event.stream),
    status: Number.isFinite(Number(event.status)) ? Number(event.status) : 0
  };
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sum(events, key) {
  return events.reduce((total, event) => total + finite(event[key]), 0);
}

function bestSavings(event) {
  return finite(event.actualTotalTokens) > 0 ? finite(event.actualSavingsUsd) : finite(event.savingsUsd);
}

function routerOverheadForEvent(event) {
  const recorded = Number(event.routerOverheadPct);
  if (Number.isFinite(recorded) && recorded >= 0) return recorded;
  return routerOverheadPercent(finite(event.routerLatencyMs), finite(event.estimatedLatencyMs));
}

function routerOverheadPercent(routerDecisionMs, estimatedLatencyMs) {
  const latency = Number(estimatedLatencyMs);
  return Number.isFinite(latency) && latency > 0 ? routerDecisionMs / latency * 100 : 0;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
