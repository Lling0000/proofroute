#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AgentRuntime } from '../src/agent/runtime.js';
import { classifierMetricsReport, doctorReport } from '../src/agent/doctor.js';
import { parseNonNegativeNumber, startProxy } from '../src/agent/proxy.js';
import { runSmokeTest } from '../src/agent/smoke.js';
import { readRouteEvents, summarizeRouteEvents, telemetryPath } from '../src/agent/telemetry.js';
import { exportTunedConfig, tuneFromEvents } from '../src/agent/tuner.js';
import { demoCatalog, mergeConfig, readConfig } from '../src/config.js';
import { ExternalClassifier } from '../src/controller/gpu-classifier.js';
import { RouteController } from '../src/controller/route-controller.js';
import { renderAgentExecution, renderAgentPlan, renderCalibration, renderClassifierMetrics, renderConnect, renderConnectShell, renderDecision, renderDashboard, renderDoctor, renderHelp, renderJson, renderLaunchDemo, renderModelCatalog, renderProofGate, renderRouteTrace, renderShare, renderShareMarkdown, renderSmoke, renderStats, renderTune } from '../src/view/terminal.js';

const command = process.argv[2] ?? 'help';
const args = parseArgs(process.argv.slice(3));

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(renderHelp());
  } else if (command === 'route') {
    const config = await loadRuntimeConfig(args);
    const prompt = await readPrompt(args);
    const controller = new RouteController(config, createClassifier(config));
    const decision = await controller.routeAsync({ prompt, tokens: Number(args.tokens ?? 0) || undefined, outputTokens: Number(args['output-tokens'] ?? args.outputTokens ?? 0) || undefined, maxCostUsd: parseNonNegativeNumber(args['max-cost-usd'] ?? args.maxCostUsd), maxLatencyMs: parseNonNegativeNumber(args['max-latency-ms'] ?? args.maxLatencyMs), policy: args.policy });
    console.log(args.json ? renderJson(decision) : args.trace ? renderRouteTrace(decision) : renderDecision(decision));
  } else if (command === 'demo') {
    const config = await loadRuntimeConfig(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const report = await runtime.launchDemo({ controller, policy: args.policy });
    console.log(args.json ? renderJson(report) : renderLaunchDemo(report));
  } else if (command === 'share') {
    const config = await loadRuntimeConfig(args);
    const ledger = proofLedgerOverride(args);
    let report;
    if (ledger !== undefined) {
      const path = telemetryPath(config, ledger);
      const events = await readRouteEvents(path);
      report = shareReportFromSummary(summarizeRouteEvents(events), path);
    } else {
      const controller = new RouteController(config, createClassifier(config));
      const runtime = new AgentRuntime(config);
      report = await runtime.launchDemo({ controller, policy: args.policy });
    }
    console.log(args.json ? renderJson(report) : args.markdown ? renderShareMarkdown(report) : renderShare(report));
  } else if (command === 'prove') {
    const config = await loadRuntimeConfig(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const ledger = proofLedgerOverride(args);
    let report;
    if (ledger !== undefined) {
      const path = telemetryPath(config, ledger);
      const events = await readRouteEvents(path);
      report = await runtime.prove({ summary: summarizeRouteEvents(events), source: 'ledger', path, thresholds: proofThresholds(args) });
    } else {
      report = await runtime.prove({ controller, policy: args.policy, thresholds: proofThresholds(args) });
    }
    console.log(args.json ? renderJson(report) : renderProofGate(report));
    if (report.status === 'fail') process.exitCode = 1;
  } else if (command === 'connect') {
    const report = connectionReport(args);
    console.log(args.json ? renderJson(report) : args.shell ? renderConnectShell(report, String(args.shell)) : renderConnect(report));
  } else if (command === 'models' || command === 'catalog') {
    const config = await loadRuntimeConfig(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const report = runtime.catalog({ controller });
    console.log(args.json ? renderJson(report) : renderModelCatalog(report));
  } else if (command === 'smoke') {
    const report = await runSmokeTest({ prompt: args.prompt, policy: args.policy, throughProxy: Boolean(args.proxy) });
    console.log(args.json ? renderJson(report) : renderSmoke(report));
    if (report.status === 'fail') process.exitCode = 1;
  } else if (command === 'bench') {
    const config = await loadRuntimeConfig(args);
    const prompt = args.prompt ?? 'Refactor this payment webhook, explain the bug, and write a focused regression test.';
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const report = await runtime.benchmark({ prompt, runs: Number(args.runs ?? 7), controller, policy: args.policy });
    console.log(args.json ? renderJson(report) : renderDashboard(report));
  } else if (command === 'calibrate') {
    const config = await loadRuntimeConfig(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const samples = await readSamples(args);
    const report = await runtime.calibrate({ samples, controller, policy: args.policy });
    console.log(args.json ? renderJson(report) : renderCalibration(report));
  } else if (command === 'plan') {
    const config = await loadRuntimeConfig(args);
    const prompt = await readPrompt(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const plan = await runtime.planAgents({ prompt, controller, policy: args.policy });
    console.log(args.json ? renderJson(plan) : renderAgentPlan(plan));
  } else if (command === 'fanout') {
    const config = await loadRuntimeConfig(args);
    const prompt = await readPrompt(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const report = await runtime.executeAgentPlan({ prompt, controller, policy: args.policy, maxTokens: Number(args['max-tokens'] ?? args.maxTokens ?? 160) });
    console.log(args.json ? renderJson(report) : renderAgentExecution(report));
    if (report.status === 'fail') process.exitCode = 1;
  } else if (command === 'stats') {
    const config = await loadRuntimeConfig(args);
    const path = telemetryPath(config, args.file);
    const events = await readRouteEvents(path);
    const summary = summarizeRouteEvents(events);
    const report = { path, summary };
    console.log(args.json ? renderJson(report) : renderStats(report));
  } else if (command === 'classifier' || command === 'accelerator') {
    const config = await loadRuntimeConfig(args);
    const report = await classifierMetricsReport({ classifier: createClassifier(config) });
    console.log(args.json ? renderJson(report) : renderClassifierMetrics(report));
    if (report.status === 'fail') process.exitCode = 1;
  } else if (command === 'doctor') {
    const config = await loadRuntimeConfig(args);
    const classifier = createClassifier(config);
    const controller = new RouteController(config, classifier);
    const report = await doctorReport({ config, controller, classifier, telemetryOverride: args.telemetry });
    console.log(args.json ? renderJson(report) : renderDoctor(report));
    if (report.status === 'fail') process.exitCode = 1;
  } else if (command === 'tune') {
    const config = await loadRuntimeConfig(args);
    const path = telemetryPath(config, args.file);
    const events = await readRouteEvents(path);
    const report = { path, ...tuneFromEvents(events, config) };
    if (args.export) {
      await writeJsonFile(resolve(String(args.export)), exportTunedConfig(config, report));
      report.exported = resolve(String(args.export));
    }
    console.log(args.json ? renderJson(report) : renderTune(report));
  } else if (command === 'proxy') {
    const config = await loadRuntimeConfig(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const proxy = await startProxy({
      config,
      controller,
      runtime,
      port: Number(args.port ?? process.env.PORT ?? 8787),
      host: String(args.host ?? '127.0.0.1'),
      telemetryOverride: args.telemetry,
      verbose: Boolean(args.verbose),
      onRoute: ({ decision }) => {
        if (args.verbose) process.stderr.write(`${renderDecision(decision)}\n`);
      }
    });
    console.log(`proofroute proxy listening on ${proxy.url}`);
  } else if (command === 'init') {
    process.stdout.write(await initOutput(args));
  } else {
    console.error(`Unknown command: ${command}`);
    console.error(renderHelp());
    process.exitCode = 1;
  }
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}

async function loadRuntimeConfig(args) {
  const fileConfig = args.config ? await readConfig(resolve(String(args.config))) : {};
  return withEnvironmentModelExtensions(resolveEnvReferences(mergeConfig(demoCatalog(), fileConfig, envConfig())));
}

function envConfig() {
  const providers = {};
  const telemetry = {};
  if (process.env.OPENAI_API_KEY) {
    providers.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    providers.anthropic = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1'
    };
  }
  if (process.env.OLLAMA_BASE_URL) {
    providers.local = { baseUrl: process.env.OLLAMA_BASE_URL, kind: 'ollama' };
  }
  if (process.env.PROOFROUTE_LOCAL_OPENAI_BASE_URL) {
    providers.localOpenai = {
      baseUrl: process.env.PROOFROUTE_LOCAL_OPENAI_BASE_URL,
      requiresApiKey: false,
      healthPath: process.env.PROOFROUTE_LOCAL_OPENAI_HEALTH_PATH ?? '/models',
      timeoutMs: Number(process.env.PROOFROUTE_LOCAL_OPENAI_TIMEOUT_MS ?? 120000)
    };
  }
  if (process.env.PROOFROUTE_TELEMETRY) {
    telemetry.path = process.env.PROOFROUTE_TELEMETRY;
  }
  return { providers, telemetry };
}

function withEnvironmentModelExtensions(config) {
  if (!config.providers?.localOpenai?.baseUrl) return config;
  const models = config.models ?? [];
  if (models.some((model) => model.provider === 'localOpenai')) return config;
  return {
    ...config,
    models: [
      ...models,
      localOpenAIEnvModel()
    ]
  };
}

function localOpenAIEnvModel() {
  return {
    id: String(process.env.PROOFROUTE_LOCAL_OPENAI_MODEL ?? 'local-openai'),
    provider: 'localOpenai',
    endpoint: String(process.env.PROOFROUTE_LOCAL_OPENAI_ENDPOINT ?? '/chat/completions'),
    local: true,
    contextWindow: positiveNumber(process.env.PROOFROUTE_LOCAL_OPENAI_CONTEXT_WINDOW, 131072),
    inputUsdPer1M: 0,
    outputUsdPer1M: 0,
    medianLatencyMs: positiveNumber(process.env.PROOFROUTE_LOCAL_OPENAI_LATENCY_MS, 180),
    throughputTokensPerSecond: positiveNumber(process.env.PROOFROUTE_LOCAL_OPENAI_TOKENS_PER_SECOND, 150),
    quality: {
      code: 0.82,
      reasoning: 0.76,
      writing: 0.68,
      extraction: 0.74,
      chat: 0.72,
      long_context: 0.7
    }
  };
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveEnvReferences(value) {
  if (Array.isArray(value)) return value.map(resolveEnvReferences);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveEnvReferences(entry)]));
  }
  if (typeof value === 'string' && value.startsWith('env:')) {
    return process.env[value.slice(4)] ?? '';
  }
  return value;
}

async function readPrompt(args) {
  if (args.prompt) return String(args.prompt);
  if (args.file) return readFile(resolve(String(args.file)), 'utf8');
  if (!process.stdin.isTTY) return readStdin();
  throw new Error('Pass --prompt "..." or pipe a prompt into stdin.');
}

async function readSamples(args) {
  if (args.file) return JSON.parse(await readFile(resolve(String(args.file)), 'utf8'));
  return [
    {
      id: 'code-fix',
      intent: 'code',
      prompt: 'Refactor this TypeScript webhook, fix the stacktrace, and add a regression test.'
    },
    {
      id: 'long-audit',
      intent: 'long_context',
      prompt: 'Audit this repository migration plan, compare every risk, and summarize the cross-file action items.'
    },
    {
      id: 'extract-json',
      intent: 'extraction',
      prompt: 'Extract the customer ids, invoice totals, and renewal dates into strict JSON.'
    },
    {
      id: 'launch-copy',
      intent: 'writing',
      prompt: 'Rewrite this README introduction so the launch feels credible, sharp, and easy to share.'
    },
    {
      id: 'tradeoff',
      intent: 'reasoning',
      prompt: 'Compare these routing algorithms and explain the cost, latency, and quality tradeoffs.'
    }
  ];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function createClassifier(config) {
  const command = config.classifier?.command ?? process.env.PROOFROUTE_CLASSIFIER;
  const url = config.classifier?.url ?? process.env.PROOFROUTE_CLASSIFIER_URL;
  const timeoutMs = Number(config.classifier?.timeoutMs ?? process.env.PROOFROUTE_CLASSIFIER_TIMEOUT_MS ?? 12);
  return new ExternalClassifier({ command, url, timeoutMs });
}

async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function initOutput(args) {
  const preset = String(args.preset ?? args.provider ?? 'default').toLowerCase();
  if (preset === 'default') return `${JSON.stringify(demoCatalog(), null, 2)}\n`;
  if (['local-openai', 'openai-local', 'lmstudio', 'vllm'].includes(preset)) {
    return readFile(new URL('../examples/local-openai-router.json', import.meta.url), 'utf8');
  }
  throw new Error(`Unknown init preset "${preset}". Use default or local-openai.`);
}

function proofThresholds(args) {
  return {
    maxP95Ms: parseNonNegativeNumber(args['max-p95-ms'] ?? args.maxP95Ms),
    minSavingsUsd: parseNonNegativeNumber(args['min-savings-usd'] ?? args.minSavingsUsd),
    minSpeedup: parseNonNegativeNumber(args['min-speedup'] ?? args.minSpeedup),
    minAccuracy: parseNonNegativeNumber(args['min-accuracy'] ?? args.minAccuracy),
    minRequests: parseNonNegativeNumber(args['min-requests'] ?? args.minRequests)
  };
}

function proofLedgerOverride(args) {
  if (args.ledger !== undefined) return args.ledger === true ? null : args.ledger;
  if (args.file !== undefined) return args.file;
  return undefined;
}

function shareReportFromSummary(summary, path) {
  const baselineCostUsd = Number(summary.actualBaselineCostUsd) > 0 ? Number(summary.actualBaselineCostUsd) : Number(summary.estimatedCostUsd ?? 0) + Number(summary.estimatedSavingsUsd ?? summary.savingsUsd ?? 0);
  const savingsUsd = Number(summary.savingsUsd ?? 0);
  return {
    source: 'ledger',
    path,
    aggregate: {
      count: Number(summary.count ?? 0),
      p95RouterMs: Number(summary.p95RouterMs ?? 0),
      savingsUsd,
      savingsPct: baselineCostUsd > 0 ? Math.max(0, Math.min(1, savingsUsd / baselineCostUsd)) : 0,
      averageSpeedup: Number(summary.averageSpeedup ?? 0),
      localRoutes: Number(summary.local ?? 0),
      cloudRoutes: Number(summary.cloud ?? 0),
      intents: summary.intents ?? {},
      models: summary.models ?? {}
    }
  };
}

function connectionReport(args) {
  const host = String(args.host ?? '127.0.0.1');
  const port = Number(args.port ?? process.env.PORT ?? 8787);
  const origin = String(args.origin ?? `http://${host}:${port}`).replace(/\/$/, '');
  const baseUrl = String(args['base-url'] ?? args.baseUrl ?? `${origin}/v1`).replace(/\/$/, '');
  const apiKey = String(args['api-key'] ?? args.apiKey ?? 'proofroute-local');
  return {
    host,
    port,
    origin,
    baseUrl,
    apiKey,
    env: {
      OPENAI_BASE_URL: baseUrl,
      OPENAI_API_BASE: baseUrl,
      OPENAI_API_KEY: apiKey
    },
    commands: {
      startProxy: `node ./bin/proofroute.js proxy --port ${port} --config router.json`,
      ready: `curl ${origin}/ready`,
      models: `curl ${baseUrl}/models`,
      browserProof: 'node ./bin/proofroute.js smoke --proxy',
      proof: 'node ./bin/proofroute.js prove --ledger --min-requests 1'
    }
  };
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

function formatError(error) {
  if (existsSync('/.dockerenv')) return error.stack ?? error.message;
  return `proofroute: ${error.message}`;
}
