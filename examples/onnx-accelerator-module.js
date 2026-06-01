import { basename } from 'node:path';
import { estimateTokens, stableSoftmax } from '../src/controller/intent.js';

const INTENTS = Object.freeze(['code', 'reasoning', 'writing', 'extraction', 'long_context', 'chat']);
const FEATURE_NAMES = Object.freeze([
  'chars_k',
  'tokens_k',
  'has_code_fence',
  'has_json',
  'has_stack_trace',
  'code',
  'refactor',
  'test',
  'bug',
  'function',
  'extract',
  'json',
  'invoice',
  'rewrite',
  'launch',
  'write',
  'compare',
  'tradeoff',
  'reason',
  'document',
  'repository',
  'explain'
]);

const warmedDevices = new Set();
let sessionPromise;

export async function warmup(context = {}) {
  await loadSession();
  warmedDevices.add(String(context.device ?? 'cpu'));
}

export async function classifyMany(prompts, context = {}) {
  const loaded = await loadSession();
  const device = String(context.device ?? 'cpu');
  const tensor = featureTensor(prompts, loaded.ort);
  const outputs = await loaded.session.run({ [loaded.inputName]: tensor });
  const output = selectOutput(outputs, loaded.outputName, loaded.session.outputNames);
  return logitsToIntents(output, prompts, {
    ...loaded,
    device,
    warmed: warmedDevices.has(device),
    batchSize: context.batchSize ?? prompts.length,
    shardSize: context.shardSize ?? prompts.length
  });
}

async function loadSession() {
  if (!sessionPromise) {
    sessionPromise = createSession().catch((error) => {
      sessionPromise = undefined;
      throw error;
    });
  }
  return sessionPromise;
}

async function createSession() {
  const runtimePackage = nonEmpty(process.env.PROOFROUTE_ONNX_RUNTIME_PACKAGE) ?? 'onnxruntime-node';
  const ortModule = await importRuntime(runtimePackage);
  const ort = ortModule.default ?? ortModule;
  const modelPath = nonEmpty(process.env.PROOFROUTE_ONNX_MODEL) ?? nonEmpty(process.env.PROOFROUTE_ACCELERATOR_MODEL);
  if (!modelPath) throw new Error('ProofRoute ONNX accelerator requires PROOFROUTE_ONNX_MODEL or PROOFROUTE_ACCELERATOR_MODEL.');
  const executionProviders = splitList(process.env.PROOFROUTE_ONNX_EXECUTION_PROVIDERS);
  const options = executionProviders.length ? { executionProviders } : {};
  const session = await ort.InferenceSession.create(modelPath, options);
  return {
    ort,
    session,
    runtimePackage,
    modelPath,
    modelName: basename(modelPath),
    executionProviders,
    inputName: nonEmpty(process.env.PROOFROUTE_ONNX_INPUT) ?? session.inputNames?.[0] ?? 'input',
    outputName: nonEmpty(process.env.PROOFROUTE_ONNX_OUTPUT) ?? session.outputNames?.[0],
    temperature: normalizeTemperature(process.env.PROOFROUTE_ONNX_TEMPERATURE)
  };
}

async function importRuntime(runtimePackage) {
  try {
    return await import(runtimePackage);
  } catch (error) {
    throw new Error(`ProofRoute ONNX accelerator requires optional package ${runtimePackage}. Install it or set PROOFROUTE_ONNX_RUNTIME_PACKAGE to a compatible module. Original error: ${error.message}`);
  }
}

function featureTensor(prompts, ort) {
  const data = new Float32Array(prompts.length * FEATURE_NAMES.length);
  prompts.forEach((prompt, row) => {
    const features = extractFeatures(String(prompt ?? ''));
    for (let column = 0; column < FEATURE_NAMES.length; column += 1) {
      data[row * FEATURE_NAMES.length + column] = features[FEATURE_NAMES[column]] ?? 0;
    }
  });
  return new ort.Tensor('float32', data, [prompts.length, FEATURE_NAMES.length]);
}

function extractFeatures(prompt) {
  const tokens = countTokens(tokenize(normalize(prompt)));
  return {
    chars_k: prompt.length / 1000,
    tokens_k: estimateTokens(prompt) / 1000,
    has_code_fence: /```/.test(prompt) ? 1 : 0,
    has_json: /[{[]\s*["\w-]+["\w-]*\s*:/.test(prompt) ? 1 : 0,
    has_stack_trace: /at\s+\S+\s+\(|Traceback|Exception|Error:/.test(prompt) ? 1 : 0,
    code: tokens.get('code') ?? 0,
    refactor: tokens.get('refactor') ?? 0,
    test: tokens.get('test') ?? 0,
    bug: tokens.get('bug') ?? 0,
    function: tokens.get('function') ?? 0,
    extract: tokens.get('extract') ?? 0,
    json: tokens.get('json') ?? 0,
    invoice: tokens.get('invoice') ?? 0,
    rewrite: tokens.get('rewrite') ?? 0,
    launch: tokens.get('launch') ?? 0,
    write: tokens.get('write') ?? 0,
    compare: tokens.get('compare') ?? 0,
    tradeoff: tokens.get('tradeoff') ?? 0,
    reason: tokens.get('reason') ?? 0,
    document: tokens.get('document') ?? 0,
    repository: tokens.get('repository') ?? 0,
    explain: tokens.get('explain') ?? 0
  };
}

function selectOutput(outputs, outputName, outputNames = []) {
  if (outputName && outputs?.[outputName]) return outputs[outputName];
  const firstName = outputNames.find((name) => outputs?.[name]) ?? Object.keys(outputs ?? {})[0];
  const output = firstName ? outputs[firstName] : undefined;
  if (!output?.data) throw new Error('ProofRoute ONNX accelerator expected a tensor output with logits.');
  return output;
}

function logitsToIntents(output, prompts, metadata) {
  const columns = Number(output.dims?.[output.dims.length - 1] ?? INTENTS.length);
  const rows = Number(output.dims?.[0] ?? prompts.length);
  if (rows < prompts.length || columns < INTENTS.length) throw new Error('ProofRoute ONNX accelerator output shape does not match the intent catalog.');
  return prompts.map((prompt, row) => {
    const scores = INTENTS.map((_, column) => Number(output.data[row * columns + column] ?? Number.NEGATIVE_INFINITY));
    const probabilities = stableSoftmax(scores, metadata.temperature);
    const ranked = INTENTS
      .map((name, index) => ({ name, score: scores[index], probability: probabilities[index] }))
      .sort((a, b) => b.probability - a.probability);
    return {
      name: ranked[0]?.name ?? 'chat',
      confidence: ranked[0]?.probability ?? 1,
      ranked,
      features: {
        chars: String(prompt ?? '').length,
        tokens: estimateTokens(String(prompt ?? '')),
        adapter: 'onnx-accelerator-module',
        runtime: metadata.runtimePackage,
        model: metadata.modelName,
        executionProviders: metadata.executionProviders,
        warmed: metadata.warmed,
        moduleDevice: metadata.device,
        moduleBatchSize: metadata.batchSize,
        moduleShardSize: metadata.shardSize,
        featureCount: FEATURE_NAMES.length
      }
    };
  });
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

function splitList(value) {
  return String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text ? text : undefined;
}

function normalizeTemperature(value) {
  const number = Number(value ?? 1);
  return Number.isFinite(number) && number > 0 ? number : 1;
}
