import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExternalClassifier } from '../src/controller/gpu-classifier.js';
import { RouteController } from '../src/controller/route-controller.js';

test('example classifier command supports single and batch contracts', () => {
  const single = runClassifier({ prompt: 'Refactor this payment handler and add a test.' });
  assert.equal(single.name, 'code');
  assert.ok(single.confidence > 0);
  const batch = runClassifier({
    prompts: [
      'Extract invoices into JSON.',
      'Rewrite this README launch note.'
    ]
  });
  assert.deepEqual(batch.data.map((intent) => intent.name), ['extraction', 'writing']);
});

test('persistent classifier example supports NDJSON single and batch contracts', () => {
  const result = spawnSync(process.execPath, ['examples/persistent-classifier-command.js'], {
    cwd: process.cwd(),
    input: [
      JSON.stringify({ id: 'single', prompt: 'Refactor this payment handler and add a test.' }),
      JSON.stringify({
        id: 'batch',
        prompts: [
          'Extract invoices into JSON.',
          'Rewrite this README launch note.'
        ]
      })
    ].join('\n'),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(rows[0].id, 'single');
  assert.equal(rows[0].name, 'code');
  assert.equal(rows[1].id, 'batch');
  assert.deepEqual(rows[1].data.map((intent) => intent.name), ['extraction', 'writing']);
});

test('accelerator worker template preserves NDJSON batch metadata without prompts', () => {
  const result = spawnSync(process.execPath, ['examples/accelerator-worker.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_ACCELERATOR_BACKEND: 'template-gpu',
      PROOFROUTE_ACCELERATOR_DEVICE: '0'
    },
    input: [
      JSON.stringify({ id: 'single', prompt: 'Refactor this payment handler and add a test.' }),
      JSON.stringify({
        id: 'batch',
        prompts: [
          'Extract invoices into JSON.',
          'Rewrite this README launch note.'
        ]
      })
    ].join('\n'),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(rows[0].id, 'single');
  assert.equal(rows[0].name, 'code');
  assert.equal(rows[0].features.backend, 'template-gpu');
  assert.equal(rows[0].features.source, 'accelerator-worker');
  assert.equal(rows[0].features.device, '0');
  assert.equal(rows[0].features.batchMode, 'single');
  assert.equal(rows[1].id, 'batch');
  assert.deepEqual(rows[1].data.map((intent) => intent.name), ['extraction', 'writing']);
  assert.deepEqual(rows[1].data.map((intent) => intent.features.batchMode), ['explicit', 'explicit']);
  assert.deepEqual(rows[1].data.map((intent) => intent.features.batchSize), [2, 2]);
  assert.doesNotMatch(result.stdout, /payment handler/);
});

test('accelerator worker template can delegate to a warm user module', () => {
  const result = spawnSync(process.execPath, ['examples/accelerator-worker.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_ACCELERATOR_BACKEND: 'module-gpu',
      PROOFROUTE_ACCELERATOR_DEVICE: '1',
      PROOFROUTE_ACCELERATOR_MODULE: 'examples/accelerator-module.js'
    },
    input: JSON.stringify({
      id: 'module-batch',
      prompts: [
        'Extract invoices into JSON.',
        'Compare the routing tradeoffs.'
      ]
    }),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  const row = JSON.parse(result.stdout);
  assert.equal(row.id, 'module-batch');
  assert.deepEqual(row.data.map((intent) => intent.name), ['extraction', 'reasoning']);
  assert.deepEqual(row.data.map((intent) => intent.features.module), ['example-accelerator-module', 'example-accelerator-module']);
  assert.deepEqual(row.data.map((intent) => intent.features.warmed), [true, true]);
  assert.deepEqual(row.data.map((intent) => intent.features.ordinal), [0, 1]);
  assert.deepEqual(row.data.map((intent) => intent.features.backend), ['module-gpu', 'module-gpu']);
  assert.deepEqual(row.data.map((intent) => intent.features.device), ['1', '1']);
});

test('accelerator worker template shards explicit batches across visible devices', () => {
  const result = spawnSync(process.execPath, ['examples/accelerator-worker.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_ACCELERATOR_BACKEND: 'module-gpu',
      PROOFROUTE_ACCELERATOR_DEVICES: '0,1',
      PROOFROUTE_ACCELERATOR_SCHEDULER: 'round-robin',
      PROOFROUTE_ACCELERATOR_MODULE: 'examples/accelerator-module.js'
    },
    input: JSON.stringify({
      id: 'multi-device-batch',
      prompts: [
        'Refactor this payment handler and add a test.',
        'Extract invoices into JSON.',
        'Rewrite this README launch note.',
        'Compare the routing tradeoffs.'
      ]
    }),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  const row = JSON.parse(result.stdout);
  assert.equal(row.id, 'multi-device-batch');
  assert.deepEqual(row.data.map((intent) => intent.name), ['code', 'extraction', 'writing', 'reasoning']);
  assert.deepEqual(row.data.map((intent) => intent.features.device), ['0', '1', '0', '1']);
  assert.deepEqual(row.data.map((intent) => intent.features.moduleDevice), ['0', '1', '0', '1']);
  assert.deepEqual(row.data.map((intent) => intent.features.deviceOrdinal), [0, 1, 0, 1]);
  assert.deepEqual(row.data.map((intent) => intent.features.deviceCount), [2, 2, 2, 2]);
  assert.deepEqual(row.data.map((intent) => intent.features.shardSize), [2, 2, 2, 2]);
  assert.deepEqual(row.data.map((intent) => intent.features.moduleShardSize), [2, 2, 2, 2]);
  assert.deepEqual(row.data.map((intent) => intent.features.warmed), [true, true, true, true]);
  assert.deepEqual(row.data.map((intent) => intent.features.devices.join(',')), ['0,1', '0,1', '0,1', '0,1']);
  assert.doesNotMatch(result.stdout, /payment handler/);
});

test('linear accelerator module classifies with a local artifact through the worker', () => {
  const result = spawnSync(process.execPath, ['examples/accelerator-worker.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_ACCELERATOR_BACKEND: 'linear-artifact',
      PROOFROUTE_ACCELERATOR_DEVICES: '0,1',
      PROOFROUTE_ACCELERATOR_MODULE: 'examples/linear-accelerator-module.js',
      PROOFROUTE_ACCELERATOR_MODEL: 'examples/linear-intent-model.json'
    },
    input: JSON.stringify({
      id: 'linear-artifact-batch',
      prompts: [
        'Refactor the TypeScript webhook and add a regression test.',
        'Extract invoice totals into JSON rows.',
        'Rewrite the launch memo in a sharper tone.',
        'Compare routing algorithms and reason about latency tradeoffs.'
      ]
    }),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  const row = JSON.parse(result.stdout);
  assert.equal(row.id, 'linear-artifact-batch');
  assert.deepEqual(row.data.map((intent) => intent.name), ['code', 'extraction', 'writing', 'reasoning']);
  assert.deepEqual(row.data.map((intent) => intent.features.adapter), [
    'linear-accelerator-module',
    'linear-accelerator-module',
    'linear-accelerator-module',
    'linear-accelerator-module'
  ]);
  assert.deepEqual(row.data.map((intent) => intent.features.artifact), [
    'proofroute-linear-intent-v1',
    'proofroute-linear-intent-v1',
    'proofroute-linear-intent-v1',
    'proofroute-linear-intent-v1'
  ]);
  assert.deepEqual(row.data.map((intent) => intent.features.device), ['0', '1', '0', '1']);
  assert.deepEqual(row.data.map((intent) => intent.features.warmed), [true, true, true, true]);
  assert.ok(row.data.every((intent) => intent.ranked.every((entry) => Number.isFinite(entry.probability))));
  assert.doesNotMatch(result.stdout, /TypeScript webhook/);
});

test('linear intent exporter reproduces the checked ONNX artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-onnx-'));
  try {
    const out = join(directory, 'linear-intent-model.onnx');
    const result = spawnSync(process.execPath, ['examples/export-linear-intent-onnx.js', '--out', out], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /22 features and 6 intents/);
    const generated = await readFile(out);
    const checked = await readFile(join(process.cwd(), 'examples/linear-intent-model.onnx'));
    const info = await stat(join(process.cwd(), 'examples/linear-intent-model.onnx'));
    assert.ok(info.size > 1000);
    assert.equal(Buffer.compare(generated, checked), 0);
    const text = checked.toString('latin1');
    assert.match(text, /MatMul/);
    assert.match(text, /Add/);
    assert.match(text, /proofroute.feature_names/);
    assert.match(text, /proofroute.intent_names/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('linear intent trainer improves labeled samples and exports ONNX', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-train-'));
  try {
    const samplesPath = join(directory, 'samples.json');
    const modelPath = join(directory, 'trained.json');
    const onnxPath = join(directory, 'trained.onnx');
    await writeFile(samplesPath, `${JSON.stringify({
      samples: [
        { id: 'contrarian-writing', expectedIntent: 'writing', actualIntent: 'code', prompt: 'Refactor this bug stacktrace test and rewrite the launch story.' },
        { id: 'code-anchor', expectedIntent: 'code', actualIntent: 'code', prompt: 'Fix this TypeScript bug and add a regression test.' }
      ],
      aggregate: {
        accuracy: 0.5
      }
    }, null, 2)}\n`);
    const result = spawnSync(process.execPath, [
      'examples/train-linear-intent-model.js',
      '--samples',
      samplesPath,
      '--out',
      modelPath,
      '--onnx-out',
      onnxPath,
      '--epochs',
      '12',
      '--learning-rate',
      '0.8'
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 1000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /accuracy 50\.0% -> 100\.0%/);
    const artifact = JSON.parse(await readFile(modelPath, 'utf8'));
    assert.equal(artifact.name, 'proofroute-linear-intent-v1-trained');
    assert.equal(artifact.training.sampleCount, 2);
    assert.equal(artifact.training.accuracyBefore, 0.5);
    assert.equal(artifact.training.accuracyAfter, 1);
    assert.ok(artifact.weights.writing.refactor > 0);
    const onnx = await readFile(onnxPath);
    assert.ok(onnx.length > 1000);
    assert.match(onnx.toString('latin1'), /MatMul/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('ONNX accelerator module classifies through an ORT-like runtime', () => {
  const result = spawnSync(process.execPath, ['examples/accelerator-worker.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_ACCELERATOR_BACKEND: 'mock-onnx',
      PROOFROUTE_ACCELERATOR_DEVICES: '0,1',
      PROOFROUTE_ACCELERATOR_MODULE: 'examples/onnx-accelerator-module.js',
      PROOFROUTE_ONNX_RUNTIME_PACKAGE: '../test/fixtures/mock-onnx-runtime.js',
      PROOFROUTE_ONNX_MODEL: 'examples/linear-intent-model.onnx',
      PROOFROUTE_ONNX_EXECUTION_PROVIDERS: 'cuda,cpu'
    },
    input: JSON.stringify({
      id: 'onnx-artifact-batch',
      prompts: [
        'Refactor the TypeScript webhook and add a regression test.',
        'Extract invoice totals into JSON rows.',
        'Rewrite the launch memo in a sharper tone.',
        'Compare routing algorithms and reason about latency tradeoffs.'
      ]
    }),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  const row = JSON.parse(result.stdout);
  assert.equal(row.id, 'onnx-artifact-batch');
  assert.deepEqual(row.data.map((intent) => intent.name), ['code', 'extraction', 'writing', 'reasoning']);
  assert.deepEqual(row.data.map((intent) => intent.features.adapter), [
    'onnx-accelerator-module',
    'onnx-accelerator-module',
    'onnx-accelerator-module',
    'onnx-accelerator-module'
  ]);
  assert.deepEqual(row.data.map((intent) => intent.features.model), [
    'linear-intent-model.onnx',
    'linear-intent-model.onnx',
    'linear-intent-model.onnx',
    'linear-intent-model.onnx'
  ]);
  assert.deepEqual(row.data.map((intent) => intent.features.executionProviders.join(',')), ['cuda,cpu', 'cuda,cpu', 'cuda,cpu', 'cuda,cpu']);
  assert.deepEqual(row.data.map((intent) => intent.features.warmed), [true, true, true, true]);
  assert.ok(row.data.every((intent) => intent.ranked.every((entry) => Number.isFinite(entry.probability))));
  assert.doesNotMatch(result.stdout, /TypeScript webhook/);
});

test('TensorRT accelerator module classifies through an engine-like runtime', () => {
  const result = spawnSync(process.execPath, ['examples/accelerator-worker.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_ACCELERATOR_BACKEND: 'mock-tensorrt',
      PROOFROUTE_ACCELERATOR_DEVICES: '0,1',
      PROOFROUTE_ACCELERATOR_MODULE: 'examples/tensorrt-accelerator-module.js',
      PROOFROUTE_TENSORRT_RUNTIME_PACKAGE: '../test/fixtures/mock-tensorrt-runtime.js',
      PROOFROUTE_TENSORRT_ENGINE: 'examples/linear-intent-model.onnx',
      PROOFROUTE_TENSORRT_PRECISION: 'fp16',
      PROOFROUTE_TENSORRT_MAX_BATCH_SIZE: '16'
    },
    input: JSON.stringify({
      id: 'tensorrt-engine-batch',
      prompts: [
        'Refactor the TypeScript webhook and add a regression test.',
        'Extract invoice totals into JSON rows.',
        'Rewrite the launch memo in a sharper tone.',
        'Compare routing algorithms and reason about latency tradeoffs.'
      ]
    }),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  const row = JSON.parse(result.stdout);
  assert.equal(row.id, 'tensorrt-engine-batch');
  assert.deepEqual(row.data.map((intent) => intent.name), ['code', 'extraction', 'writing', 'reasoning']);
  assert.deepEqual(row.data.map((intent) => intent.features.adapter), [
    'tensorrt-accelerator-module',
    'tensorrt-accelerator-module',
    'tensorrt-accelerator-module',
    'tensorrt-accelerator-module'
  ]);
  assert.deepEqual(row.data.map((intent) => intent.features.engine), [
    'linear-intent-model.onnx',
    'linear-intent-model.onnx',
    'linear-intent-model.onnx',
    'linear-intent-model.onnx'
  ]);
  assert.deepEqual(row.data.map((intent) => intent.features.precision), ['fp16', 'fp16', 'fp16', 'fp16']);
  assert.deepEqual(row.data.map((intent) => intent.features.moduleDevice), ['0', '1', '0', '1']);
  assert.deepEqual(row.data.map((intent) => intent.features.warmed), [true, true, true, true]);
  assert.ok(row.data.every((intent) => intent.ranked.every((entry) => Number.isFinite(entry.probability))));
  assert.doesNotMatch(result.stdout, /TypeScript webhook/);
});

test('TensorRT accelerator module explains a missing optional runtime', () => {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "const module = await import('./examples/tensorrt-accelerator-module.js'); await module.warmup({ device: '0' });"
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_TENSORRT_RUNTIME_PACKAGE: 'proofroute-missing-tensorrt-runtime',
      PROOFROUTE_TENSORRT_ENGINE: 'examples/linear-intent-model.onnx'
    },
    encoding: 'utf8',
    timeout: 1000
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires optional package proofroute-missing-tensorrt-runtime/);
});

test('ONNX accelerator module explains a missing optional runtime', () => {
  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "const module = await import('./examples/onnx-accelerator-module.js'); await module.warmup({ device: 'cpu' });"
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_ONNX_RUNTIME_PACKAGE: 'proofroute-missing-onnx-runtime',
      PROOFROUTE_ONNX_MODEL: 'examples/linear-intent-model.onnx'
    },
    encoding: 'utf8',
    timeout: 1000
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires optional package proofroute-missing-onnx-runtime/);
});

test('ONNX accelerator sidecar launcher explains an unreadable model path', () => {
  const result = spawnSync('sh', ['examples/onnx-accelerator-sidecar.sh'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_ONNX_MODEL: 'examples/missing-intent-model.onnx',
      PROOFROUTE_ACCELERATOR_MODEL: ''
    },
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 66);
  assert.match(result.stderr, /cannot read examples\/missing-intent-model\.onnx/);
});

test('TensorRT accelerator sidecar launcher explains a missing engine path', () => {
  const result = spawnSync('sh', ['examples/tensorrt-accelerator-sidecar.sh'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_TENSORRT_ENGINE: '',
      PROOFROUTE_ACCELERATOR_MODEL: ''
    },
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 66);
  assert.match(result.stderr, /requires PROOFROUTE_TENSORRT_ENGINE/);
});

test('TensorRT accelerator sidecar launcher explains an unreadable engine path', () => {
  const result = spawnSync('sh', ['examples/tensorrt-accelerator-sidecar.sh'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PROOFROUTE_TENSORRT_ENGINE: 'examples/missing-intent-model.engine',
      PROOFROUTE_ACCELERATOR_MODEL: ''
    },
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 66);
  assert.match(result.stderr, /cannot read examples\/missing-intent-model\.engine/);
});

test('linear accelerator sidecar launcher script stays parseable', () => {
  const result = spawnSync('sh', ['-n', 'examples/linear-accelerator-sidecar.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
});

test('ONNX accelerator sidecar launcher script stays parseable', () => {
  const result = spawnSync('sh', ['-n', 'examples/onnx-accelerator-sidecar.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
});

test('TensorRT accelerator sidecar launcher script stays parseable', () => {
  const result = spawnSync('sh', ['-n', 'examples/tensorrt-accelerator-sidecar.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
});

test('local OpenAI-compatible example config is executable without credentials', async () => {
  const config = JSON.parse(await readFile(join(process.cwd(), 'examples/local-openai-router.json'), 'utf8'));
  const classifier = new ExternalClassifier(config.classifier);
  const controller = new RouteController(config, classifier);
  const decision = await controller.routeAsync({
    prompt: 'Refactor this local model gateway and write a regression test.',
    executableOnly: true
  });
  assert.equal(controller.executableModels().length, 1);
  assert.equal(decision.model.provider, 'lmstudio');
  assert.equal(decision.model.local, true);
  assert.equal(decision.intent.features.backend, 'external');
});

test('init can emit the local OpenAI-compatible preset', () => {
  const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'init', '--preset', 'local-openai'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  const controller = new RouteController(config);
  assert.equal(config.providers.lmstudio.requiresApiKey, false);
  assert.equal(controller.executableModels()[0].provider, 'lmstudio');
});

test('JSON examples stay parseable', async () => {
  for (const path of ['examples/router.json', 'examples/local-openai-router.json', 'examples/samples.json', 'examples/linear-intent-model.json']) {
    const parsed = JSON.parse(await readFile(join(process.cwd(), path), 'utf8'));
    assert.ok(parsed);
  }
});

function runClassifier(payload) {
  const result = spawnSync(process.execPath, ['examples/classifier-command.js'], {
    cwd: process.cwd(),
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 1000
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
