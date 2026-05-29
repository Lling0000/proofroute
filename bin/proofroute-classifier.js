#!/usr/bin/env node
import { ExternalClassifier } from '../src/controller/gpu-classifier.js';
import { DEFAULT_CLASSIFIER_SIDECAR_PORT, createClassifierSidecar } from '../src/controller/sidecar-server.js';

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(renderHelp());
} else {
  const host = String(args.host ?? process.env.PROOFROUTE_CLASSIFIER_HOST ?? '127.0.0.1');
  const port = Number(args.port ?? process.env.PORT ?? process.env.PROOFROUTE_CLASSIFIER_PORT ?? DEFAULT_CLASSIFIER_SIDECAR_PORT);
  const lanes = Number(args.lanes ?? process.env.PROOFROUTE_GPU_LANES ?? 1);
  const backend = String(args.backend ?? process.env.PROOFROUTE_CLASSIFIER_BACKEND ?? 'sidecar-builtin');
  const devices = String(args.devices ?? process.env.PROOFROUTE_GPU_DEVICES ?? process.env.CUDA_VISIBLE_DEVICES ?? '');
  const command = args.command ?? process.env.PROOFROUTE_CLASSIFIER_COMMAND;
  const timeoutMs = Number(args.timeout ?? args.timeoutMs ?? process.env.PROOFROUTE_CLASSIFIER_TIMEOUT_MS ?? 12);
  const classifier = command ? new ExternalClassifier({ command: String(command), timeoutMs }) : undefined;
  const server = createClassifierSidecar({
    lanes,
    backend,
    devices,
    classify: classifier ? classifier.classify.bind(classifier) : undefined,
    classifyMany: classifier ? classifier.classifyMany.bind(classifier) : undefined
  });
  server.on('error', (error) => {
    console.error(`proofroute-classifier: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`proofroute classifier sidecar listening on http://${host}:${actualPort}/classify`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => {
        process.exit(0);
      });
    });
  }
}

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

function renderHelp() {
  return [
    'proofroute-classifier',
    '',
    'Start the reference HTTP classifier sidecar used by proofroute.',
    'It serves GET /health, GET /metrics, POST /classify, and POST /classify/batch with lane and device metadata.',
    '',
    'Usage:',
    '  node ./bin/proofroute-classifier.js --port 8788 --lanes 4 --devices 0,1 --backend sidecar-builtin',
    '',
    'Environment:',
    '  PROOFROUTE_CLASSIFIER_PORT controls the listening port.',
    '  PROOFROUTE_CLASSIFIER_BACKEND names the local classifier backend in health metadata.',
    '  PROOFROUTE_CLASSIFIER_COMMAND wraps an external stdin/stdout classifier behind the HTTP sidecar.',
    '  PROOFROUTE_CLASSIFIER_TIMEOUT_MS bounds the wrapped classifier call before fallback.',
    '  PROOFROUTE_GPU_DEVICES declares the visible accelerator devices for health metadata.',
    '  PROOFROUTE_GPU_LANES declares the local classifier lane count for telemetry.'
  ].join('\n');
}
