import { createServer } from 'node:http';
import { AgentRuntime, responsesInputToText } from './runtime.js';
import { recordRouteEvent, routeEvent, telemetryPath } from './telemetry.js';
import { ROUTING_POLICIES, RouteController } from '../controller/route-controller.js';

const EXPOSED_PROOFROUTE_HEADERS = [
  'x-proofroute-model',
  'x-proofroute-requested-model',
  'x-proofroute-model-swap',
  'x-proofroute-policy',
  'x-proofroute-intent',
  'x-proofroute-runner-up',
  'x-proofroute-saved-usd',
  'x-proofroute-savings-pct',
  'x-proofroute-speedup',
  'x-proofroute-decision-ms',
  'x-proofroute-router-overhead-pct',
  'x-proofroute-cache',
  'x-proofroute-stream',
  'x-proofroute-usage-source',
  'x-proofroute-estimated-tokens',
  'x-proofroute-context-window',
  'x-proofroute-context-use-pct',
  'x-proofroute-estimated-cost-usd',
  'x-proofroute-baseline-cost-usd',
  'x-proofroute-estimated-latency-ms',
  'x-proofroute-baseline-latency-ms',
  'x-proofroute-classifier-backend',
  'x-proofroute-classifier-circuit',
  'x-proofroute-classifier-failures',
  'x-proofroute-fallback',
  'x-proofroute-latency-ms',
  'x-proofroute-actual-tokens',
  'x-proofroute-actual-cost-usd',
  'x-proofroute-actual-saved-usd',
  'server-timing'
];

export function createProxyServer({ config, controller = new RouteController(config), runtime = new AgentRuntime(config), telemetryOverride, verbose = false, onTelemetryError, onRoute } = {}) {
  return createServer(async (req, res) => {
    const startedAt = performance.now();
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'OPTIONS') {
        return sendEmpty(res, 204);
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { ok: true, name: 'proofroute', latency_ms: 0 });
      }
      if (req.method === 'GET' && url.pathname === '/ready') {
        const readiness = runtime.readiness({ controller });
        return sendJson(res, readiness.ok ? 200 : 503, readiness);
      }
      if (req.method === 'GET' && url.pathname === '/v1/models') {
        return sendJson(res, 200, runtime.modelList({ controller }));
      }
      const isChatCompletion = req.method === 'POST' && url.pathname === '/v1/chat/completions';
      const isCompletion = req.method === 'POST' && url.pathname === '/v1/completions';
      const isResponse = req.method === 'POST' && url.pathname === '/v1/responses';
      if (!isChatCompletion && !isCompletion && !isResponse) {
        return sendJson(res, 404, { error: { message: 'Supported routes are GET /health, GET /ready, GET /v1/models, POST /v1/chat/completions, POST /v1/completions, and POST /v1/responses.' } });
      }
      const body = await readJson(req);
      const prompt = extractPrompt(body);
      const clientModel = requestedClientModel(body);
      const routeStartedAt = performance.now();
      const decision = await controller.routeAsync({ prompt, requestedModel: requestedModel(body), executableOnly: true, policy: requestedPolicy(body, req.headers), outputTokens: requestedOutputTokens(body), maxCostUsd: requestedMaxCostUsd(body, req.headers), maxLatencyMs: requestedMaxLatencyMs(body, req.headers) });
      const routerDecisionMs = Math.max(0, performance.now() - routeStartedAt);
      const upstream = isResponse ? await runtime.executeResponse({ body, decision }) : isCompletion ? await runtime.executeCompletion({ body, decision }) : await runtime.executeRoutedChatCompletion({ body, decision });
      const finalDecision = upstream.decision ?? decision;
      const modelSwap = routeModelSwap(clientModel, finalDecision.model.id);
      const routerOverheadPct = routerOverheadPercent(routerDecisionMs, finalDecision);
      const elapsedMs = Math.max(0, performance.now() - startedAt);
      const actualUsage = extractActualUsage(upstream.body);
      const actualEconomics = actualUsage ? actualEconomicsFor(finalDecision, actualUsage, config) : {};
      const route = {
        decision: finalDecision,
        requestedModel: clientModel,
        modelSwap,
        status: upstream.status,
        routerDecisionMs,
        routerOverheadPct,
        endToEndMs: elapsedMs,
        stream: Boolean(body.stream),
        fallback: upstream.fallback,
        actualUsage,
        ...actualEconomics
      };
      const telemetryWrite = recordRouteEvent(telemetryPath(config, telemetryOverride), routeEvent(route)).catch((error) => {
        if (typeof onTelemetryError === 'function') onTelemetryError(error);
        if (verbose) process.stderr.write(`telemetry failed: ${error.message}\n`);
      });
      if (typeof onRoute === 'function') onRoute({ ...route, upstream, telemetryWrite, request: { method: req.method, path: url.pathname } });
      res.setHeader('x-proofroute-model', finalDecision.model.id);
      res.setHeader('x-proofroute-requested-model', headerToken(clientModel, 'none'));
      res.setHeader('x-proofroute-model-swap', modelSwap ? 'true' : 'false');
      res.setHeader('x-proofroute-policy', finalDecision.policy);
      res.setHeader('x-proofroute-intent', finalDecision.intent.name);
      res.setHeader('x-proofroute-runner-up', headerToken(runnerUpModel(finalDecision), 'none'));
      res.setHeader('x-proofroute-saved-usd', finalDecision.economics.savingsUsd.toFixed(6));
      res.setHeader('x-proofroute-savings-pct', percentHeader(finalDecision.economics.savingsPct));
      res.setHeader('x-proofroute-speedup', ratioHeader(finalDecision.performance.speedup));
      res.setHeader('x-proofroute-decision-ms', routerDecisionMs.toFixed(2));
      res.setHeader('x-proofroute-router-overhead-pct', routerOverheadPct.toFixed(4));
      res.setHeader('x-proofroute-cache', finalDecision.cache?.hit ? 'hit' : 'miss');
      res.setHeader('x-proofroute-stream', body.stream ? 'true' : 'false');
      res.setHeader('x-proofroute-usage-source', actualUsage ? 'actual' : 'estimate');
      res.setHeader('x-proofroute-estimated-tokens', String(finalDecision.inputTokens + finalDecision.outputTokens));
      res.setHeader('x-proofroute-context-window', String(finalDecision.model.contextWindow));
      res.setHeader('x-proofroute-context-use-pct', contextUsePercent(finalDecision).toFixed(4));
      res.setHeader('x-proofroute-estimated-cost-usd', finalDecision.economics.estimatedCostUsd.toFixed(6));
      res.setHeader('x-proofroute-baseline-cost-usd', finalDecision.economics.baselineCostUsd.toFixed(6));
      res.setHeader('x-proofroute-estimated-latency-ms', finalDecision.performance.estimatedLatencyMs.toFixed(2));
      res.setHeader('x-proofroute-baseline-latency-ms', finalDecision.performance.baselineLatencyMs.toFixed(2));
      res.setHeader('server-timing', serverTimingHeader({ routerDecisionMs, elapsedMs }));
      const classifierProof = classifierProofHeaders(finalDecision.intent?.features);
      res.setHeader('x-proofroute-classifier-backend', classifierProof.backend);
      res.setHeader('x-proofroute-classifier-circuit', classifierProof.circuit);
      res.setHeader('x-proofroute-classifier-failures', classifierProof.failures);
      if (actualUsage) {
        res.setHeader('x-proofroute-actual-tokens', String(actualUsage.totalTokens));
        res.setHeader('x-proofroute-actual-cost-usd', actualEconomics.actualCostUsd.toFixed(6));
        res.setHeader('x-proofroute-actual-saved-usd', actualEconomics.actualSavingsUsd.toFixed(6));
      }
      if (upstream.fallback) res.setHeader('x-proofroute-fallback', `${upstream.fallback.from}->${upstream.fallback.to}`);
      return sendRaw(res, upstream.status, upstream.headers, upstream.body, elapsedMs);
    } catch (error) {
      const status = error instanceof ProxyRequestError ? error.status : 500;
      return sendJson(res, error.status ?? status, { error: { message: error.message, code: error.code, details: error.details } });
    }
  });
}

export function startProxy({ config, controller, runtime, port = 8787, host = '127.0.0.1', telemetryOverride, verbose, onTelemetryError, onRoute } = {}) {
  const server = createProxyServer({ config, controller, runtime, telemetryOverride, verbose, onTelemetryError, onRoute });
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      const resolvedHost = typeof address === 'object' && address ? address.address : host;
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      const origin = `http://${normalizeHost(resolvedHost)}:${resolvedPort}`;
      resolve({
        server,
        origin,
        url: `${origin}/v1/chat/completions`,
        close: () => new Promise((done, fail) => server.close((error) => error ? fail(error) : done()))
      });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

export function extractPrompt(body) {
  const responsesText = responsesInputToText(body.input);
  if (responsesText) return [body.instructions, responsesText].filter(Boolean).join('\n');
  if (typeof body.prompt === 'string') return body.prompt;
  if (!Array.isArray(body.messages)) return '';
  return body.messages.map((message) => {
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => typeof part.text === 'string' ? part.text : '').join('\n');
    }
    return '';
  }).join('\n');
}

export function requestedOutputTokens(body) {
  const value = body.max_output_tokens ?? body.max_completion_tokens ?? body.max_tokens;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : undefined;
}

export function requestedPolicy(body, headers = {}) {
  return body.metadata?.proofroute_policy ?? body.metadata?.policy ?? headerValue(headers, 'x-proofroute-policy') ?? policyAlias(body.model);
}

export function requestedModel(body) {
  const model = requestedClientModel(body);
  return policyAlias(model) ? undefined : model;
}

export function requestedClientModel(body) {
  const model = body?.model;
  return typeof model === 'string' && model.trim() ? model.trim() : undefined;
}

export function routeModelSwap(requested, routed) {
  return Boolean(requested && routed && requested !== routed);
}

export function requestedMaxCostUsd(body, headers = {}) {
  return parseNonNegativeNumber(body.metadata?.proofroute_max_cost_usd ?? body.metadata?.max_cost_usd ?? headerValue(headers, 'x-proofroute-max-cost-usd'));
}

export function requestedMaxLatencyMs(body, headers = {}) {
  return parseNonNegativeNumber(body.metadata?.proofroute_max_latency_ms ?? body.metadata?.max_latency_ms ?? headerValue(headers, 'x-proofroute-max-latency-ms'));
}

export function parseNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProxyRequestError(400, `Malformed JSON request body: ${error.message}`);
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...corsHeaders(),
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendEmpty(res, status) {
  res.writeHead(status, corsHeaders());
  res.end();
}

function sendRaw(res, status, headers, body, elapsedMs) {
  const safeHeaders = Object.fromEntries(Object.entries(headers ?? {}).filter(([key]) => {
    const normalized = key.toLowerCase();
    return !['content-encoding', 'transfer-encoding', 'connection', 'keep-alive', 'server-timing'].includes(normalized) && !normalized.startsWith('x-proofroute-');
  }));
  safeHeaders['x-proofroute-latency-ms'] = elapsedMs.toFixed(2);
  res.writeHead(status, {
    ...corsHeaders(),
    ...safeHeaders
  });
  if (isAsyncIterable(body)) {
    writeStream(res, body);
  } else {
    res.end(body);
  }
}

function extractActualUsage(body) {
  if (!Buffer.isBuffer(body)) return undefined;
  try {
    const payload = JSON.parse(body.toString('utf8'));
    return normalizeUsage(payload.usage);
  } catch {
    return undefined;
  }
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens = usageNumber(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = usageNumber(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = usageNumber(usage.total_tokens ?? inputTokens + outputTokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  const resolvedInput = inputTokens ?? 0;
  const resolvedOutput = outputTokens ?? Math.max(0, (totalTokens ?? 0) - resolvedInput);
  return {
    inputTokens: resolvedInput,
    outputTokens: resolvedOutput,
    totalTokens: totalTokens ?? resolvedInput + resolvedOutput
  };
}

function actualEconomicsFor(decision, usage, config) {
  const model = decision.model;
  const baselineModel = baselineModelFor(decision, config) ?? model;
  const actualCostUsd = usageCost(model, usage);
  const actualBaselineCostUsd = usageCost(baselineModel, usage);
  return {
    actualCostUsd,
    actualBaselineCostUsd,
    actualSavingsUsd: Math.max(0, actualBaselineCostUsd - actualCostUsd)
  };
}

function baselineModelFor(decision, config) {
  const baseline = (decision.ranked ?? []).reduce((best, candidate) => {
    if (!best || candidate.estimatedCostUsd > best.estimatedCostUsd) return candidate;
    return best;
  }, undefined);
  return config.models?.find((model) => model.id === baseline?.model);
}

function usageCost(model, usage) {
  return usage.inputTokens / 1_000_000 * model.inputUsdPer1M + usage.outputTokens / 1_000_000 * model.outputUsdPer1M;
}

function usageNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function runnerUpModel(decision) {
  return decision.ranked?.find((candidate) => candidate.model !== decision.model.id)?.model;
}

function contextUsePercent(decision) {
  const requiredTokens = Number(decision.inputTokens) + Number(decision.outputTokens);
  const contextWindow = Number(decision.model?.contextWindow);
  if (!Number.isFinite(requiredTokens) || !Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
  return Math.max(0, requiredTokens / contextWindow * 100);
}

function percentHeader(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? (parsed * 100).toFixed(4) : '0.0000';
}

function ratioHeader(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(4) : '0.0000';
}

async function writeStream(res, body) {
  try {
    for await (const chunk of body) {
      if (!res.write(chunk)) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (error) {
    res.destroy(error);
  }
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'timing-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-proofroute-policy,x-proofroute-max-cost-usd,x-proofroute-max-latency-ms',
    'access-control-expose-headers': EXPOSED_PROOFROUTE_HEADERS.join(',')
  };
}

function classifierProofHeaders(features = {}) {
  return {
    backend: headerToken(features.backend, 'unknown'),
    circuit: features.classifierCircuitOpen ? 'open' : 'closed',
    failures: nonNegativeInteger(features.classifierFailures)
  };
}

function headerToken(value, fallback) {
  const text = String(value ?? fallback ?? '').trim();
  const safe = text.replace(/[^\w./:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return safe || String(fallback ?? 'unknown');
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? String(Math.floor(parsed)) : '0';
}

function serverTimingHeader({ routerDecisionMs, elapsedMs }) {
  return `proofroute-router;dur=${routerDecisionMs.toFixed(2)}, proofroute-total;dur=${elapsedMs.toFixed(2)}`;
}

function routerOverheadPercent(routerDecisionMs, decision) {
  const estimatedLatencyMs = Number(decision.performance?.estimatedLatencyMs);
  return Number.isFinite(estimatedLatencyMs) && estimatedLatencyMs > 0 ? routerDecisionMs / estimatedLatencyMs * 100 : 0;
}

function headerValue(headers, key) {
  const value = headers?.[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function policyAlias(model) {
  if (typeof model !== 'string') return undefined;
  const normalized = model.toLowerCase();
  if (normalized === 'proofroute') return 'balanced';
  const match = normalized.match(/^proofroute[/:](\w+)$/);
  if (!match) return undefined;
  const policy = match[1] === 'auto' ? 'balanced' : match[1];
  return ROUTING_POLICIES.includes(policy) ? policy : undefined;
}

function isAsyncIterable(value) {
  return value && typeof value[Symbol.asyncIterator] === 'function';
}

function normalizeHost(host) {
  if (host === '::' || host === '::1') return '[::1]';
  return host;
}

class ProxyRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
