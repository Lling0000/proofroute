#!/usr/bin/env node
import { ExternalClassifier, PersistentClassifier } from '../src/controller/gpu-classifier.js';
import { detectNvidiaDeviceProfiles } from '../src/controller/device-profile.js';
import { DEFAULT_CLASSIFIER_SIDECAR_PORT, createClassifierSidecar } from '../src/controller/sidecar-server.js';

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(renderHelp());
} else {
  main().catch((error) => {
    console.error(`proofroute-classifier: ${error.message}`);
    process.exitCode = 1;
  });
}

async function main() {
  const host = String(args.host ?? process.env.PROOFROUTE_CLASSIFIER_HOST ?? '127.0.0.1');
  const port = Number(args.port ?? process.env.PORT ?? process.env.PROOFROUTE_CLASSIFIER_PORT ?? DEFAULT_CLASSIFIER_SIDECAR_PORT);
  const lanes = Number(args.lanes ?? process.env.PROOFROUTE_GPU_LANES ?? 1);
  const backend = String(args.backend ?? process.env.PROOFROUTE_CLASSIFIER_BACKEND ?? 'sidecar-builtin');
  const devices = String(args.devices ?? process.env.PROOFROUTE_GPU_DEVICES ?? process.env.CUDA_VISIBLE_DEVICES ?? '');
  const deviceProfiles = args['device-profiles'] ?? args.deviceProfiles ?? process.env.PROOFROUTE_GPU_DEVICE_PROFILES;
  const deviceNames = args['device-names'] ?? args.deviceNames ?? process.env.PROOFROUTE_GPU_DEVICE_NAMES;
  const deviceMemoryMb = args['device-memory-mb'] ?? args.deviceMemoryMb ?? process.env.PROOFROUTE_GPU_MEMORY_MB;
  const deviceRuntime = args['device-runtime'] ?? args.deviceRuntime ?? process.env.PROOFROUTE_GPU_RUNTIME;
  const deviceDriver = args['device-driver'] ?? args.deviceDriver ?? process.env.PROOFROUTE_GPU_DRIVER;
  const scheduler = String(args.scheduler ?? process.env.PROOFROUTE_GPU_SCHEDULER ?? 'least-inflight');
  const acceleratorBackend = String(args['accelerator-backend'] ?? args.acceleratorBackend ?? process.env.PROOFROUTE_ACCELERATOR_BACKEND ?? backend);
  const acceleratorScheduler = String(args['accelerator-scheduler'] ?? args.acceleratorScheduler ?? process.env.PROOFROUTE_ACCELERATOR_SCHEDULER ?? 'round-robin');
  const acceleratorModule = args['accelerator-module'] ?? args.acceleratorModule ?? process.env.PROOFROUTE_ACCELERATOR_MODULE;
  const acceleratorModel = args['accelerator-model'] ?? args.acceleratorModel ?? process.env.PROOFROUTE_ACCELERATOR_MODEL;
  const batchWindowMs = Number(args['batch-window-ms'] ?? args.batchWindowMs ?? process.env.PROOFROUTE_CLASSIFIER_BATCH_WINDOW_MS ?? 0);
  const maxBatchSize = Number(args['max-batch-size'] ?? args.maxBatchSize ?? process.env.PROOFROUTE_CLASSIFIER_MAX_BATCH_SIZE ?? 16);
  const warmupOnStart = Boolean(args.warmup) || truthy(process.env.PROOFROUTE_CLASSIFIER_WARMUP);
  const requireWarmup = Boolean(args['require-warmup'] ?? args.requireWarmup) || truthy(process.env.PROOFROUTE_CLASSIFIER_REQUIRE_WARMUP);
  const persistentCommand = args['persistent-command'] ?? args.persistentCommand ?? process.env.PROOFROUTE_CLASSIFIER_PERSISTENT_COMMAND;
  const command = persistentCommand ?? args.command ?? process.env.PROOFROUTE_CLASSIFIER_COMMAND;
  const commandMode = String(args['command-mode'] ?? args.commandMode ?? process.env.PROOFROUTE_CLASSIFIER_COMMAND_MODE ?? (persistentCommand ? 'persistent' : 'spawn'));
  const timeoutMs = Number(args.timeout ?? args.timeoutMs ?? process.env.PROOFROUTE_CLASSIFIER_TIMEOUT_MS ?? 12);
  const failureThreshold = Number(args['failure-threshold'] ?? args.failureThreshold ?? process.env.PROOFROUTE_CLASSIFIER_FAILURE_THRESHOLD ?? 3);
  const cooldownMs = Number(args['cooldown-ms'] ?? args.cooldownMs ?? process.env.PROOFROUTE_CLASSIFIER_COOLDOWN_MS ?? 1000);
  const manualDeviceProfile = deviceProfiles || deviceNames || deviceMemoryMb || deviceRuntime || deviceDriver;
  const autoDetectDevices = !manualDeviceProfile && !Boolean(args['no-device-auto-detect'] ?? args.noDeviceAutoDetect) && !falsey(args['device-auto-detect'] ?? args.deviceAutoDetect ?? process.env.PROOFROUTE_GPU_AUTO_DETECT ?? 'true');
  const detectedDeviceProfiles = autoDetectDevices ? await detectNvidiaDeviceProfiles({
    devices,
    timeoutMs: Number(args['device-detect-timeout-ms'] ?? args.deviceDetectTimeoutMs ?? process.env.PROOFROUTE_GPU_DETECT_TIMEOUT_MS ?? 120)
  }) : [];
  const resolvedDevices = devices || detectedDeviceProfiles.map((profile) => profile.id).join(',');
  const resolvedDeviceProfiles = deviceProfiles ?? (manualDeviceProfile ? undefined : detectedDeviceProfiles);
  const acceleratorDevices = String(args['accelerator-devices'] ?? args.acceleratorDevices ?? process.env.PROOFROUTE_ACCELERATOR_DEVICES ?? resolvedDevices);
  const acceleratorEnv = {
    PROOFROUTE_ACCELERATOR_BACKEND: acceleratorBackend,
    ...(acceleratorDevices ? { PROOFROUTE_ACCELERATOR_DEVICES: acceleratorDevices } : {}),
    ...(acceleratorScheduler ? { PROOFROUTE_ACCELERATOR_SCHEDULER: acceleratorScheduler } : {}),
    ...(acceleratorModule ? { PROOFROUTE_ACCELERATOR_MODULE: String(acceleratorModule) } : {}),
    ...(acceleratorModel ? { PROOFROUTE_ACCELERATOR_MODEL: String(acceleratorModel) } : {})
  };
  const classifier = command ? commandMode === 'persistent' ? new PersistentClassifier({ command: String(command), timeoutMs, env: acceleratorEnv }) : new ExternalClassifier({ command: String(command), timeoutMs, failureThreshold, cooldownMs, env: acceleratorEnv }) : undefined;
  const server = createClassifierSidecar({
    lanes,
    backend,
    devices: resolvedDevices,
    deviceProfiles: resolvedDeviceProfiles,
    deviceNames,
    deviceMemoryMb,
    deviceRuntime,
    deviceDriver,
    scheduler,
    batchWindowMs,
    maxBatchSize,
    requireWarmup,
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
    const origin = `http://${connectHost(host)}:${actualPort}`;
    console.log(`proofroute classifier sidecar listening on ${origin}/classify`);
    if (warmupOnStart) void warmSidecar(`${origin}/warmup`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => {
        classifier?.close?.();
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
    'It serves GET /health, GET /ready, GET /metrics, POST /warmup, POST /classify, and POST /classify/batch with scheduler, warmup, batch, lane, and device metadata.',
    '',
    'Usage:',
    '  node ./bin/proofroute-classifier.js --port 8788 --warmup --require-warmup --lanes 4 --devices 0,1 --scheduler least-inflight --batch-window-ms 0 --max-batch-size 16 --backend sidecar-builtin',
    '  node ./bin/proofroute-classifier.js --persistent-command "node ./examples/persistent-classifier-command.js" --batch-window-ms 1 --max-batch-size 16',
    '  node ./bin/proofroute-classifier.js --persistent-command "node ./examples/accelerator-worker.js" --accelerator-module examples/linear-accelerator-module.js --accelerator-model examples/linear-intent-model.json',
    '  node ./examples/export-linear-intent-onnx.js --out examples/linear-intent-model.onnx',
    '  sh ./examples/onnx-accelerator-sidecar.sh',
    '  PROOFROUTE_TENSORRT_ENGINE=./intent.plan sh ./examples/tensorrt-accelerator-sidecar.sh',
    '',
    'Environment:',
    '  PROOFROUTE_CLASSIFIER_PORT controls the listening port.',
    '  PROOFROUTE_CLASSIFIER_BACKEND names the local classifier backend in health metadata.',
    '  PROOFROUTE_CLASSIFIER_COMMAND wraps an external stdin/stdout classifier behind the HTTP sidecar.',
    '  PROOFROUTE_CLASSIFIER_PERSISTENT_COMMAND keeps an NDJSON classifier worker hot behind the HTTP sidecar.',
    '  PROOFROUTE_CLASSIFIER_COMMAND_MODE selects spawn or persistent command execution.',
    '  PROOFROUTE_CLASSIFIER_TIMEOUT_MS bounds the wrapped classifier call before fallback.',
    '  PROOFROUTE_CLASSIFIER_FAILURE_THRESHOLD opens the local fallback circuit after repeated classifier failures.',
    '  PROOFROUTE_CLASSIFIER_COOLDOWN_MS controls how long the fallback circuit skips the external classifier.',
    '  PROOFROUTE_CLASSIFIER_WARMUP warms the sidecar through POST /warmup immediately after listen.',
    '  PROOFROUTE_CLASSIFIER_REQUIRE_WARMUP keeps GET /ready at 503 until warmup has passed.',
    '  PROOFROUTE_GPU_DEVICES declares the visible accelerator devices for health metadata.',
    '  PROOFROUTE_GPU_AUTO_DETECT controls the bounded nvidia-smi hardware profile probe at startup.',
    '  PROOFROUTE_GPU_DETECT_TIMEOUT_MS bounds the nvidia-smi startup probe before metadata falls back to configured ids.',
    '  PROOFROUTE_GPU_DEVICE_PROFILES may contain JSON device profile metadata keyed by device id or ordered as an array.',
    '  PROOFROUTE_GPU_DEVICE_NAMES declares comma-separated accelerator display names for proof metadata.',
    '  PROOFROUTE_GPU_MEMORY_MB declares comma-separated accelerator memory sizes in MiB for proof metadata.',
    '  PROOFROUTE_GPU_RUNTIME declares the CUDA, ROCm, Metal, ONNX, or private runtime label for proof metadata.',
    '  PROOFROUTE_GPU_DRIVER declares the accelerator driver label for proof metadata.',
    '  PROOFROUTE_GPU_LANES declares the local classifier lane count for telemetry.',
    '  PROOFROUTE_GPU_SCHEDULER selects least-inflight or round-robin lane assignment.',
    '  PROOFROUTE_CLASSIFIER_BATCH_WINDOW_MS controls single-request microbatch wait before classifyMany.',
    '  PROOFROUTE_CLASSIFIER_MAX_BATCH_SIZE controls the largest sidecar microbatch.',
    '  PROOFROUTE_ACCELERATOR_BACKEND names the worker backend shown in prompt-free proof metadata.',
    '  PROOFROUTE_ACCELERATOR_DEVICES declares the visible accelerator devices for the worker.',
    '  PROOFROUTE_ACCELERATOR_SCHEDULER selects round-robin or sticky-batch sharding inside the worker.',
    '  PROOFROUTE_ACCELERATOR_MODULE points the worker at a warmable accelerator adapter module.',
    '  PROOFROUTE_ACCELERATOR_MODEL points the worker at a local intent model artifact.',
    '  PROOFROUTE_ONNX_RUNTIME_PACKAGE selects the optional runtime package used by examples/onnx-accelerator-module.js.',
    '  PROOFROUTE_ONNX_MODEL points the ONNX accelerator launcher at a local intent model artifact.',
    '  PROOFROUTE_ONNX_EXECUTION_PROVIDERS selects execution providers such as cuda,cpu when the runtime supports them.',
    '  PROOFROUTE_TENSORRT_RUNTIME_PACKAGE selects the optional TensorRT runtime package used by examples/tensorrt-accelerator-module.js.',
    '  PROOFROUTE_TENSORRT_ENGINE points the TensorRT accelerator launcher at a machine-built serialized engine.',
    '  PROOFROUTE_TENSORRT_PRECISION labels the TensorRT proof metadata with fp16, int8, or fp32.',
    '  PROOFROUTE_TENSORRT_MAX_BATCH_SIZE declares the largest batch shape compiled into the TensorRT engine.'
  ].join('\n');
}

async function warmSidecar(url) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{}'
    });
    const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
    if (!response.ok || payload.ok === false) {
      console.error(`proofroute classifier sidecar warmup failed with ${response.status} at ${url}`);
      return;
    }
    console.log(`proofroute classifier sidecar warmed ${payload.count ?? 0} prompts through ${payload.backend ?? 'unknown'} in ${formatMs(payload.elapsedMs)}.`);
  } catch (error) {
    console.error(`proofroute classifier sidecar warmup failed: ${error.message}`);
  }
}

function connectHost(host) {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1';
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`;
  return host;
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}

function falsey(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value ?? '').toLowerCase());
}

function formatMs(value) {
  const parsed = Number(value);
  return `${Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00'}ms`;
}
