#!/usr/bin/env node
import { formatIntentTrainingSummary, trainIntentModelFiles } from '../src/agent/intent-training.js';

const args = parseArgs(process.argv.slice(2));
const report = await trainIntentModelFiles({
  modelPath: args.model,
  samplesPath: args.samples,
  outPath: args.out,
  onnxOut: args['onnx-out'],
  epochs: args.epochs,
  learningRate: args['learning-rate']
});

console.log(formatIntentTrainingSummary(report));
if (report.onnxOut) console.log(`exported ${report.onnxOut}.`);

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
