#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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
const INTENTS = Object.freeze(['code', 'reasoning', 'writing', 'extraction', 'long_context', 'chat']);
const FLOAT = 1;

const args = parseArgs(process.argv.slice(2));
const modelPath = resolve(String(args.model ?? 'examples/linear-intent-model.json'));
const outPath = resolve(String(args.out ?? 'examples/linear-intent-model.onnx'));
const artifact = JSON.parse(await readFile(modelPath, 'utf8'));
const compiled = compileLinearArtifact(artifact);
const bytes = createOnnxModel(compiled);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, bytes);
console.log(`wrote ${outPath} (${bytes.length} bytes) from ${modelPath} with ${compiled.featureNames.length} features and ${compiled.intents.length} intents.`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function compileLinearArtifact(artifact) {
  const longContextChars = numberOr(artifact.longContextChars, 18000);
  const weights = new Float32Array(FEATURE_NAMES.length * INTENTS.length);
  const bias = new Float32Array(INTENTS.length);
  for (let intentIndex = 0; intentIndex < INTENTS.length; intentIndex += 1) {
    const intent = INTENTS[intentIndex];
    bias[intentIndex] = numberOr(artifact.bias?.[intent], 0.01);
    for (let featureIndex = 0; featureIndex < FEATURE_NAMES.length; featureIndex += 1) {
      weights[featureIndex * INTENTS.length + intentIndex] = featureWeight(FEATURE_NAMES[featureIndex], intent, artifact, longContextChars);
    }
  }
  return {
    name: String(artifact.name ?? 'proofroute-linear-intent'),
    version: numberOr(artifact.version, 1),
    temperature: numberOr(artifact.temperature, 1),
    longContextChars,
    featureNames: FEATURE_NAMES,
    intents: INTENTS,
    weights,
    bias
  };
}

function featureWeight(feature, intent, artifact, longContextChars) {
  if (feature === 'chars_k') return intent === 'long_context' ? 1000 / longContextChars : 0;
  if (feature === 'tokens_k') return 0;
  if (feature === 'has_code_fence') return intent === 'code' ? 2.8 : 0;
  if (feature === 'has_json') return intent === 'extraction' ? 1.4 : 0;
  if (feature === 'has_stack_trace') return intent === 'code' ? 2.1 : 0;
  return numberOr(artifact.weights?.[intent]?.[normalizeToken(feature)], 0);
}

function createOnnxModel(model) {
  const graph = graphProto({
    name: `${model.name}-graph`,
    inputName: 'input',
    outputName: 'logits',
    featureCount: model.featureNames.length,
    intentCount: model.intents.length,
    weights: model.weights,
    bias: model.bias
  });
  const opset = message([
    int64Field(2, 13)
  ]);
  return message([
    int64Field(1, 8),
    stringField(2, 'proofroute'),
    stringField(3, '0.1.0'),
    int64Field(5, model.version),
    stringField(6, 'ProofRoute local intent classifier logits model generated from examples/linear-intent-model.json.'),
    messageField(7, graph),
    messageField(8, opset),
    metadataField('proofroute.feature_names', model.featureNames.join(',')),
    metadataField('proofroute.intent_names', model.intents.join(',')),
    metadataField('proofroute.temperature', String(model.temperature)),
    metadataField('proofroute.source_artifact', model.name)
  ]);
}

function graphProto({ name, inputName, outputName, featureCount, intentCount, weights, bias }) {
  return message([
    nodeProto({ name: 'intent_matmul', opType: 'MatMul', inputs: [inputName, 'weights'], outputs: ['matmul'] }),
    nodeProto({ name: 'intent_bias', opType: 'Add', inputs: ['matmul', 'bias'], outputs: [outputName] }),
    stringField(2, name),
    tensorProto({ name: 'weights', dims: [featureCount, intentCount], data: weights }),
    tensorProto({ name: 'bias', dims: [intentCount], data: bias }),
    valueInfoProto({ name: inputName, dims: ['batch', featureCount] }),
    outputInfoProto({ name: outputName, dims: ['batch', intentCount] })
  ]);
}

function nodeProto({ name, opType, inputs, outputs }) {
  return message([
    ...inputs.map((input) => stringField(1, input)),
    ...outputs.map((output) => stringField(2, output)),
    stringField(3, name),
    stringField(4, opType)
  ]);
}

function tensorProto({ name, dims, data }) {
  return message([
    ...dims.map((dimension) => int64Field(1, dimension)),
    intField(2, FLOAT),
    stringField(8, name),
    bytesField(9, floatBytes(data))
  ]);
}

function valueInfoProto({ name, dims }) {
  return messageField(11, namedTensorInfo(name, dims));
}

function outputInfoProto({ name, dims }) {
  return messageField(12, namedTensorInfo(name, dims));
}

function namedTensorInfo(name, dims) {
  return message([
    stringField(1, name),
    messageField(2, typeProto(dims))
  ]);
}

function typeProto(dims) {
  return messageField(1, message([
    intField(1, FLOAT),
    messageField(2, shapeProto(dims))
  ]));
}

function shapeProto(dims) {
  return message(dims.map((dimension) => messageField(1, dimensionProto(dimension))));
}

function dimensionProto(dimension) {
  return typeof dimension === 'string' ? message([stringField(2, dimension)]) : message([int64Field(1, dimension)]);
}

function metadataField(key, value) {
  return messageField(14, message([
    stringField(1, key),
    stringField(2, value)
  ]));
}

function message(fields) {
  return Buffer.concat(fields.filter(Boolean));
}

function messageField(number, value) {
  return bytesField(number, value);
}

function stringField(number, value) {
  return bytesField(number, Buffer.from(String(value)));
}

function bytesField(number, value) {
  return Buffer.concat([fieldTag(number, 2), varint(value.length), value]);
}

function intField(number, value) {
  return Buffer.concat([fieldTag(number, 0), varint(value)]);
}

function int64Field(number, value) {
  return Buffer.concat([fieldTag(number, 0), varint(value)]);
}

function fieldTag(number, wireType) {
  return varint((number << 3) | wireType);
}

function varint(value) {
  let current = BigInt(value);
  const bytes = [];
  do {
    let byte = Number(current & 0x7fn);
    current >>= 7n;
    if (current) byte |= 0x80;
    bytes.push(byte);
  } while (current);
  return Buffer.from(bytes);
}

function floatBytes(values) {
  const buffer = Buffer.alloc(values.length * 4);
  for (let index = 0; index < values.length; index += 1) {
    buffer.writeFloatLE(Number(values[index] ?? 0), index * 4);
  }
  return buffer;
}

function normalizeToken(token) {
  if (!/^[a-z]+$/.test(token) || token.length < 5) return token;
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('offs')) return token.slice(0, -1);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
