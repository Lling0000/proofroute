import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
import { telemetryPath } from './telemetry.js';

export async function doctorReport({ config, controller, classifier, telemetryOverride, requireClassifierWarmup = false, minClassifierDevices, minClassifierLanes, requireClassifierHardwareProbe = false } = {}) {
  const executableModels = controller.executableModels();
  const telemetry = telemetryPath(config, telemetryOverride);
  const classifierRequirements = normalizeClassifierRequirements({
    requireWarmup: requireClassifierWarmup,
    minDevices: minClassifierDevices,
    minLanes: minClassifierLanes,
    requireHardwareProbe: requireClassifierHardwareProbe
  });
  const checks = [
    checkNodeVersion(),
    checkModels(config.models ?? []),
    checkExecutableModels(executableModels),
    checkProviders(config, executableModels),
    await checkProviderHealth(config, executableModels),
    await checkTelemetry(telemetry),
    await checkClassifier(classifier, classifierRequirements),
    checkPolicies(config)
  ];
  const providerHealth = checks.find((check) => check.id === 'upstream')?.metadata;
  const status = checks.some((check) => check.status === 'fail') ? 'fail' : checks.some((check) => check.status === 'warn') ? 'warn' : 'pass';
  return {
    status,
    checks,
    summary: {
      node: process.versions.node,
      models: (config.models ?? []).length,
      executableModels: executableModels.length,
      providers: [...new Set(executableModels.map((model) => model.provider))].sort(),
      providerHealth,
      telemetry,
      classifier: classifier?.url ? 'external-url' : classifier?.command ? 'external' : 'builtin',
      classifierHardware: checks.find((check) => check.id === 'classifier')?.metadata
    }
  };
}

export async function classifierMetricsReport({ classifier, warmup = false } = {}) {
  const mode = classifier?.url ? 'sidecar' : classifier?.command ? 'command' : 'builtin';
  if (!classifier?.url) {
    return {
      status: 'warn',
      mode,
      message: mode === 'command' ? 'Command classifier is configured; wrap it with proofroute-classifier to expose lane metrics.' : 'Built-in classifier is active; no HTTP sidecar metrics are available.'
    };
  }
  const url = classifierMetricsUrl(classifier.url);
  const timeoutMs = Math.max(25, Number(classifier.timeoutMs ?? 12) * 4);
  const warmupReport = warmup ? await classifierWarmupReport(classifier, timeoutMs) : undefined;
  if (warmupReport?.status === 'fail') {
    return {
      status: 'fail',
      mode,
      url,
      warmup: warmupReport,
      message: warmupReport.message
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { signal: controller.signal });
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
    if (!response.ok) {
      return {
        status: 'fail',
        mode,
        url,
        elapsedMs,
        message: `Metrics ${response.status} at ${url}.`
      };
    }
    return {
      status: 'pass',
      mode,
      url,
      elapsedMs,
      warmup: warmupReport,
      metrics: normalizeClassifierMetrics(payload)
    };
  } catch {
    return {
      status: 'fail',
      mode,
      url,
      elapsedMs: Math.max(0, performance.now() - startedAt),
      message: `${url} did not answer within ${timeoutMs}ms.`
    };
  } finally {
    clearTimeout(timeout);
  }
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    id: 'node',
    status: major >= 20 ? 'pass' : 'fail',
    label: `Node ${process.versions.node}`,
    detail: major >= 20 ? 'Runtime supports fetch, node:test, and modern ESM.' : 'Node 20 or newer is required.'
  };
}

function checkModels(models) {
  return {
    id: 'models',
    status: models.length > 0 ? 'pass' : 'fail',
    label: `${models.length} configured models`,
    detail: models.length > 0 ? 'The controller has a catalog to score.' : 'Add at least one model to the catalog.'
  };
}

function checkExecutableModels(models) {
  return {
    id: 'executable',
    status: models.length > 0 ? 'pass' : 'fail',
    label: `${models.length} executable models`,
    detail: models.length > 0 ? 'The proxy can route to at least one configured provider.' : 'Set OLLAMA_BASE_URL, OPENAI_API_KEY, ANTHROPIC_API_KEY, or provider credentials in JSON.'
  };
}

function checkProviders(config, executableModels) {
  const configured = Object.keys(config.providers ?? {});
  const executable = [...new Set(executableModels.map((model) => model.provider))];
  return {
    id: 'providers',
    status: executable.length > 0 ? 'pass' : configured.length > 0 ? 'warn' : 'fail',
    label: `${executable.length}/${configured.length} providers executable`,
    detail: executable.length > 0 ? `Executable providers: ${executable.join(', ')}.` : 'Provider entries exist but no model can execute with the current credentials.'
  };
}

async function checkProviderHealth(config, executableModels) {
  const providerNames = [...new Set(executableModels.map((model) => model.provider))];
  if (providerNames.length === 0) {
    return {
      id: 'upstream',
      status: 'warn',
      label: 'No upstream providers probed',
      detail: 'Provider health is skipped until at least one model is executable.',
      metadata: { total: 0, healthy: 0, skipped: 0 }
    };
  }
  const timeoutMs = Math.max(50, Number(config.router?.doctorProviderTimeoutMs ?? 450));
  const probes = await Promise.all(providerNames.map((name) => probeProvider({ name, provider: config.providers?.[name], models: executableModels.filter((model) => model.provider === name), timeoutMs })));
  const active = probes.filter((probe) => probe.status !== 'skipped');
  const healthy = active.filter((probe) => probe.status === 'pass');
  const requiredFailure = active.find((probe) => probe.status === 'fail');
  const status = requiredFailure ? 'fail' : active.length === 0 ? 'warn' : healthy.length === active.length ? 'pass' : 'warn';
  const detail = probes.map((probe) => {
    if (probe.status === 'skipped') return `${probe.name} skipped: ${probe.reason}`;
    return `${probe.name} ${probe.httpStatus ?? 'unreachable'} in ${probe.elapsedMs.toFixed(2)}ms at ${probe.url}`;
  }).join(' ');
  return {
    id: 'upstream',
    status,
    label: `${healthy.length}/${active.length} upstream probes healthy`,
    detail,
    metadata: {
      total: active.length,
      healthy: healthy.length,
      skipped: probes.filter((probe) => probe.status === 'skipped').length
    }
  };
}

async function probeProvider({ name, provider, models, timeoutMs }) {
  const url = providerProbeUrl(name, provider, models);
  if (!url) {
    return {
      name,
      status: 'skipped',
      reason: 'no health endpoint configured'
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(provider.healthTimeoutMs ?? timeoutMs));
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: provider.healthMethod ?? 'GET',
      headers: providerProbeHeaders(name, provider, models),
      signal: controller.signal
    });
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    const ok = response.ok;
    return {
      name,
      status: ok ? 'pass' : provider.healthRequired ? 'fail' : 'warn',
      httpStatus: response.status,
      elapsedMs,
      url
    };
  } catch {
    return {
      name,
      status: provider.healthRequired ? 'fail' : 'warn',
      elapsedMs: Math.max(0, performance.now() - startedAt),
      url
    };
  } finally {
    clearTimeout(timeout);
  }
}

function providerProbeUrl(name, provider, models) {
  if (!provider?.baseUrl || provider.healthPath === false || provider.healthUrl === false) return undefined;
  if (provider.healthUrl) return String(provider.healthUrl);
  const local = provider.kind === 'ollama' || models.some((model) => model.local);
  const path = provider.healthPath ?? (local ? '/api/tags' : '/models');
  return joinUrl(provider.baseUrl, path);
}

function providerProbeHeaders(name, provider, models) {
  if (provider.healthHeaders) return provider.healthHeaders;
  const local = provider.kind === 'ollama' || models.some((model) => model.local);
  if (local || !provider.apiKey) return {};
  if (name === 'anthropic') {
    return {
      'x-api-key': provider.apiKey,
      'anthropic-version': provider.version ?? '2023-06-01'
    };
  }
  return {
    authorization: `Bearer ${provider.apiKey}`
  };
}

function joinUrl(baseUrl, path) {
  if (/^https?:\/\//.test(String(path))) return String(path);
  return `${String(baseUrl).replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`;
}

async function checkTelemetry(path) {
  try {
    await mkdir(dirname(path), { recursive: true });
    await access(dirname(path), constants.W_OK);
    return {
      id: 'telemetry',
      status: 'pass',
      label: 'Telemetry writable',
      detail: path
    };
  } catch {
    return {
      id: 'telemetry',
      status: 'warn',
      label: 'Telemetry path is not writable',
      detail: path
    };
  }
}

async function checkClassifier(classifier, requirements = {}) {
  if (classifier?.url) {
    return checkClassifierSidecar(classifier, requirements);
  }
  if (hasClassifierRequirements(requirements)) {
    const active = classifier?.command ? 'a command classifier' : 'the built-in classifier';
    const hardware = hasHardwareRequirements(requirements);
    return {
      id: 'classifier',
      status: 'fail',
      label: hardware ? 'Classifier hardware required' : 'Classifier warmup required',
      detail: `A warmed HTTP classifier sidecar with ${requirementText(requirements)} is required, but the active classifier is ${active}. ${classifierRemediation(requirements)}`,
      metadata: classifierHardwareMetadata({ requirements })
    };
  }
  return {
    id: 'classifier',
    status: 'pass',
    label: classifier?.command ? 'External classifier configured' : 'Built-in classifier ready',
    detail: classifier?.command ? `Timeout ${classifier.timeoutMs}ms.` : 'Deterministic local classifier will run without provider calls.'
  };
}

async function checkClassifierSidecar(classifier, requirements = {}) {
  const healthUrl = classifierHealthUrl(classifier.url);
  const timeoutMs = Math.max(25, Number(classifier.timeoutMs ?? 12) * 4);
  const strict = hasClassifierRequirements(requirements);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(healthUrl, { signal: controller.signal });
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
    const ok = response.ok && payload.ok !== false;
    const warmed = Boolean(payload.warmed);
    const deviceCount = Array.isArray(payload.devices) ? payload.devices.length : 0;
    const laneCount = number(payload.lanes);
    const normalizedProfiles = normalizeDeviceProfiles(payload.deviceProfiles);
    const hardwareProbeProfileCount = normalizedProfiles.filter(isHardwareProbeProfile).length;
    const failures = ok ? classifierRequirementFailures({
      requirements,
      warmed,
      deviceCount,
      laneCount,
      hardwareProbeProfileCount
    }) : [];
    const status = ok && failures.length === 0 ? 'pass' : ok ? 'fail' : strict ? 'fail' : 'warn';
    const hardware = hasHardwareRequirements(requirements);
    const label = ok && failures.length === 0 ? 'External classifier sidecar healthy' : ok && !hardware ? 'External classifier sidecar cold' : ok ? 'External classifier hardware not ready' : 'External classifier sidecar unhealthy';
    const devices = Array.isArray(payload.devices) && payload.devices.length ? payload.devices.join(',') : 'none';
    const profiles = deviceProfilesDetail(payload.deviceProfiles);
    const blockers = failures.length ? ` Strict hardware blockers: ${failures.join(' ')}` : '';
    const remediation = failures.length ? ` ${classifierRemediation(requirements)}` : '';
    return {
      id: 'classifier',
      status,
      label,
      detail: ok ? `Health ${response.status} in ${elapsedMs.toFixed(2)}ms at ${healthUrl}; backend ${payload.backend ?? 'unknown'}; scheduler ${payload.scheduler ?? 'unknown'}; warmed ${warmed ? 'yes' : 'no'}; batch window ${payload.batchWindowMs ?? 'unknown'}ms; max batch ${payload.maxBatchSize ?? 'unknown'}; lanes ${payload.lanes ?? 'unknown'}; inflight ${payload.inflight ?? 'unknown'}; requests ${payload.requests ?? 'unknown'}; errors ${payload.errors ?? 'unknown'}; devices ${devices}; profiles ${profiles}; nvidia-smi profiles ${hardwareProbeProfileCount}.${blockers}${remediation}` : `Health ${response.status} in ${elapsedMs.toFixed(2)}ms at ${healthUrl}.`,
      metadata: classifierHardwareMetadata({
        requirements,
        warmed,
        deviceCount,
        laneCount,
        deviceProfileCount: normalizedProfiles.length,
        hardwareProbeProfileCount
      })
    };
  } catch (error) {
    return {
      id: 'classifier',
      status: strict ? 'fail' : 'warn',
      label: 'External classifier sidecar unavailable',
      detail: strict ? `${healthUrl} did not answer within ${timeoutMs}ms; strict hardware gate cannot pass until the sidecar is reachable with ${requirementText(requirements)}. ${classifierRemediation(requirements)}` : `${healthUrl} did not answer within ${timeoutMs}ms; router will fall back locally.`,
      metadata: classifierHardwareMetadata({ requirements })
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeClassifierRequirements({ requireWarmup = false, minDevices, minLanes, requireHardwareProbe = false } = {}) {
  return {
    requireWarmup: Boolean(requireWarmup),
    minDevices: nonNegative(minDevices),
    minLanes: nonNegative(minLanes),
    requireHardwareProbe: Boolean(requireHardwareProbe)
  };
}

function hasClassifierRequirements(requirements) {
  return Boolean(requirements?.requireWarmup || requirements?.minDevices !== undefined || requirements?.minLanes !== undefined || requirements?.requireHardwareProbe);
}

function hasHardwareRequirements(requirements) {
  return Boolean(requirements?.minDevices !== undefined || requirements?.minLanes !== undefined || requirements?.requireHardwareProbe);
}

function classifierRequirementFailures({ requirements, warmed, deviceCount, laneCount, hardwareProbeProfileCount }) {
  const failures = [];
  if (requirements.requireWarmup && !warmed) failures.push('warmup is required.');
  if (requirements.minDevices !== undefined && deviceCount < requirements.minDevices) failures.push(`devices ${deviceCount}/${requirements.minDevices}.`);
  if (requirements.minLanes !== undefined && laneCount < requirements.minLanes) failures.push(`lanes ${laneCount}/${requirements.minLanes}.`);
  if (requirements.requireHardwareProbe) {
    const target = Math.max(1, requirements.minDevices ?? deviceCount);
    if (hardwareProbeProfileCount < target) failures.push(`nvidia-smi hardware profiles ${hardwareProbeProfileCount}/${target}.`);
  }
  return failures;
}

function classifierHardwareMetadata({ requirements, warmed = false, deviceCount = 0, laneCount = 0, deviceProfileCount = 0, hardwareProbeProfileCount = 0 } = {}) {
  return {
    strict: hasClassifierRequirements(requirements),
    requirements,
    warmed,
    deviceCount,
    laneCount,
    deviceProfileCount,
    hardwareProbeProfileCount
  };
}

function requirementText(requirements) {
  const parts = [];
  if (requirements.requireWarmup) parts.push('warmup');
  if (requirements.minDevices !== undefined) parts.push(`${requirements.minDevices} devices`);
  if (requirements.minLanes !== undefined) parts.push(`${requirements.minLanes} lanes`);
  if (requirements.requireHardwareProbe) parts.push('nvidia-smi hardware profiles');
  return parts.length ? parts.join(', ') : 'classifier readiness';
}

function classifierRemediation(requirements) {
  if (hasHardwareRequirements(requirements)) {
    return 'Start proofroute-classifier as an HTTP sidecar, set PROOFROUTE_CLASSIFIER_URL, run warmup, then generate evidence with npm run classifier:hardware:evidence and verify it with npm run classifier:hardware:verify.';
  }
  return 'Start proofroute-classifier as an HTTP sidecar, set PROOFROUTE_CLASSIFIER_URL, then run proofroute classifier --warmup before starting the proxy.';
}

function classifierHealthUrl(url) {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/\/classify\/?$/, '/health') || '/health';
  if (!parsed.pathname.endsWith('/health')) parsed.pathname = '/health';
  parsed.search = '';
  return parsed.toString();
}

function classifierMetricsUrl(url) {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/\/classify(?:\/batch)?\/?$/, '/metrics') || '/metrics';
  if (!parsed.pathname.endsWith('/metrics')) parsed.pathname = '/metrics';
  parsed.search = '';
  return parsed.toString();
}

export async function classifierWarmupReport(classifier, timeoutMs = Math.max(25, Number(classifier?.timeoutMs ?? 12) * 4)) {
  const url = classifierWarmupUrl(classifier.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: '{}',
      signal: controller.signal
    });
    const elapsedMs = Math.max(0, performance.now() - startedAt);
    const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : {};
    if (!response.ok || payload.ok === false) {
      return {
        status: 'fail',
        url,
        elapsedMs,
        message: `Warmup ${response.status} at ${url}.`
      };
    }
    return {
      status: 'pass',
      url,
      elapsedMs,
      count: number(payload.count),
      backend: payload.backend ?? 'unknown',
      scheduler: payload.scheduler ?? 'unknown',
      batchWindowMs: number(payload.batchWindowMs),
      maxBatchSize: number(payload.maxBatchSize)
    };
  } catch {
    return {
      status: 'fail',
      url,
      elapsedMs: Math.max(0, performance.now() - startedAt),
      message: `${url} did not warm within ${timeoutMs}ms.`
    };
  } finally {
    clearTimeout(timeout);
  }
}

function classifierWarmupUrl(url) {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/\/classify(?:\/batch)?\/?$/, '/warmup') || '/warmup';
  if (!parsed.pathname.endsWith('/warmup')) parsed.pathname = '/warmup';
  parsed.search = '';
  return parsed.toString();
}

function normalizeClassifierMetrics(payload) {
  const lanes = Number(payload.lanes ?? 0);
  const laneMetrics = Array.isArray(payload.laneMetrics) ? payload.laneMetrics : [];
  return {
    backend: payload.backend ?? 'unknown',
    scheduler: payload.scheduler ?? 'unknown',
    batchWindowMs: number(payload.batchWindowMs),
    maxBatchSize: number(payload.maxBatchSize),
    pendingBatch: number(payload.pendingBatch),
    batches: number(payload.batches),
    microBatches: number(payload.microBatches),
    averageBatchSize: number(payload.averageBatchSize),
    maxObservedBatchSize: number(payload.maxObservedBatchSize),
    warmed: Boolean(payload.warmed),
    warmups: number(payload.warmups),
    warmupRequests: number(payload.warmupRequests),
    lastWarmupMs: number(payload.lastWarmupMs),
    lanes,
    devices: Array.isArray(payload.devices) ? payload.devices : [],
    deviceProfiles: normalizeDeviceProfiles(payload.deviceProfiles),
    requests: number(payload.requests),
    errors: number(payload.errors),
    inflight: number(payload.inflight),
    uptimeMs: number(payload.uptimeMs),
    laneMetrics: laneMetrics.map((entry, index) => ({
      lane: number(entry.lane, index),
      device: entry.device,
      deviceProfile: normalizeDeviceProfile(entry.deviceProfile),
      requests: number(entry.requests),
      errors: number(entry.errors),
      inflight: number(entry.inflight),
      peakInflight: number(entry.peakInflight),
      averageDecisionMs: number(entry.averageDecisionMs),
      maxDecisionMs: number(entry.maxDecisionMs)
    }))
  };
}

function normalizeDeviceProfiles(value) {
  return Array.isArray(value) ? value.map(normalizeDeviceProfile).filter(Boolean) : [];
}

function normalizeDeviceProfile(value) {
  if (!value || typeof value !== 'object') return undefined;
  const profile = {};
  if (value.id !== undefined) profile.id = String(value.id);
  if (value.name !== undefined && String(value.name).trim()) profile.name = String(value.name).trim();
  const memoryMb = number(value.memoryMb, Number.NaN);
  if (Number.isFinite(memoryMb)) profile.memoryMb = memoryMb;
  if (value.runtime !== undefined && String(value.runtime).trim()) profile.runtime = String(value.runtime).trim();
  if (value.driver !== undefined && String(value.driver).trim()) profile.driver = String(value.driver).trim();
  if (value.source !== undefined && String(value.source).trim()) profile.source = String(value.source).trim();
  return Object.keys(profile).length > 0 ? profile : undefined;
}

function deviceProfilesDetail(value) {
  const profiles = normalizeDeviceProfiles(value);
  if (profiles.length === 0) return 'none';
  return profiles.map((profile) => {
    const parts = [profile.id ?? 'unknown'];
    if (profile.name) parts.push(profile.name);
    if (profile.memoryMb !== undefined) parts.push(`${profile.memoryMb}MB`);
    if (profile.runtime) parts.push(profile.runtime);
    if (profile.driver) parts.push(`driver ${profile.driver}`);
    if (profile.source) parts.push(`source ${profile.source}`);
    return parts.join(' ');
  }).join(', ');
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isHardwareProbeProfile(profile) {
  return String(profile?.source ?? '').toLowerCase() === 'nvidia-smi';
}

function checkPolicies(config) {
  const policy = config.router?.policy ?? 'balanced';
  return {
    id: 'policy',
    status: 'pass',
    label: `Routing policy ${policy}`,
    detail: 'Policy weights are applied before stable Softmax ranking.'
  };
}
