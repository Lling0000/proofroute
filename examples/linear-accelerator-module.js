import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateTokens, stableSoftmax } from '../src/controller/intent.js';

const defaultModelPath = fileURLToPath(new URL('./linear-intent-model.json', import.meta.url));
const warmedDevices = new Set();
let compiledModel;

export async function warmup(context = {}) {
  await loadModel();
  warmedDevices.add(String(context.device ?? 'cpu'));
}

export async function classifyMany(prompts, context = {}) {
  const model = await loadModel();
  const device = String(context.device ?? 'cpu');
  return prompts.map((prompt) => classifyPrompt(String(prompt ?? ''), model, {
    device,
    warmed: warmedDevices.has(device),
    batchSize: context.batchSize ?? prompts.length,
    shardSize: context.shardSize ?? prompts.length
  }));
}

async function loadModel() {
  if (compiledModel) return compiledModel;
  const path = resolve(process.env.PROOFROUTE_ACCELERATOR_MODEL || defaultModelPath);
  const artifact = JSON.parse(await readFile(path, 'utf8'));
  compiledModel = compileModel(artifact);
  return compiledModel;
}

function compileModel(artifact) {
  const intents = Array.isArray(artifact.intents) && artifact.intents.length ? artifact.intents.map(String) : Object.keys(artifact.weights ?? {});
  const weights = {};
  for (const intent of intents) {
    weights[intent] = normalizeWeights(artifact.weights?.[intent]);
  }
  return {
    name: String(artifact.name ?? 'linear-intent-model'),
    version: artifact.version ?? 1,
    intents,
    weights,
    bias: artifact.bias ?? {},
    temperature: Number.isFinite(Number(artifact.temperature)) ? Number(artifact.temperature) : 1,
    longContextChars: Number.isFinite(Number(artifact.longContextChars)) ? Number(artifact.longContextChars) : 18000
  };
}

function classifyPrompt(prompt, model, metadata) {
  const text = normalize(prompt);
  const tokens = tokenize(text);
  const tokenCounts = countTokens(tokens);
  const features = extractFeatures(prompt, model, metadata);
  const scores = model.intents.map((intent) => scoreIntent(intent, model, tokenCounts, features));
  const probabilities = stableSoftmax(scores, model.temperature);
  const ranked = model.intents
    .map((name, index) => ({ name, score: scores[index], probability: probabilities[index] }))
    .sort((a, b) => b.probability - a.probability);
  return {
    name: ranked[0]?.name ?? 'chat',
    confidence: ranked[0]?.probability ?? 1,
    ranked,
    features
  };
}

function scoreIntent(intent, model, tokenCounts, features) {
  let score = Number(model.bias?.[intent] ?? 0.01);
  const weights = model.weights[intent] ?? {};
  for (const [token, count] of tokenCounts) {
    score += (weights[token] ?? 0) * count;
  }
  if (intent === 'code' && features.hasCodeFence) score += 2.8;
  if (intent === 'code' && features.hasStackTrace) score += 2.1;
  if (intent === 'extraction' && features.hasJson) score += 1.4;
  if (intent === 'long_context') score += Math.min(2.4, features.chars / model.longContextChars);
  return score;
}

function extractFeatures(prompt, model, metadata) {
  return {
    chars: prompt.length,
    tokens: estimateTokens(prompt),
    hasCodeFence: /```/.test(prompt),
    hasJson: /[{[]\s*["\w-]+["\w-]*\s*:/.test(prompt),
    hasStackTrace: /at\s+\S+\s+\(|Traceback|Exception|Error:/.test(prompt),
    adapter: 'linear-accelerator-module',
    artifact: model.name,
    artifactVersion: model.version,
    warmed: metadata.warmed,
    moduleDevice: metadata.device,
    moduleBatchSize: metadata.batchSize,
    moduleShardSize: metadata.shardSize
  };
}

function normalizeWeights(weights) {
  const normalized = {};
  for (const [token, weight] of Object.entries(weights ?? {})) {
    normalized[normalizeToken(String(token))] = Number(weight);
  }
  return normalized;
}

function normalize(prompt) {
  return prompt.toLowerCase().replace(/[_./:-]/g, ' ');
}

function tokenize(text) {
  return (text.match(/[a-z0-9]+|[\u3400-\u9FFF]+/g) ?? []).flatMap((token) => {
    const normalized = normalizeToken(token);
    return normalized === token ? [token] : [token, normalized];
  });
}

function normalizeToken(token) {
  if (!/^[a-z]+$/.test(token) || token.length < 5) return token;
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('offs')) return token.slice(0, -1);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function countTokens(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}
