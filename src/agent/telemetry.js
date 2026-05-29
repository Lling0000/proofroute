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

export function routeEvent({ decision, status, elapsedMs, routerDecisionMs, endToEndMs, stream, fallback, actualUsage, actualCostUsd, actualBaselineCostUsd, actualSavingsUsd }) {
  const decisionMs = routerDecisionMs ?? elapsedMs ?? 0;
  return sanitizeEvent({
    ts: new Date().toISOString(),
    model: decision.model.id,
    provider: decision.model.provider,
    local: Boolean(decision.model.local),
    intent: decision.intent.name,
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
    cacheHits: events.filter((event) => event.cacheHit).length,
    fallbacks: events.filter((event) => event.fallbackUsed).length,
    streaming: events.filter((event) => event.stream).length,
    local: events.filter((event) => event.local).length,
    cloud: events.filter((event) => !event.local).length,
    intents: countBy(events.map((event) => event.intent)),
    models: countBy(events.map((event) => event.model)),
    providers: countBy(events.map((event) => event.provider)),
    statuses: countBy(events.map((event) => String(event.status ?? 'unknown')))
  };
}

function sanitizeEvent(event) {
  return {
    ts: String(event.ts ?? new Date().toISOString()),
    model: String(event.model ?? ''),
    provider: String(event.provider ?? ''),
    local: Boolean(event.local),
    intent: String(event.intent ?? ''),
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
