import { classifierWarmupReport } from './doctor.js';

export async function classifierBenchmarkReport({ classifier, samples = [], runs = 3, thresholds = {}, warmup = false } = {}) {
  const suite = normalizeSamples(samples);
  const repeat = Math.max(1, Math.floor(Number(runs) || 3));
  const inputs = [];
  for (let run = 0; run < repeat; run += 1) {
    suite.forEach((sample) => {
      inputs.push({ ...sample, run: run + 1 });
    });
  }
  const warmupReport = warmup ? await warmClassifier(classifier) : undefined;
  if (warmupReport?.status === 'fail') {
    return failedWarmupReport({ classifier, repeat, suite, thresholds, warmupReport });
  }
  const prompts = inputs.map((input) => input.prompt);
  const startedAt = performance.now();
  const intents = await classifyMany(classifier, prompts);
  const elapsedMs = Math.max(0.01, performance.now() - startedAt);
  const rows = inputs.map((input, index) => {
    const intent = intents[index] ?? {};
    const expectedIntent = input.intent;
    const actualIntent = typeof intent.name === 'string' ? intent.name : 'unknown';
    const features = intent.features ?? {};
    return {
      id: input.id,
      run: input.run,
      expectedIntent,
      actualIntent,
      matched: expectedIntent ? expectedIntent === actualIntent : undefined,
      confidence: finite(intent.confidence),
      backend: String(features.backend ?? classifierMode(classifier)),
      batchMode: String(features.batchMode ?? 'single'),
      batchSize: positive(features.batchSize, 1),
      lane: features.lane,
      device: features.device,
      deviceProfile: normalizeDeviceProfile(features.deviceProfile),
      decisionMs: finite(features.decisionMs)
    };
  });
  const perPromptMs = elapsedMs / Math.max(1, rows.length);
  const decisionLatencies = rows.map((row) => row.decisionMs).filter((value) => value > 0);
  const effectiveLatencies = decisionLatencies.length ? decisionLatencies : rows.map(() => perPromptMs);
  const labeled = rows.filter((row) => row.matched !== undefined);
  const deviceProfiles = uniqueDeviceProfiles(rows);
  const aggregate = {
    count: rows.length,
    samples: suite.length,
    p50DecisionMs: percentile(effectiveLatencies, 0.5),
    p95DecisionMs: percentile(effectiveLatencies, 0.95),
    averageDecisionMs: average(effectiveLatencies),
    perPromptMs,
    throughputPerSecond: rows.length / Math.max(0.001, elapsedMs / 1000),
    labeled: labeled.length,
    accuracy: labeled.length ? labeled.filter((row) => row.matched).length / labeled.length : undefined,
    backends: countBy(rows.map((row) => row.backend)),
    batchModes: countBy(rows.map((row) => row.batchMode)),
    averageBatchSize: average(rows.map((row) => row.batchSize)),
    intents: countBy(rows.map((row) => row.actualIntent)),
    lanes: countBy(rows.map((row) => row.lane).filter((lane) => lane !== undefined)),
    laneCount: uniqueValues(rows.map((row) => row.lane).filter((lane) => lane !== undefined)).length,
    devices: countBy(rows.map((row) => row.device).filter((device) => device !== undefined)),
    deviceCount: uniqueValues(rows.map((row) => row.device).filter((device) => device !== undefined)).length,
    deviceProfiles,
    deviceProfileCount: deviceProfiles.length,
    hardwareProbeProfileCount: deviceProfiles.filter(isHardwareProbeProfile).length
  };
  const checks = classifierBenchmarkChecks(aggregate, thresholds);
  return {
    status: checks.every((check) => check.pass) ? 'pass' : 'fail',
    mode: classifierMode(classifier),
    runs: repeat,
    count: rows.length,
    elapsedMs,
    warmup: warmupReport,
    aggregate,
    thresholds: normalizeThresholds(thresholds),
    checks,
    rows
  };
}

async function warmClassifier(classifier) {
  if (!classifier?.url) {
    return {
      status: 'skip',
      mode: classifierMode(classifier),
      elapsedMs: 0,
      count: 0,
      backend: classifierMode(classifier),
      message: 'Warmup requires an HTTP classifier sidecar.'
    };
  }
  return classifierWarmupReport(classifier);
}

function failedWarmupReport({ classifier, repeat, suite, thresholds, warmupReport }) {
  return {
    status: 'fail',
    mode: classifierMode(classifier),
    runs: repeat,
    count: 0,
    elapsedMs: finite(warmupReport.elapsedMs),
    warmup: warmupReport,
    aggregate: emptyAggregate(suite.length),
    thresholds: normalizeThresholds(thresholds),
    checks: [],
    rows: [],
    message: warmupReport.message
  };
}

function emptyAggregate(samples) {
  return {
    count: 0,
    samples,
    p50DecisionMs: 0,
    p95DecisionMs: 0,
    averageDecisionMs: 0,
    perPromptMs: 0,
    throughputPerSecond: 0,
    labeled: 0,
    accuracy: undefined,
    backends: {},
    batchModes: {},
    averageBatchSize: 0,
    intents: {},
    lanes: {},
    laneCount: 0,
    devices: {},
    deviceCount: 0,
    deviceProfiles: [],
    deviceProfileCount: 0,
    hardwareProbeProfileCount: 0
  };
}

async function classifyMany(classifier, prompts) {
  if (typeof classifier?.classifyMany === 'function') return classifier.classifyMany(prompts);
  if (typeof classifier?.classifyAsync === 'function') return Promise.all(prompts.map((prompt) => classifier.classifyAsync(prompt)));
  if (typeof classifier?.classify === 'function') return prompts.map((prompt) => classifier.classify(prompt));
  throw new Error('No classifier implementation is available.');
}

function normalizeSamples(samples) {
  return (Array.isArray(samples) ? samples : []).map((sample, index) => {
    return {
      id: String(sample.id ?? `sample-${index + 1}`),
      intent: sample.intent ? String(sample.intent) : undefined,
      prompt: String(sample.prompt ?? '')
    };
  }).filter((sample) => sample.prompt.length > 0);
}

function classifierMode(classifier) {
  if (classifier?.url) return 'sidecar';
  if (classifier?.command) return 'command';
  return 'builtin';
}

function classifierBenchmarkChecks(aggregate, thresholds) {
  const resolved = normalizeThresholds(thresholds);
  const checks = [];
  if (resolved.maxP95Ms !== undefined) checks.push(gateCheck({ id: 'classifier_p95', label: 'classifier p95', value: aggregate.p95DecisionMs, target: resolved.maxP95Ms, direction: 'max', unit: 'ms' }));
  if (resolved.minAccuracy !== undefined) checks.push(gateCheck({ id: 'accuracy', label: 'intent accuracy', value: aggregate.accuracy ?? 0, target: resolved.minAccuracy, direction: 'min', unit: 'ratio' }));
  if (resolved.minThroughput !== undefined) checks.push(gateCheck({ id: 'throughput', label: 'throughput', value: aggregate.throughputPerSecond, target: resolved.minThroughput, direction: 'min', unit: 'per_second' }));
  if (resolved.minDevices !== undefined) checks.push(gateCheck({ id: 'devices', label: 'devices', value: aggregate.deviceCount, target: resolved.minDevices, direction: 'min', unit: 'count' }));
  if (resolved.minLanes !== undefined) checks.push(gateCheck({ id: 'lanes', label: 'lanes', value: aggregate.laneCount, target: resolved.minLanes, direction: 'min', unit: 'count' }));
  if (resolved.requireDeviceProfiles) checks.push(gateCheck({ id: 'device_profiles', label: 'device profiles', value: aggregate.deviceProfileCount, target: Math.max(1, aggregate.deviceCount), direction: 'min', unit: 'count' }));
  if (resolved.requireHardwareProbe) checks.push(gateCheck({ id: 'hardware_probe', label: 'hardware probe', value: aggregate.hardwareProbeProfileCount, target: Math.max(1, aggregate.deviceCount), direction: 'min', unit: 'count' }));
  return checks;
}

function normalizeThresholds(thresholds) {
  return {
    maxP95Ms: nonNegative(thresholds.maxP95Ms),
    minAccuracy: nonNegative(thresholds.minAccuracy),
    minThroughput: nonNegative(thresholds.minThroughput),
    minDevices: nonNegative(thresholds.minDevices),
    minLanes: nonNegative(thresholds.minLanes),
    requireDeviceProfiles: Boolean(thresholds.requireDeviceProfiles),
    requireHardwareProbe: Boolean(thresholds.requireHardwareProbe)
  };
}

function gateCheck({ id, label, value, target, direction, unit }) {
  return {
    id,
    label,
    value,
    target,
    direction,
    unit,
    pass: direction === 'max' ? value <= target : value >= target
  };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positive(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value)))];
}

function normalizeDeviceProfile(value) {
  if (!value || typeof value !== 'object') return undefined;
  const profile = {};
  if (value.id !== undefined) profile.id = String(value.id);
  if (value.name !== undefined && String(value.name).trim()) profile.name = String(value.name).trim();
  const memoryMb = finite(value.memoryMb);
  if (memoryMb > 0) profile.memoryMb = memoryMb;
  if (value.runtime !== undefined && String(value.runtime).trim()) profile.runtime = String(value.runtime).trim();
  if (value.driver !== undefined && String(value.driver).trim()) profile.driver = String(value.driver).trim();
  if (value.source !== undefined && String(value.source).trim()) profile.source = String(value.source).trim();
  return Object.keys(profile).length > 0 ? profile : undefined;
}

function uniqueDeviceProfiles(rows) {
  const profiles = new Map();
  rows.forEach((row) => {
    if (!row.deviceProfile) return;
    const key = row.deviceProfile.id ?? row.device ?? profiles.size;
    profiles.set(String(key), row.deviceProfile);
  });
  return [...profiles.values()];
}

function isHardwareProbeProfile(profile) {
  return String(profile?.source ?? '').toLowerCase() === 'nvidia-smi';
}
