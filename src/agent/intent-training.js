import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function trainIntentModelFiles(options = {}) {
  const modelPath = resolve(String(options.modelPath ?? 'examples/linear-intent-model.json'));
  const samplesPath = resolve(String(options.samplesPath ?? 'examples/samples.json'));
  const outPath = resolve(String(options.outPath ?? 'examples/linear-intent-model.trained.json'));
  const onnxOut = options.onnxOut ? resolve(String(options.onnxOut)) : undefined;
  const epochs = positiveInteger(options.epochs, 8);
  const learningRate = positiveNumber(options.learningRate, 0.35);
  const artifact = JSON.parse(await readFile(modelPath, 'utf8'));
  const samples = normalizeTrainingSamples(JSON.parse(await readFile(samplesPath, 'utf8')));
  const trained = trainIntentModel({ artifact, samples, epochs, learningRate });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(trained.artifact, null, 2)}\n`);
  if (onnxOut) exportOnnxArtifact({ modelPath: outPath, onnxOut });
  return {
    object: 'proofroute.intent_training',
    status: 'pass',
    modelPath,
    samplesPath,
    outPath,
    onnxOut,
    epochs,
    learningRate,
    samples: {
      count: samples.length,
      labels: countBy(samples.map((sample) => sample.intent))
    },
    before: trained.before,
    after: trained.after,
    training: trained.artifact.training
  };
}

export function trainIntentModel({ artifact, samples, epochs = 8, learningRate = 0.35 }) {
  const model = compileModel(artifact);
  const before = evaluate(model, samples);
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const sample of samples) {
      const prediction = classifyPrompt(sample.prompt, model).name;
      if (prediction === sample.intent) continue;
      updateWeights(model, sample, prediction, learningRate);
    }
  }
  const after = evaluate(model, samples);
  return {
    artifact: serializeModel({ artifact, model, samples, epochs, learningRate, before, after }),
    before,
    after
  };
}

export function normalizeTrainingSamples(value) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.samples) ? value.samples : [];
  return rows.map((sample, index) => {
    const intent = firstText(sample.intent, sample.expectedIntent, sample.label);
    const prompt = String(sample.prompt ?? '');
    if (!intent || !prompt) throw new Error(`Training sample ${index} requires intent and prompt.`);
    return {
      id: sample.id === undefined ? String(index + 1) : String(sample.id),
      intent,
      prompt
    };
  });
}

export function formatIntentTrainingSummary(report) {
  return `trained ${report.outPath} from ${report.samples.count} samples for ${report.epochs} epochs; accuracy ${formatRatio(report.before.accuracy)} -> ${formatRatio(report.after.accuracy)}.`;
}

function exportOnnxArtifact({ modelPath, onnxOut }) {
  const exporter = fileURLToPath(new URL('../../examples/export-linear-intent-onnx.js', import.meta.url));
  const exported = spawnSync(process.execPath, [exporter, '--model', modelPath, '--out', onnxOut], {
    encoding: 'utf8',
    timeout: 1000
  });
  if (exported.status !== 0) {
    throw new Error(exported.stderr || exported.stdout || 'ONNX export failed.');
  }
}

function compileModel(artifact) {
  const intents = Array.isArray(artifact.intents) && artifact.intents.length ? artifact.intents.map(String) : Object.keys(artifact.weights ?? {});
  const weights = {};
  for (const intent of intents) {
    weights[intent] = normalizeWeights(artifact.weights?.[intent]);
  }
  return {
    name: String(artifact.name ?? 'proofroute-linear-intent-v1'),
    version: Number.isFinite(Number(artifact.version)) ? Number(artifact.version) : 1,
    temperature: Number.isFinite(Number(artifact.temperature)) ? Number(artifact.temperature) : 1,
    longContextChars: Number.isFinite(Number(artifact.longContextChars)) ? Number(artifact.longContextChars) : 18000,
    intents,
    weights,
    bias: Object.fromEntries(intents.map((intent) => [intent, Number(artifact.bias?.[intent] ?? 0.01)]))
  };
}

function updateWeights(model, sample, predictedIntent, learningRate) {
  const expected = sample.intent;
  const tokenCounts = countTokens(tokenize(normalize(sample.prompt)));
  model.bias[expected] = Number(model.bias[expected] ?? 0) + learningRate;
  model.bias[predictedIntent] = Number(model.bias[predictedIntent] ?? 0) - learningRate;
  for (const [token, count] of tokenCounts) {
    model.weights[expected][token] = Number(model.weights[expected][token] ?? 0) + learningRate * count;
    model.weights[predictedIntent][token] = Number(model.weights[predictedIntent][token] ?? 0) - learningRate * count;
  }
}

function evaluate(model, samples) {
  const rows = samples.map((sample) => {
    const prediction = classifyPrompt(sample.prompt, model);
    return {
      id: sample.id,
      expected: sample.intent,
      actual: prediction.name,
      matched: prediction.name === sample.intent
    };
  });
  return {
    count: rows.length,
    correct: rows.filter((row) => row.matched).length,
    accuracy: rows.length ? rows.filter((row) => row.matched).length / rows.length : 0,
    rows
  };
}

function classifyPrompt(prompt, model) {
  const tokenCounts = countTokens(tokenize(normalize(prompt)));
  const features = {
    chars: prompt.length,
    hasCodeFence: /```/.test(prompt),
    hasJson: /[{[]\s*["\w-]+["\w-]*\s*:/.test(prompt),
    hasStackTrace: /at\s+\S+\s+\(|Traceback|Exception|Error:/.test(prompt)
  };
  const ranked = model.intents
    .map((intent) => ({ name: intent, score: scoreIntent(intent, model, tokenCounts, features) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] ?? { name: 'chat', score: 0 };
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

function serializeModel({ artifact, model, samples, epochs, learningRate, before, after }) {
  return {
    ...artifact,
    name: `${model.name}-trained`,
    version: model.version + 1,
    temperature: model.temperature,
    longContextChars: model.longContextChars,
    intents: model.intents,
    bias: roundObject(model.bias),
    weights: Object.fromEntries(model.intents.map((intent) => [intent, roundObject(sortObject(model.weights[intent] ?? {}))])),
    training: {
      sourceModel: model.name,
      sampleCount: samples.length,
      epochs,
      learningRate,
      accuracyBefore: round(before.accuracy),
      accuracyAfter: round(after.accuracy),
      correctBefore: before.correct,
      correctAfter: after.correct
    }
  };
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
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

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
}

function roundObject(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, round(value)]));
}

function round(value) {
  return Number(Number(value).toFixed(6));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function formatRatio(value) {
  return `${(value * 100).toFixed(1)}%`;
}
