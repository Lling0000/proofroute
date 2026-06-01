import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ExternalClassifier, PersistentClassifier } from '../src/controller/gpu-classifier.js';

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

test('external command classifier can batch prompts through one process', async () => {
  const script = 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const b=JSON.parse(d);console.log(JSON.stringify({data:b.prompts.map((p,i)=>({name:p.includes("JSON")?"extraction":"writing",confidence:0.93,features:{index:i}}))}))})';
  const classifier = new ExternalClassifier({ command: `${process.execPath} -e '${script}'`, timeoutMs: 1000 });
  const intents = await classifier.classifyMany([
    'Extract invoice totals into JSON.',
    'Rewrite this launch note.'
  ]);
  assert.deepEqual(intents.map((intent) => intent.name), ['extraction', 'writing']);
  assert.deepEqual(intents.map((intent) => intent.features.index), [0, 1]);
  assert.ok(intents.every((intent) => intent.features.backend === 'external'));
});

test('persistent classifier keeps a hot worker for single and batch requests', async () => {
  const classifier = new PersistentClassifier({
    command: `${process.execPath} ./examples/persistent-classifier-command.js`,
    timeoutMs: 1000
  });
  try {
    const intent = await classifier.classifyAsync('Refactor this function and add a test.');
    assert.equal(intent.name, 'code');
    assert.equal(intent.features.backend, 'persistent');
    const intents = await classifier.classifyMany([
      'Extract invoice totals into JSON.',
      'Rewrite this launch note.'
    ]);
    assert.deepEqual(intents.map((entry) => entry.name), ['extraction', 'writing']);
    assert.ok(intents.every((entry) => entry.features.backend === 'persistent'));
  } finally {
    classifier.close();
  }
});

test('external classifier can use an async local sidecar URL', async () => {
  const sidecar = await fakeClassifierSidecar();
  try {
    const classifier = new ExternalClassifier({ url: sidecar.url, timeoutMs: 200 });
    const intent = await classifier.classifyAsync('Refactor this function and add a test.');
    assert.equal(intent.name, 'writing');
    assert.equal(intent.confidence, 0.96);
    assert.equal(intent.features.backend, 'external-url');
    assert.equal(intent.features.source, 'sidecar');
  } finally {
    await sidecar.close();
  }
});

test('external classifier opens a local circuit after sidecar timeouts', async () => {
  const sidecar = await slowThenHealthyClassifierSidecar();
  let clock = 0;
  try {
    const classifier = new ExternalClassifier({
      url: sidecar.url,
      timeoutMs: 50,
      failureThreshold: 1,
      cooldownMs: 500,
      now: () => clock
    });
    const first = await classifier.classifyAsync('Refactor this function and add a test.');
    assert.equal(first.features.backend, 'builtin-fallback');
    assert.equal(first.features.classifierCircuitOpen, true);
    assert.equal(sidecar.requests(), 1);
    const second = await classifier.classifyAsync('Rewrite this launch note.');
    assert.equal(second.features.backend, 'builtin-circuit-open');
    assert.equal(sidecar.requests(), 1);
    clock = 600;
    const recovered = await classifier.classifyAsync('Rewrite this launch note.');
    assert.equal(recovered.name, 'writing');
    assert.equal(recovered.features.backend, 'external-url');
    assert.equal(classifier.circuitState().open, false);
    assert.equal(sidecar.requests(), 2);
  } finally {
    await sidecar.close();
  }
});

function fakeClassifierSidecar() {
  const server = createServer((req, res) => {
    assert.equal(req.method, 'POST');
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      assert.match(body, /Refactor/);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'writing', confidence: 0.96, features: { source: 'sidecar' } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/classify`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function slowThenHealthyClassifierSidecar() {
  let requests = 0;
  const server = createServer((req, res) => {
    assert.equal(req.method, 'POST');
    requests += 1;
    req.resume();
    req.on('end', () => {
      if (requests === 1) {
        setTimeout(() => {
          if (!res.destroyed) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ name: 'writing', confidence: 0.96, features: { source: 'slow-sidecar' } }));
          }
        }, 150);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'writing', confidence: 0.98, features: { source: 'recovered-sidecar' } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/classify`,
        requests: () => requests,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}
