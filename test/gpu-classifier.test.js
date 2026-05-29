import test from 'node:test';
import assert from 'node:assert/strict';
import { ExternalClassifier } from '../src/controller/gpu-classifier.js';

test('external classifier falls back when the command is unavailable', () => {
  const classifier = new ExternalClassifier({ command: 'definitely-not-a-router-classifier', timeoutMs: 4 });
  const intent = classifier.classify('Refactor this function and add a test.');
  assert.equal(intent.features.backend, 'builtin-fallback');
  assert.equal(intent.name, 'code');
});

test('external classifier can provide a successful intent decision', () => {
  const script = 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(JSON.stringify({name:"writing",confidence:0.97,features:{source:"test"}})))';
  const classifier = new ExternalClassifier({ command: `${process.execPath} -e '${script}'`, timeoutMs: 1000 });
  const intent = classifier.classify('Refactor this function and add a test.');
  assert.equal(intent.name, 'writing');
  assert.equal(intent.confidence, 0.97);
  assert.equal(intent.features.source, 'test');
  assert.equal(intent.features.backend, 'external');
});
