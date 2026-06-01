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
const enginePromises = new Map();
let runtimePromise;

export async function warmup(context = {}) {
  const device = String(context.device ?? '0');
  await loadEngine(device);
  warmedDevices.add(device);
}

export async function warmupAll(context = {}) {
  const devices = Array.isArray(context.devices) && context.devices.length ? context.devices : [context.device ?? '0'];
  await Promise.all(devices.map((device) => warmup({ ...context, device })));
}

export async function classifyMany(prompts, context = {}) {
  const device = String(context.device ?? '0');
  const loaded = await loadEngine(device);
  const input = featureTensor(prompts);
  const output = await runEngine(loaded.engine, loaded.inputName, input, loaded.outputName, {
    device,
    batchSize: context.batchSize ?? prompts.length,
    shardSize: context.shardSize ?? prompts.length
  });
  return logitsToIntents(output, prompts, {
    ...loaded,
    device,
    warmed: warmedDevices.has(device),
    batchSize: context.batchSize ?? prompts.length,
    shardSize: context.shardSize ?? prompts.length
  });
}

async function loadEngine(device) {
  const key = String(device ?? '0');
  if (!enginePromises.has(key)) {
    enginePromises.set(key, createEngine(key).catch((error) => {
      enginePromises.delete(key);
      throw error;
    }));
  }
  return enginePromises.get(key);
}

async function createEngine(device) {
  const runtimePackage = nonEmpty(process.env.PROOFROUTE_TENSORRT_RUNTIME_PACKAGE) ?? '@proofroute/tensorrt-runtime';
  const runtimeModule = await loadRuntime(runtimePackage);
  const runtime = runtimeModule.default ?? runtimeModule;
  const enginePath = nonEmpty(process.env.PROOFROUTE_TENSORRT_ENGINE) ?? nonEmpty(process.env.PROOFROUTE_ACCELERATOR_MODEL);
  if (!enginePath) throw new Error('ProofRoute TensorRT accelerator requires PROOFROUTE_TENSORRT_ENGINE or PROOFROUTE_ACCELERATOR_MODEL.');
  const precision = nonEmpty(process.env.PROOFROUTE_TENSORRT_PRECISION) ?? 'fp16';
  const inputName = nonEmpty(process.env.PROOFROUTE_TENSORRT_INPUT) ?? 'input';
  const outputName = nonEmpty(process.env.PROOFROUTE_TENSORRT_OUTPUT) ?? 'logits';
  const maxBatchSize = normalizePositiveInteger(process.env.PROOFROUTE_TENSORRT_MAX_BATCH_SIZE, 16);
  const options = {
    device,
    precision,
    inputName,
    outputName,
    maxBatchSize
  };
  const engine = await createRuntimeEngine(runtime, enginePath, options);
  return {
    engine,
    runtimePackage,
    enginePath,
    engineName: basename(enginePath),
    precision,
    inputName,
    outputName,
    maxBatchSize,
    temperature: normalizeTemperature(process.env.PROOFROUTE_TENSORRT_TEMPERATURE)
  };
}

async function loadRuntime(runtimePackage) {
  if (!runtimePromise) {
    runtimePromise = importRuntime(runtimePackage).catch((error) => {
      runtimePromise = undefined;
      throw error;
    });
  }
  return runtimePromise;
}

async function importRuntime(runtimePackage) {
  try {
    return await import(runtimePackage);
  } catch (error) {
    throw new Error(`ProofRoute TensorRT accelerator requires optional package ${runtimePackage}. Install it or set PROOFROUTE_TENSORRT_RUNTIME_PACKAGE to a compatible module. Original error: ${error.message}`);
  }
}

async function createRuntimeEngine(runtime, enginePath, options) {
  if (typeof runtime.loadEngine === 'function') return runtime.loadEngine(enginePath, options);
  if (typeof runtime.createEngine === 'function') return runtime.createEngine(enginePath, options);
  if (typeof runtime.Engine?.load === 'function') return runtime.Engine.load(enginePath, options);
  if (typeof runtime.Runtime === 'function') {
    const instance = new runtime.Runtime(options);
    if (typeof instance.loadEngine === 'function') return instance.loadEngine(enginePath, options);
  }
  throw new Error('ProofRoute TensorRT accelerator runtime must expose loadEngine(enginePath, options), createEngine(enginePath, options), Engine.load(enginePath, options), or Runtime#loadEngine(enginePath, options).');
}

async function runEngine(engine, inputName, input, outputName, metadata) {
  const feeds = { [inputName]: input };
  const options = {
    device: metadata.device,
    batchSize: metadata.batchSize,
    shardSize: metadata.shardSize,
    outputName
  };
  let result;
  if (typeof engine.infer === 'function') result = await engine.infer(feeds, options);
  else if (typeof engine.run === 'function') result = await engine.run(feeds, options);
  else if (typeof engine.execute === 'function') result = await engine.execute(feeds, options);
  else if (typeof engine === 'function') result = await engine(feeds, options);
  else throw new Error('ProofRoute TensorRT engine must expose infer(feeds, options), run(feeds, options), execute(feeds, options), or be callable.');
  return selectOutput(result, outputName, input.dims?.[0] ?? metadata.shardSize ?? metadata.batchSize);
}

function featureTensor(prompts) {
  const data = new Float32Array(prompts.length * FEATURE_NAMES.length);
  prompts.forEach((prompt, row) => {
    const features = extractFeatures(String(prompt ?? ''));
    for (let column = 0; column < FEATURE_NAMES.length; column += 1) {
      data[row * FEATURE_NAMES.length + column] = features[FEATURE_NAMES[column]] ?? 0;
    }
  });
  return {
    type: 'float32',
    data,
    dims: [prompts.length, FEATURE_NAMES.length],
    featureNames: FEATURE_NAMES
  };
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

function selectOutput(result, outputName, batchSize) {
  const output = outputName && result?.[outputName] ? result[outputName] : result?.logits ?? result?.output ?? result;
  if (output?.data) return output;
  if (ArrayBuffer.isView(output)) {
    return {
      data: output,
      dims: [batchSize, INTENTS.length]
    };
  }
  if (Array.isArray(output)) {
    const nested = Array.isArray(output[0]);
    const data = Float32Array.from(nested ? output.flat() : output);
    return {
      data,
      dims: nested ? [output.length, output[0]?.length ?? INTENTS.length] : [batchSize, INTENTS.length]
    };
  }
  throw new Error('ProofRoute TensorRT accelerator expected logits as a tensor-like object, typed array, or numeric array.');
}

function logitsToIntents(output, prompts, metadata) {
  const columns = Number(output.dims?.[output.dims.length - 1] ?? INTENTS.length);
  const rows = Number(output.dims?.[0] ?? prompts.length);
  if (rows < prompts.length || columns < INTENTS.length) throw new Error('ProofRoute TensorRT accelerator output shape does not match the intent catalog.');
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
        adapter: 'tensorrt-accelerator-module',
        runtime: metadata.runtimePackage,
        engine: metadata.engineName,
        precision: metadata.precision,
        warmed: metadata.warmed,
        moduleDevice: metadata.device,
        moduleBatchSize: metadata.batchSize,
        moduleShardSize: metadata.shardSize,
        maxBatchSize: metadata.maxBatchSize,
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

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text ? text : undefined;
}

function normalizeTemperature(value) {
  const number = Number(value ?? 1);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
