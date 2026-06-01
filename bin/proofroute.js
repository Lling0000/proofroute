#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { classifierEvidenceReport, classifierEvidenceVerificationFailure, verifyClassifierEvidenceFile } from '../src/agent/classifier-evidence.js';
import { classifierBenchmarkReport } from '../src/agent/classifier-proof.js';
import { trainIntentModelFiles } from '../src/agent/intent-training.js';
import { AgentRuntime } from '../src/agent/runtime.js';
import { classifierMetricsReport, doctorReport } from '../src/agent/doctor.js';
import { launchReadinessReport } from '../src/agent/launch-readiness.js';
import { privacyReport } from '../src/agent/privacy.js';
import { parseNonNegativeNumber, startProxy } from '../src/agent/proxy.js';
import { publishReadinessReport } from '../src/agent/publish-readiness.js';
import { releasePreflightReport, releaseProofPack } from '../src/agent/release-pack.js';
import { githubRepositoryStateReport, publicRepositoryFaceReport, repositoryProfileReport } from '../src/agent/repository-profile.js';
import { runSmokeTest } from '../src/agent/smoke.js';
import { readRouteEvents, readRouteEventsWithDiagnostics, recentRouteEvents, routeEventsInWindow, summarizeRouteEvents, telemetryPath } from '../src/agent/telemetry.js';
import { exportTunedConfig, tuneFromEvents } from '../src/agent/tuner.js';
import { demoCatalog, mergeConfig, readConfig } from '../src/config.js';
import { ExternalClassifier } from '../src/controller/gpu-classifier.js';
import { RouteController } from '../src/controller/route-controller.js';
import { renderAgentExecution, renderAgentPlan, renderCalibration, renderClassifierBenchmark, renderClassifierEvidenceVerification, renderClassifierMetrics, renderClassifierSvg, renderConnect, renderConnectShell, renderDecision, renderDashboard, renderDoctor, renderGithubRepositoryState, renderHelp, renderIntentTraining, renderJson, renderLaunchDemo, renderLaunchReadiness, renderModelCatalog, renderPrivacy, renderProofGate, renderPublicRepositoryFace, renderPublishReadiness, renderPublishSupportNote, renderReleasePreflight, renderReleaseProofPack, renderRepositoryProfile, renderRouteTrace, renderShare, renderShareMarkdown, renderShareSvg, renderSmoke, renderStats, renderTune } from '../src/view/terminal.js';

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
      const { path, events, window } = await readLedgerWindow(config, ledger, args);
      report = shareReportFromSummary(summarizeRouteEvents(events), path, window);
    } else {
      const controller = new RouteController(config, createClassifier(config));
      const runtime = new AgentRuntime(config);
      report = await runtime.launchDemo({ controller, policy: args.policy });
    }
    const output = args.json ? renderJson(report) : args.svg ? renderShareSvg(report) : args.markdown ? renderShareMarkdown(report) : renderShare(report);
    if (args.out) {
      await writeTextFile(resolve(String(args.out)), output);
    } else {
      process.stdout.write(`${output}\n`);
    }
  } else if (command === 'prove') {
    const config = await loadRuntimeConfig(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const ledger = proofLedgerOverride(args);
    let report;
    if (ledger !== undefined) {
      const { path, events, window } = await readLedgerWindow(config, ledger, args);
      report = { ...(await runtime.prove({ summary: summarizeRouteEvents(events), source: 'ledger', path, thresholds: proofThresholds(args) })), window };
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
  } else if (command === 'profile' || command === 'repo') {
    if (truthy(args['check-public'] ?? args.checkPublic ?? args.public)) {
      const report = await publicRepositoryFaceReport();
      console.log(args.json ? renderJson(report) : renderPublicRepositoryFace(report));
      if (report.status === 'fail') process.exitCode = 1;
    } else if (truthy(args['check-github'] ?? args.checkGithub) || truthy(args['sync-github'] ?? args.syncGithub)) {
      const report = await githubRepositoryStateReport({
        mode: truthy(args['sync-github'] ?? args.syncGithub) ? 'sync' : 'check',
        repo: args.repo ?? args['github-repo'] ?? args.githubRepo,
        token: args['github-token'] ?? args.githubToken,
        tokenEnv: args['github-token-env'] ?? args.githubTokenEnv
      });
      console.log(args.json ? renderJson(report) : renderGithubRepositoryState(report));
      if (report.status === 'fail') process.exitCode = 1;
    } else {
      const report = await repositoryProfileReport();
      console.log(args.json ? renderJson(report) : renderRepositoryProfile(report));
    }
  } else if (command === 'launch' || command === 'readiness') {
    const config = await loadRuntimeConfig(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const evidencePath = args.evidence === true ? 'classifier-evidence.json' : args.evidence ?? args['evidence-file'] ?? args.evidenceFile ?? 'classifier-evidence.json';
    const maxEvidenceAgeMs = evidenceMaxAgeMs(args);
    const requireEvidence = truthy(args['require-evidence'] ?? args.requireEvidence);
    const requireArtifactEvidence = truthy(args['require-artifact-evidence'] ?? args.requireArtifactEvidence);
    const artifactEvidencePath = classifierArtifactEvidencePath(args, requireArtifactEvidence);
    const mainMaxEvidenceAgeMs = requireArtifactEvidence && !requireEvidence ? undefined : maxEvidenceAgeMs;
    const core = truthy(args.core ?? args['no-accelerator-claim'] ?? args.noAcceleratorClaim) || (requireArtifactEvidence && !requireEvidence);
    if (core && requireEvidence) throw new Error('Use --core or --require-artifact-evidence for a no-accelerator-claim launch, or --require-evidence for a strict hardware launch, not both.');
    const report = await launchReadinessReport({
      config,
      controller,
      runtime,
      telemetryPath: telemetryPath(config, args.file ?? args.telemetry),
      evidencePath: String(evidencePath),
      requireEvidence,
      evidenceMode: core ? 'skipped' : undefined,
      maxEvidenceAgeMs: mainMaxEvidenceAgeMs,
      artifactEvidencePath,
      requireArtifactEvidence,
      artifactMaxEvidenceAgeMs: artifactEvidencePath === undefined ? undefined : maxEvidenceAgeMs,
      smoke: !truthy(args['no-smoke'] ?? args.noSmoke),
      github: truthy(args['check-github'] ?? args.checkGithub),
      githubRepo: args.repo ?? args['github-repo'] ?? args.githubRepo,
      githubToken: args['github-token'] ?? args.githubToken,
      githubTokenEnv: args['github-token-env'] ?? args.githubTokenEnv,
      publicFace: truthy(args['check-public'] ?? args.checkPublic)
    });
    console.log(args.json ? renderJson(report) : renderLaunchReadiness(report));
    if (report.status === 'fail') process.exitCode = 1;
  } else if (command === 'release' || command === 'pack') {
    const config = await loadRuntimeConfig(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const evidencePath = args.evidence === true ? 'classifier-evidence.json' : args.evidence ?? args['evidence-file'] ?? args.evidenceFile ?? 'classifier-evidence.json';
    const maxEvidenceAgeMs = evidenceMaxAgeMs(args);
    const core = truthy(args.core);
    const requireEvidence = truthy(args['require-evidence'] ?? args.requireEvidence);
    const requireArtifactEvidence = truthy(args['require-artifact-evidence'] ?? args.requireArtifactEvidence);
    const artifactEvidencePath = classifierArtifactEvidencePath(args, requireArtifactEvidence);
    const mainMaxEvidenceAgeMs = requireArtifactEvidence && !requireEvidence ? undefined : maxEvidenceAgeMs;
    if (core && requireEvidence) throw new Error('Use --core for a no-accelerator-claim release or --require-evidence for a strict hardware release, not both.');
    const outDir = args.out ?? args.dir ?? 'proofroute-release-pack';
    const telemetryOverride = args.file ?? args.telemetry;
    const preflight = truthy(args.preflight);
    const smoke = preflight ? truthy(args.smoke) && !truthy(args['no-smoke'] ?? args.noSmoke) : !truthy(args['no-smoke'] ?? args.noSmoke);
    const releaseOptions = {
      controller,
      runtime,
      outDir,
      telemetryPath: core && telemetryOverride === undefined ? join(resolve(String(outDir)), 'events.empty.jsonl') : telemetryPath(config, telemetryOverride),
      evidencePath: String(evidencePath),
      requireEvidence,
      artifactEvidencePath,
      requireArtifactEvidence,
      core,
      maxEvidenceAgeMs: mainMaxEvidenceAgeMs,
      artifactMaxEvidenceAgeMs: artifactEvidencePath === undefined ? undefined : maxEvidenceAgeMs,
      smoke,
      github: truthy(args['check-github'] ?? args.checkGithub),
      githubRepo: args.repo ?? args['github-repo'] ?? args.githubRepo,
      githubToken: args['github-token'] ?? args.githubToken,
      githubTokenEnv: args['github-token-env'] ?? args.githubTokenEnv,
      publicFace: truthy(args['check-public'] ?? args.checkPublic)
    };
    const report = preflight ? await releasePreflightReport(releaseOptions) : await releaseProofPack(releaseOptions);
    console.log(args.json ? renderJson(report) : preflight ? renderReleasePreflight(report) : renderReleaseProofPack(report));
    if (report.status === 'fail') process.exitCode = 1;
  } else if (command === 'publish') {
    const report = await publishReadinessReport({
      npmCommand: args.npm ?? args['npm-command'] ?? args.npmCommand,
      registry: args.registry,
      checkPublic: !truthy(args['no-public'] ?? args.noPublic) && (truthy(args['check-public'] ?? args.checkPublic) || truthy(args.public)),
      checkActions: truthy(args['check-actions'] ?? args.checkActions),
      probeActionsDispatch: truthy(args['probe-actions-dispatch'] ?? args.probeActionsDispatch),
      actionsWorkflow: args['actions-workflow'] ?? args.actionsWorkflow,
      actionsRef: args['actions-ref'] ?? args.actionsRef ?? args.ref,
      repo: args.repo ?? args['github-repo'] ?? args.githubRepo
    });
    const supportNote = truthy(args['support-note'] ?? args.supportNote);
    console.log(args.json ? renderJson(report) : supportNote ? renderPublishSupportNote(report) : renderPublishReadiness(report));
    if (report.status === 'fail') process.exitCode = 1;
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
    const output = args.json ? renderJson(report) : renderCalibration(report);
    if (args.out) {
      await writeTextFile(resolve(String(args.out)), output);
    } else {
      console.log(output);
    }
  } else if (command === 'learn') {
    const report = await trainIntentModelFiles({
      modelPath: args.model,
      samplesPath: args.samples ?? args.file,
      outPath: args.out,
      onnxOut: args['onnx-out'] ?? args.onnxOut,
      epochs: args.epochs,
      learningRate: args['learning-rate'] ?? args.learningRate
    });
    console.log(args.json ? renderJson(report) : renderIntentTraining(report));
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
    if (args.watch) {
      await watchStats(config, args);
    } else {
      const report = await statsReport(config, args);
      console.log(args.json ? renderJson(report) : renderStats(report));
    }
  } else if (command === 'privacy' || command === 'audit') {
    const config = await loadRuntimeConfig(args);
    const report = await privacyReport(telemetryPath(config, args.file ?? args.telemetry));
    console.log(args.json ? renderJson(report) : renderPrivacy(report));
    if (report.status === 'fail') process.exitCode = 1;
  } else if (command === 'classifier' || command === 'accelerator') {
    if (args['verify-evidence'] || args.verifyEvidence) {
      const evidencePath = args['verify-evidence'] === true ? args.file : args['verify-evidence'] ?? args.verifyEvidence;
      if (!evidencePath) throw new Error('Pass --verify-evidence classifier-evidence.json to verify a classifier evidence bundle.');
      let report;
      try {
        report = await verifyClassifierEvidenceFile(String(evidencePath), {
          allowArtifactOnly: truthy(args['allow-artifact-only'] ?? args.allowArtifactOnly),
          requireDeviceProfiles: truthy(args['require-device-profiles'] ?? args.requireDeviceProfiles),
          requireHardwareProbe: truthy(args['require-hardware-probe'] ?? args.requireHardwareProbe),
          maxAgeMs: evidenceMaxAgeMs(args)
        });
      } catch (error) {
        report = classifierEvidenceVerificationFailure(String(evidencePath), error);
      }
      const output = args.json ? renderJson(report) : renderClassifierEvidenceVerification(report);
      if (args.out) {
        await writeTextFile(resolve(String(args.out)), output);
      } else {
        console.log(output);
      }
      if (report.status === 'fail') process.exitCode = 1;
    } else {
      const config = await loadRuntimeConfig(args);
      const classifier = createClassifier(config);
      let report = args.bench ? await classifierBenchmarkReport({ classifier, samples: await readSamples(args), runs: Number(args.runs ?? 3), thresholds: classifierBenchmarkThresholds(args), warmup: Boolean(args.warmup) }) : await classifierMetricsReport({ classifier, warmup: Boolean(args.warmup) });
      if (args.evidence) {
        report = {
          ...report,
          evidence: await classifierEvidenceReport({ report, classifier, argv: process.argv.slice(2) })
        };
      }
      const output = args.json ? renderJson(report) : args.svg ? renderClassifierSvg(report) : args.bench ? renderClassifierBenchmark(report) : renderClassifierMetrics(report);
      if (args.out) {
        await writeTextFile(resolve(String(args.out)), output);
      } else {
        console.log(output);
      }
      if (report.status === 'fail') process.exitCode = 1;
    }
  } else if (command === 'doctor') {
    const config = await loadRuntimeConfig(args);
    const classifier = createClassifier(config);
    const controller = new RouteController(config, classifier);
    const strictHardware = truthy(args['strict-hardware'] ?? args.strictHardware);
    const classifierThresholds = classifierBenchmarkThresholds(args);
    const report = await doctorReport({
      config,
      controller,
      classifier,
      telemetryOverride: args.telemetry,
      requireClassifierWarmup: strictHardware || truthy(args['require-warmup'] ?? args.requireWarmup),
      minClassifierDevices: strictHardware ? classifierThresholds.minDevices ?? 2 : classifierThresholds.minDevices,
      minClassifierLanes: strictHardware ? classifierThresholds.minLanes ?? 2 : classifierThresholds.minLanes,
      requireClassifierHardwareProbe: strictHardware || classifierThresholds.requireHardwareProbe
    });
    console.log(args.json ? renderJson(report) : renderDoctor(report));
    if (report.status === 'fail') process.exitCode = 1;
  } else if (command === 'tune') {
    const config = await loadRuntimeConfig(args);
    const { path, events, window } = await readLedgerWindow(config, args.file, args);
    const report = { path, window, ...tuneFromEvents(events, config) };
    if (args.export) {
      await writeJsonFile(resolve(String(args.export)), exportTunedConfig(config, report));
      report.exported = resolve(String(args.export));
    }
    console.log(args.json ? renderJson(report) : renderTune(report));
  } else if (command === 'proxy') {
    const config = await loadRuntimeConfig(args);
    const classifier = createClassifier(config);
    if (Boolean(args['require-classifier-warmup'] ?? args.requireClassifierWarmup) || truthy(process.env.PROOFROUTE_REQUIRE_CLASSIFIER_WARMUP)) {
      await assertClassifierReady(classifier);
    }
    const controller = new RouteController(config, classifier);
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

function nonNegativeInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  throw new Error(`Pass ${name} as a positive integer.`);
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
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
  const failureThreshold = Number(config.classifier?.failureThreshold ?? process.env.PROOFROUTE_CLASSIFIER_FAILURE_THRESHOLD ?? 3);
  const cooldownMs = Number(config.classifier?.cooldownMs ?? process.env.PROOFROUTE_CLASSIFIER_COOLDOWN_MS ?? 1000);
  return new ExternalClassifier({ command, url, timeoutMs, failureThreshold, cooldownMs });
}

async function assertClassifierReady(classifier) {
  if (!classifier?.url) {
    throw new Error('A ready HTTP classifier sidecar is required before starting the proxy.');
  }
  const url = classifierReadyUrl(classifier.url);
  const timeoutMs = Math.max(25, Number(classifier.timeoutMs ?? 12) * 4);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
    if (!response.ok || payload.ok === false || payload.ready === false || payload.warmed !== true) {
      throw new Error(`Classifier sidecar is not ready at ${url}; run proofroute-classifier with --warmup --require-warmup or run proofroute classifier --warmup before starting the proxy.`);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Classifier sidecar readiness at ${url} did not answer within ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function classifierReadyUrl(url) {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/\/classify(?:\/batch)?\/?$/, '/ready') || '/ready';
  if (!parsed.pathname.endsWith('/ready')) parsed.pathname = '/ready';
  parsed.search = '';
  return parsed.toString();
}

async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeTextFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${value.replace(/\n?$/, '\n')}`, 'utf8');
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
    maxRouterOverheadPct: parseNonNegativeNumber(args['max-router-overhead-pct'] ?? args.maxRouterOverheadPct),
    minSavingsUsd: parseNonNegativeNumber(args['min-savings-usd'] ?? args.minSavingsUsd),
    minSpeedup: parseNonNegativeNumber(args['min-speedup'] ?? args.minSpeedup),
    minAccuracy: parseNonNegativeNumber(args['min-accuracy'] ?? args.minAccuracy),
    minRequests: parseNonNegativeNumber(args['min-requests'] ?? args.minRequests),
    maxClassifierCircuitOpen: parseNonNegativeNumber(args['max-classifier-circuit-open'] ?? args.maxClassifierCircuitOpen)
  };
}

function classifierBenchmarkThresholds(args) {
  return {
    maxP95Ms: parseNonNegativeNumber(args['max-p95-ms'] ?? args.maxP95Ms),
    minAccuracy: parseNonNegativeNumber(args['min-accuracy'] ?? args.minAccuracy),
    minThroughput: parseNonNegativeNumber(args['min-throughput'] ?? args.minThroughput),
    minDevices: parseNonNegativeNumber(args['min-devices'] ?? args.minDevices ?? args['min-classifier-devices'] ?? args.minClassifierDevices),
    minLanes: parseNonNegativeNumber(args['min-lanes'] ?? args.minLanes ?? args['min-classifier-lanes'] ?? args.minClassifierLanes),
    requireDeviceProfiles: truthy(args['require-device-profiles'] ?? args.requireDeviceProfiles),
    requireHardwareProbe: truthy(args['require-hardware-probe'] ?? args.requireHardwareProbe ?? args['require-classifier-hardware-probe'] ?? args.requireClassifierHardwareProbe)
  };
}

function evidenceMaxAgeMs(args) {
  const value = args['max-evidence-age-hours'] ?? args.maxEvidenceAgeHours;
  if (value === undefined) return undefined;
  if (value === true) throw new Error('Pass --max-evidence-age-hours as a positive number.');
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Pass --max-evidence-age-hours as a positive number.');
  return parsed * 3600000;
}

function classifierArtifactEvidencePath(args, required) {
  const value = args['artifact-evidence'] ?? args.artifactEvidence;
  if (value === undefined) return required ? 'classifier-linear-evidence.json' : undefined;
  return value === true ? 'classifier-linear-evidence.json' : String(value);
}

function proofLedgerOverride(args) {
  if (args.ledger !== undefined) return args.ledger === true ? null : args.ledger;
  if (args.file !== undefined) return args.file;
  return undefined;
}

async function readLedgerWindow(config, override, args) {
  const path = telemetryPath(config, override);
  const allEvents = await readRouteEvents(path);
  return { path, ...routeEventsInWindow(allEvents, args.since) };
}

async function statsReport(config, args) {
  const path = telemetryPath(config, args.file);
  const ledger = await readRouteEventsWithDiagnostics(path);
  const { events, window } = routeEventsInWindow(ledger.events, args.since);
  const summary = summarizeRouteEvents(events);
  return {
    path,
    summary,
    window,
    ledger: {
      exists: ledger.exists,
      records: ledger.records,
      bytes: ledger.bytes,
      valid: ledger.events.length,
      errorCount: ledger.errors.length,
      errors: ledger.errors.slice(0, 8)
    },
    recent: recentRouteEvents(events, nonNegativeInteger(args.recent ?? args.limit, 5))
  };
}

async function watchStats(config, args) {
  const ticks = positiveInteger(args.ticks, Infinity, '--ticks');
  const intervalMs = positiveInteger(args['interval-ms'] ?? args.intervalMs, 1000, '--interval-ms');
  for (let tick = 0; tick < ticks; tick += 1) {
    const report = {
      ...(await statsReport(config, args)),
      watch: {
        tick: tick + 1,
        intervalMs,
        generatedAt: new Date().toISOString()
      }
    };
    if (!args.json && process.stdout.isTTY && tick > 0) process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write(`${args.json ? JSON.stringify(report) : renderStats(report)}\n`);
    if (tick + 1 < ticks) await delay(intervalMs);
  }
}

function shareReportFromSummary(summary, path, window) {
  const baselineCostUsd = Number(summary.actualBaselineCostUsd) > 0 ? Number(summary.actualBaselineCostUsd) : Number(summary.estimatedCostUsd ?? 0) + Number(summary.estimatedSavingsUsd ?? summary.savingsUsd ?? 0);
  const savingsUsd = Number(summary.savingsUsd ?? 0);
  return {
    source: 'ledger',
    path,
    window,
    aggregate: {
      count: Number(summary.count ?? 0),
      p95RouterMs: Number(summary.p95RouterMs ?? 0),
      p95RouterOverheadPct: Number(summary.p95RouterOverheadPct ?? 0),
      savingsUsd,
      savingsPct: baselineCostUsd > 0 ? Math.max(0, Math.min(1, savingsUsd / baselineCostUsd)) : 0,
      averageSpeedup: Number(summary.averageSpeedup ?? 0),
      localRoutes: Number(summary.local ?? 0),
      cloudRoutes: Number(summary.cloud ?? 0),
      intents: summary.intents ?? {},
      policies: summary.policies ?? {},
      classifierBackends: summary.classifierBackends ?? {},
      classifierCircuitOpen: Number(summary.classifierCircuitOpen ?? 0),
      modelSwaps: Number(summary.modelSwaps ?? 0),
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
  const clientEnv = {
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_BASE: baseUrl,
    OPENAI_API_KEY: apiKey
  };
  const proxyEnv = localOpenAIProxyEnv(args);
  const hasProxyEnv = Object.keys(proxyEnv).length > 0;
  return {
    host,
    port,
    origin,
    baseUrl,
    apiKey,
    clientEnv,
    proxyEnv,
    env: {
      ...clientEnv,
      ...proxyEnv
    },
    commands: {
      startProxy: startProxyCommand({ port, host, hasProxyEnv }),
      ready: `curl ${origin}/ready`,
      models: `curl ${baseUrl}/models`,
      browserProof: 'node ./bin/proofroute.js smoke --proxy',
      proof: 'node ./bin/proofroute.js prove --ledger --min-requests 1'
    }
  };
}

function localOpenAIProxyEnv(args) {
  const baseUrlValue = flagValue(args['local-openai-base-url'] ?? args.localOpenaiBaseUrl ?? args['local-openai'] ?? args.localOpenai, process.env.PROOFROUTE_LOCAL_OPENAI_BASE_URL ?? 'http://127.0.0.1:1234/v1');
  const useEnvironment = baseUrlValue !== undefined || process.env.PROOFROUTE_LOCAL_OPENAI_BASE_URL;
  if (!useEnvironment) return {};
  const env = {
    PROOFROUTE_LOCAL_OPENAI_BASE_URL: String(baseUrlValue ?? process.env.PROOFROUTE_LOCAL_OPENAI_BASE_URL).replace(/\/$/, '')
  };
  addOptionalEnv(env, 'PROOFROUTE_LOCAL_OPENAI_MODEL', args['local-openai-model'] ?? args.localOpenaiModel ?? process.env.PROOFROUTE_LOCAL_OPENAI_MODEL);
  addOptionalEnv(env, 'PROOFROUTE_LOCAL_OPENAI_ENDPOINT', args['local-openai-endpoint'] ?? args.localOpenaiEndpoint ?? process.env.PROOFROUTE_LOCAL_OPENAI_ENDPOINT);
  addOptionalEnv(env, 'PROOFROUTE_LOCAL_OPENAI_CONTEXT_WINDOW', args['local-openai-context-window'] ?? args.localOpenaiContextWindow ?? process.env.PROOFROUTE_LOCAL_OPENAI_CONTEXT_WINDOW);
  addOptionalEnv(env, 'PROOFROUTE_LOCAL_OPENAI_LATENCY_MS', args['local-openai-latency-ms'] ?? args.localOpenaiLatencyMs ?? process.env.PROOFROUTE_LOCAL_OPENAI_LATENCY_MS);
  addOptionalEnv(env, 'PROOFROUTE_LOCAL_OPENAI_TOKENS_PER_SECOND', args['local-openai-tokens-per-second'] ?? args.localOpenaiTokensPerSecond ?? process.env.PROOFROUTE_LOCAL_OPENAI_TOKENS_PER_SECOND);
  addOptionalEnv(env, 'PROOFROUTE_LOCAL_OPENAI_HEALTH_PATH', args['local-openai-health-path'] ?? args.localOpenaiHealthPath ?? process.env.PROOFROUTE_LOCAL_OPENAI_HEALTH_PATH);
  addOptionalEnv(env, 'PROOFROUTE_LOCAL_OPENAI_TIMEOUT_MS', args['local-openai-timeout-ms'] ?? args.localOpenaiTimeoutMs ?? process.env.PROOFROUTE_LOCAL_OPENAI_TIMEOUT_MS);
  return env;
}

function flagValue(value, fallback) {
  if (value === undefined) return undefined;
  if (value === true) return fallback;
  return value;
}

function addOptionalEnv(env, key, value) {
  if (value === undefined || value === true || value === '') return;
  env[key] = String(value);
}

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());
}

function startProxyCommand({ port, host, hasProxyEnv }) {
  const parts = ['node ./bin/proofroute.js proxy', `--port ${port}`];
  if (host !== '127.0.0.1') parts.push(`--host ${host}`);
  if (!hasProxyEnv) parts.push('--config router.json');
  return parts.join(' ');
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
