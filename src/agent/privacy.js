import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

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
