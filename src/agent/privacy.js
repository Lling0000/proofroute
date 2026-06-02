import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const privacyAllowedEvidenceKeys = Object.freeze([
  'ts',
  'model',
  'requestedModel',
  'modelSwap',
  'provider',
  'local',
  'policy',
  'intent',
  'classifierBackend',
  'classifierCircuitOpen',
  'classifierFailures',
  'confidence',
  'inputTokens',
  'outputTokens',
  'requiredTokens',
  'contextWindow',
  'contextUsePct',
  'runnerUpModel',
  'baselineModel',
  'candidateCount',
  'rejectedCount',
  'rejectedReasons',
  'estimatedCostUsd',
  'baselineCostUsd',
  'savingsUsd',
  'actualInputTokens',
  'actualOutputTokens',
  'actualTotalTokens',
  'actualCostUsd',
  'actualBaselineCostUsd',
  'actualSavingsUsd',
  'speedup',
  'estimatedLatencyMs',
  'baselineLatencyMs',
  'routerLatencyMs',
  'routerDecisionMs',
  'routerOverheadPct',
  'endToEndMs',
  'cacheHit',
  'fallbackUsed',
  'stream',
  'status'
]);

const forbiddenKeyNames = new Set([
  'prompt',
  'prompts',
  'message',
  'messages',
  'content',
  'completion',
  'completions',
  'text',
  'input',
  'output',
  'request',
  'requestbody',
  'response',
  'responsebody',
  'apikey',
  'authorization',
  'secret',
  'token'
]);

export async function privacyReport(path = '.proofroute/events.jsonl') {
  const resolvedPath = resolve(String(path));
  let text;
  try {
    text = await readFile(resolvedPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return buildReport({
      path: resolvedPath,
      exists: false,
      events: 0,
      bytes: 0,
      scannedKeys: 0,
      uniqueKeys: new Set(),
      forbiddenMatchCount: 0,
      forbiddenMatches: [],
      parseErrorCount: 0,
      parseErrors: []
    });
  }

  const state = {
    path: resolvedPath,
    exists: true,
    events: 0,
    bytes: Buffer.byteLength(text, 'utf8'),
    scannedKeys: 0,
    uniqueKeys: new Set(),
    forbiddenMatchCount: 0,
    forbiddenMatches: [],
    parseErrorCount: 0,
    parseErrors: []
  };

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    state.events += 1;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      state.parseErrorCount += 1;
      if (state.parseErrors.length < 50) {
        state.parseErrors.push({ line: index + 1, message: 'Invalid JSONL record' });
      }
      continue;
    }
    scanValue(event, '$', index + 1, state);
  }

  return buildReport(state);
}

export async function privacyRepairReport({ path = '.proofroute/events.jsonl', out, config = {}, force = false } = {}) {
  if (!out) throw new Error('Pass --out .proofroute/events.repaired.jsonl to write a prompt-free repaired ledger.');
  const resolvedPath = resolve(String(path));
  const outPath = resolve(String(out));
  if (outPath === resolvedPath) throw new Error('Refusing to repair in place; pass --out with a different path.');
  if (!force) {
    try {
      await stat(outPath);
      throw new Error(`Refusing to overwrite existing repaired ledger at ${outPath}; pass --force to replace it.`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  let text;
  try {
    text = await readFile(resolvedPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      kind: 'proofroute-ledger-repair-v1',
      status: 'fail',
      path: resolvedPath,
      outPath,
      exists: false,
      inputRecords: 0,
      repairedEvents: 0,
      forbiddenMatchCount: 0,
      parseErrorCount: 0,
      parseErrors: [],
      allowedEvidenceKeys: [...privacyAllowedEvidenceKeys],
      message: 'No telemetry ledger exists yet, so no repaired ledger was written.'
    };
  }

  const state = {
    path: resolvedPath,
    exists: true,
    events: 0,
    bytes: Buffer.byteLength(text, 'utf8'),
    scannedKeys: 0,
    uniqueKeys: new Set(),
    forbiddenMatchCount: 0,
    forbiddenMatches: [],
    parseErrorCount: 0,
    parseErrors: []
  };
  const repaired = [];
  let droppedEmptyEvidence = 0;
  const context = repairContext(config);
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    state.events += 1;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      state.parseErrorCount += 1;
      if (state.parseErrors.length < 50) {
        state.parseErrors.push({ line: index + 1, message: 'Invalid JSONL record' });
      }
      continue;
    }
    scanValue(event, '$', index + 1, state);
    const repairedEvent = repairTelemetryEvent(event, context);
    if (!hasRepairEvidence(repairedEvent)) {
      droppedEmptyEvidence += 1;
      continue;
    }
    repaired.push(repairedEvent);
  }

  const output = repaired.map((event) => JSON.stringify(event)).join('\n');
  await mkdir(dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await writeFile(tempPath, output ? `${output}\n` : '', 'utf8');
  await rename(tempPath, outPath);
  const outputPrivacy = await privacyReport(outPath);
  return {
    kind: 'proofroute-ledger-repair-v1',
    status: 'pass',
    path: resolvedPath,
    outPath,
    exists: true,
    inputRecords: state.events,
    repairedEvents: repaired.length,
    droppedEmptyEvidence,
    force: Boolean(force),
    forbiddenMatchCount: state.forbiddenMatchCount,
    forbiddenMatches: state.forbiddenMatches,
    parseErrorCount: state.parseErrorCount,
    parseErrors: state.parseErrors,
    outputPrivacy,
    allowedEvidenceKeys: [...privacyAllowedEvidenceKeys],
    message: `Wrote ${repaired.length} prompt-free telemetry events to ${outPath}, dropped ${state.parseErrorCount} malformed JSONL records and ${droppedEmptyEvidence} records without trusted route evidence, and preserved only allowed routing evidence keys.`
  };
}

function repairContext(config) {
  const models = new Set((config.models ?? []).map((model) => String(model.id ?? '')).filter(Boolean));
  const providers = new Set([
    ...Object.keys(config.providers ?? {}),
    'local',
    'openai',
    'anthropic',
    'ollama',
    'unknown'
  ]);
  const intents = new Set(['code', 'reasoning', 'writing', 'extraction', 'long_context', 'chat', 'unknown']);
  for (const model of config.models ?? []) {
    Object.keys(model.quality ?? {}).forEach((intent) => intents.add(String(intent)));
  }
  return {
    models,
    providers,
    intents,
    policies: new Set(['balanced', 'save', 'fast', 'quality', 'local', 'unknown'])
  };
}

function repairTelemetryEvent(event, context) {
  const inputTokens = finite(event.inputTokens);
  const outputTokens = finite(event.outputTokens);
  return {
    ts: repairTimestamp(event.ts),
    model: repairModelId(event.model, context, 'unknown'),
    requestedModel: repairModelId(event.requestedModel, context, ''),
    modelSwap: Boolean(event.modelSwap),
    provider: repairKnown(event.provider, context.providers, 'unknown'),
    local: Boolean(event.local),
    policy: repairKnown(event.policy, context.policies, 'unknown'),
    intent: repairKnown(event.intent, context.intents, 'unknown'),
    classifierBackend: repairClassifierBackend(event.classifierBackend),
    classifierCircuitOpen: Boolean(event.classifierCircuitOpen),
    classifierFailures: finite(event.classifierFailures),
    confidence: finite(event.confidence),
    inputTokens,
    outputTokens,
    requiredTokens: finite(event.requiredTokens) || inputTokens + outputTokens,
    contextWindow: finite(event.contextWindow),
    contextUsePct: finite(event.contextUsePct),
    runnerUpModel: repairModelId(event.runnerUpModel, context, ''),
    baselineModel: repairModelId(event.baselineModel, context, ''),
    candidateCount: finite(event.candidateCount),
    rejectedCount: finite(event.rejectedCount),
    rejectedReasons: repairRejectedReasons(event.rejectedReasons),
    estimatedCostUsd: finite(event.estimatedCostUsd),
    baselineCostUsd: finite(event.baselineCostUsd),
    savingsUsd: finite(event.savingsUsd),
    actualInputTokens: finite(event.actualInputTokens),
    actualOutputTokens: finite(event.actualOutputTokens),
    actualTotalTokens: finite(event.actualTotalTokens),
    actualCostUsd: finite(event.actualCostUsd),
    actualBaselineCostUsd: finite(event.actualBaselineCostUsd),
    actualSavingsUsd: finite(event.actualSavingsUsd),
    speedup: finite(event.speedup),
    estimatedLatencyMs: finite(event.estimatedLatencyMs),
    baselineLatencyMs: finite(event.baselineLatencyMs),
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

function hasRepairEvidence(event) {
  const hasIdentity = event.model !== 'unknown' || event.requestedModel || event.provider !== 'unknown' || event.policy !== 'unknown' || event.intent !== 'unknown';
  const hasNumbers = [
    event.routerLatencyMs,
    event.estimatedLatencyMs,
    event.savingsUsd,
    event.actualSavingsUsd,
    event.speedup,
    event.inputTokens,
    event.outputTokens
  ].some((value) => Number(value) > 0);
  return hasIdentity && hasNumbers;
}

function repairTimestamp(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function repairModelId(value, context, fallback) {
  const text = String(value ?? '').trim();
  if (context.models.has(text) || /^proofroute\/[a-z0-9_.:-]+$/i.test(text)) return text;
  return fallback;
}

function repairKnown(value, known, fallback) {
  const text = String(value ?? '').trim();
  return known.has(text) ? text : fallback;
}

function repairClassifierBackend(value) {
  const text = String(value ?? '').trim();
  const known = new Set(['builtin', 'builtin-circuit-open', 'external-url', 'command', 'persistent-command', 'linear-artifact', 'onnx', 'tensorrt', 'unknown']);
  return known.has(text) ? text : 'unknown';
}

function repairRejectedReasons(value) {
  const known = new Set(['context_window', 'max_cost', 'max_latency', 'not_executable', 'missing_provider', 'unknown']);
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => known.has(entry))
    .slice(0, 8)
    .join(',');
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function scanValue(value, path, line, state) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanValue(entry, `${path}[${index}]`, line, state));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    const keyPath = objectPath(path, key);
    const normalized = normalizeKey(key);
    state.scannedKeys += 1;
    state.uniqueKeys.add(normalized);
    if (forbiddenKeyNames.has(normalized)) {
      state.forbiddenMatchCount += 1;
      if (state.forbiddenMatches.length < 50) {
        state.forbiddenMatches.push({ line, path: keyPath, key });
      }
    }
    scanValue(entry, keyPath, line, state);
  }
}

function buildReport(state) {
  const status = state.forbiddenMatchCount > 0 || state.parseErrorCount > 0 ? 'fail' : 'pass';
  const message = !state.exists
    ? 'No telemetry ledger exists yet, so the privacy proof has no records to audit.'
    : status === 'pass'
      ? 'Telemetry ledger records only prompt-free routing evidence in the audited records.'
      : 'Telemetry ledger contains prompt-bearing fields, credential-bearing fields, or invalid JSONL records.';
  return {
    status,
    path: state.path,
    exists: state.exists,
    events: state.events,
    bytes: state.bytes,
    scannedKeys: state.scannedKeys,
    uniqueKeyCount: state.uniqueKeys.size,
    forbiddenMatchCount: state.forbiddenMatchCount,
    forbiddenMatches: state.forbiddenMatches,
    parseErrorCount: state.parseErrorCount,
    parseErrors: state.parseErrors,
    allowedEvidenceKeys: [...privacyAllowedEvidenceKeys],
    message
  };
}

function normalizeKey(key) {
  return String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function objectPath(parent, key) {
  const safe = /^[A-Za-z_$][\w$]*$/.test(key);
  if (safe) return `${parent}.${key}`;
  return `${parent}[${JSON.stringify(String(key))}]`;
}
