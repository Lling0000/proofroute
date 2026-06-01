import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { relative as relativePath, resolve } from 'node:path';

const ARTIFACT_ENV = Object.freeze([
  'PROOFROUTE_ACCELERATOR_MODEL',
  'PROOFROUTE_ONNX_MODEL',
  'PROOFROUTE_TENSORRT_ENGINE'
]);

const CONFIG_ENV = Object.freeze([
  'PROOFROUTE_CLASSIFIER_BACKEND',
  'PROOFROUTE_ACCELERATOR_BACKEND',
  'PROOFROUTE_ACCELERATOR_DEVICES',
  'PROOFROUTE_ACCELERATOR_SCHEDULER',
  'PROOFROUTE_ACCELERATOR_MODULE',
  'PROOFROUTE_ACCELERATOR_MODEL',
  'PROOFROUTE_ONNX_RUNTIME_PACKAGE',
  'PROOFROUTE_ONNX_MODEL',
  'PROOFROUTE_ONNX_EXECUTION_PROVIDERS',
  'PROOFROUTE_TENSORRT_RUNTIME_PACKAGE',
  'PROOFROUTE_TENSORRT_ENGINE',
  'PROOFROUTE_TENSORRT_PRECISION',
  'PROOFROUTE_TENSORRT_MAX_BATCH_SIZE',
  'PROOFROUTE_GPU_DEVICES',
  'PROOFROUTE_GPU_LANES',
  'PROOFROUTE_GPU_SCHEDULER',
  'PROOFROUTE_GPU_RUNTIME',
  'PROOFROUTE_GPU_DRIVER'
]);

export async function classifierEvidenceReport({ report, classifier = {}, env = process.env, cwd = process.cwd(), argv = [] } = {}) {
  const aggregate = report.aggregate ?? {};
  const gates = Array.isArray(report.checks) ? report.checks.map((check) => ({
    id: check.id,
    label: check.label,
    pass: Boolean(check.pass),
    value: check.value,
    target: check.target,
    direction: check.direction,
    unit: check.unit
  })) : [];
  return {
    kind: 'proofroute-classifier-evidence-v1',
    generatedAt: new Date().toISOString(),
    command: sanitizeArgv(argv),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch
    },
    classifier: {
      mode: report.mode ?? 'unknown',
      status: report.status ?? 'unknown',
      url: redactUrl(classifier.url),
      timeoutMs: classifier.timeoutMs,
      warmup: report.warmup?.status
    },
    benchmark: {
      count: report.count ?? aggregate.count ?? 0,
      runs: report.runs ?? 0,
      p95DecisionMs: aggregate.p95DecisionMs ?? 0,
      throughputPerSecond: aggregate.throughputPerSecond ?? 0,
      accuracy: aggregate.accuracy,
      deviceCount: aggregate.deviceCount ?? 0,
      laneCount: aggregate.laneCount ?? 0,
      deviceProfileCount: aggregate.deviceProfileCount ?? 0,
      hardwareProbeProfileCount: aggregate.hardwareProbeProfileCount ?? 0,
      averageBatchSize: aggregate.averageBatchSize ?? 0
    },
    gates,
    deviceProfiles: Array.isArray(aggregate.deviceProfiles) ? aggregate.deviceProfiles : [],
    configuration: selectedEnv(env),
    artifacts: await artifactEvidence({ env, cwd })
  };
}

export async function verifyClassifierEvidenceFile(path, { cwd = process.cwd(), allowArtifactOnly = false, requireDeviceProfiles = false, requireHardwareProbe = false, maxAgeMs, now, requireGeneratedAt } = {}) {
  const absolute = resolve(cwd, path);
  const report = JSON.parse(await readFile(absolute, 'utf8'));
  return verifyClassifierEvidence(report, {
    cwd,
    path: displayPath(cwd, absolute),
    allowArtifactOnly,
    requireDeviceProfiles,
    requireHardwareProbe,
    maxAgeMs,
    now,
    requireGeneratedAt
  });
}

export function classifierEvidenceVerificationFailure(path, error, { cwd = process.cwd(), now } = {}) {
  const absolute = resolve(cwd, path);
  const message = evidenceFileErrorMessage(path, error);
  const checks = [
    evidenceCheck('evidence_file', false, message)
  ];
  return {
    kind: 'proofroute-classifier-evidence-verify-v1',
    status: 'fail',
    path: displayPath(cwd, absolute),
    generatedAt: timestampIso(now),
    evidenceKind: undefined,
    checks,
    failedChecks: checks,
    artifacts: []
  };
}

export async function verifyClassifierEvidence(report, { cwd = process.cwd(), path, allowArtifactOnly = false, requireDeviceProfiles = false, requireHardwareProbe = false, maxAgeMs, now, requireGeneratedAt } = {}) {
  const evidence = report?.evidence ?? report;
  const checks = [];
  checks.push(evidenceCheck('schema', evidence?.kind === 'proofroute-classifier-evidence-v1', 'evidence bundle kind is proofroute-classifier-evidence-v1'));
  checks.push(evidenceCheck('benchmark_status', (report?.status ?? evidence?.classifier?.status) === 'pass', 'recorded classifier benchmark status is pass'));
  const gates = Array.isArray(evidence?.gates) ? evidence.gates : [];
  checks.push(evidenceCheck('gates', gates.length > 0 && gates.every((gate) => gate.pass), `${gates.filter((gate) => gate.pass).length}/${gates.length} recorded gates pass`));
  const expectedProfiles = Number(evidence?.benchmark?.deviceProfileCount ?? 0);
  const profiles = Array.isArray(evidence?.deviceProfiles) ? evidence.deviceProfiles : [];
  const profileGate = gates.find((gate) => gate.id === 'device_profiles');
  if (!allowArtifactOnly || requireDeviceProfiles || requireHardwareProbe || profileGate || expectedProfiles > 0) {
    checks.push(evidenceCheck('device_profiles', expectedProfiles > 0 && profiles.length >= expectedProfiles, `${profiles.length}/${expectedProfiles} recorded device profiles are present`));
  }
  const hardwareGate = gates.find((gate) => gate.id === 'hardware_probe');
  if (hardwareGate) {
    const hardwareProfiles = profiles.filter((profile) => String(profile?.source ?? '').toLowerCase() === 'nvidia-smi');
    checks.push(evidenceCheck('hardware_probe', hardwareGate.pass && hardwareProfiles.length >= Number(hardwareGate.target ?? 0), `${hardwareProfiles.length}/${hardwareGate.target} recorded device profiles came from nvidia-smi`));
  } else if (requireHardwareProbe) {
    checks.push(evidenceCheck('hardware_probe', false, 'strict verification requires a recorded hardware_probe gate from --require-hardware-probe'));
  }
  const freshness = evidenceFreshness(evidence, report, { maxAgeMs, now, requireGeneratedAt });
  if (freshness.check) checks.push(freshness.check);
  checks.push(evidenceCheck('prompt_free', !containsPromptText(report), 'evidence file does not contain prompt, message, completion, or content keys'));
  checks.push(...await verifyArtifacts(evidence?.artifacts, cwd));
  const status = checks.every((check) => check.pass) ? 'pass' : 'fail';
  return {
    kind: 'proofroute-classifier-evidence-verify-v1',
    status,
    path,
    generatedAt: new Date().toISOString(),
    evidenceGeneratedAt: freshness.generatedAt,
    evidenceAgeMs: freshness.ageMs,
    maxEvidenceAgeMs: freshness.maxAgeMs,
    evidenceKind: evidence?.kind,
    benchmark: evidence?.benchmark,
    checks,
    failedChecks: checks.filter((check) => !check.pass),
    artifacts: evidence?.artifacts ?? []
  };
}

async function artifactEvidence({ env, cwd }) {
  const rows = [];
  for (const name of ARTIFACT_ENV) {
    const value = nonEmpty(env[name]);
    if (!value) continue;
    const absolute = resolve(cwd, value);
    const path = displayPath(cwd, absolute);
    try {
      const bytes = await readFile(absolute);
      rows.push({
        env: name,
        path,
        status: 'hashed',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      });
    } catch (error) {
      rows.push({
        env: name,
        path,
        status: 'missing',
        message: error.code === 'ENOENT' ? 'not found' : error.message
      });
    }
  }
  return rows;
}

async function verifyArtifacts(artifacts, cwd) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return [evidenceCheck('artifact_presence', false, 'at least one local classifier artifact hash is recorded')];
  }
  const checks = [evidenceCheck('artifact_presence', artifacts.some((artifact) => artifact.status === 'hashed'), 'at least one local classifier artifact hash is recorded')];
  for (const artifact of artifacts) {
    const label = artifact.env ? `artifact ${artifact.env}` : `artifact ${artifact.path ?? 'unknown'}`;
    if (artifact.status !== 'hashed') {
      checks.push(evidenceCheck('artifact_hash', false, `${label} was not hashed in the evidence bundle`));
      continue;
    }
    try {
      const bytes = await readFile(resolve(cwd, artifact.path));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      checks.push(evidenceCheck('artifact_hash', sha256 === artifact.sha256, `${label} SHA-256 matches ${artifact.sha256}`));
      checks.push(evidenceCheck('artifact_size', bytes.length === artifact.bytes, `${label} byte size matches ${artifact.bytes}`));
    } catch (error) {
      checks.push(evidenceCheck('artifact_hash', false, `${label} cannot be read for verification: ${error.code === 'ENOENT' ? 'not found' : error.message}`));
    }
  }
  return checks;
}

function evidenceCheck(id, pass, message) {
  return {
    id,
    pass: Boolean(pass),
    message
  };
}

function evidenceFreshness(evidence, report, { maxAgeMs, now, requireGeneratedAt } = {}) {
  const generatedAt = evidence?.generatedAt ?? report?.generatedAt;
  const maxMs = positiveMilliseconds(maxAgeMs);
  const required = Boolean(requireGeneratedAt) || maxMs !== undefined;
  if (!generatedAt && !required) return {};
  if (!generatedAt) {
    return {
      generatedAt,
      maxAgeMs: maxMs,
      check: evidenceCheck('evidence_freshness', false, 'evidence generatedAt is required for the freshness gate')
    };
  }
  const generatedMs = Date.parse(generatedAt);
  const nowMs = timestampMs(now);
  if (!Number.isFinite(generatedMs)) {
    return {
      generatedAt,
      maxAgeMs: maxMs,
      check: evidenceCheck('evidence_freshness', false, `evidence generatedAt ${generatedAt} is not a valid timestamp`)
    };
  }
  const ageMs = nowMs - generatedMs;
  if (ageMs < 0) {
    return {
      generatedAt,
      ageMs,
      maxAgeMs: maxMs,
      check: evidenceCheck('evidence_freshness', false, `evidence generatedAt ${generatedAt} is in the future`)
    };
  }
  if (maxMs === undefined) {
    return {
      generatedAt,
      ageMs,
      check: required ? evidenceCheck('evidence_freshness', true, `evidence generatedAt ${generatedAt} is present`) : undefined
    };
  }
  return {
    generatedAt,
    ageMs,
    maxAgeMs: maxMs,
    check: evidenceCheck('evidence_freshness', ageMs <= maxMs, `evidence age ${hours(ageMs)}h is within ${hours(maxMs)}h`)
  };
}

function positiveMilliseconds(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function timestampMs(value) {
  if (value === undefined || value === null) return Date.now();
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function hours(ms) {
  return (Number(ms ?? 0) / 3600000).toFixed(2);
}

function timestampIso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function evidenceFileErrorMessage(path, error) {
  if (error?.code === 'ENOENT') return `${path} was not found`;
  if (error instanceof SyntaxError) return `${path} is not valid classifier evidence JSON`;
  return error?.message ?? `${path} could not be verified`;
}

function containsPromptText(value) {
  return containsSensitiveKey(value, new Set(['prompt', 'prompts', 'message', 'messages', 'completion', 'completions', 'content']));
}

function containsSensitiveKey(value, names) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveKey(entry, names));
  return Object.entries(value).some(([key, entry]) => names.has(key) || containsSensitiveKey(entry, names));
}

function selectedEnv(env) {
  return Object.fromEntries(CONFIG_ENV
    .map((name) => [name, nonEmpty(env[name])])
    .filter(([, value]) => value !== undefined));
}

function sanitizeArgv(argv) {
  const output = [];
  let redactNext = false;
  for (const token of argv.map(String)) {
    if (redactNext) {
      output.push('<redacted>');
      redactNext = false;
      continue;
    }
    const [key, inlineValue] = token.split('=', 2);
    if (/key|token|secret|password/i.test(key)) {
      if (inlineValue !== undefined) output.push(`${key}=<redacted>`);
      else {
        output.push(token);
        redactNext = true;
      }
      continue;
    }
    output.push(token);
  }
  return output;
}

function redactUrl(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    return url.toString();
  } catch {
    return String(value).replace(/:\/\/[^@/]+@/, '://<redacted>@').replace(/\?.*$/, '');
  }
}

function displayPath(cwd, absolute) {
  const relative = relativePath(cwd, absolute);
  if (!relative || relative.startsWith('..')) return absolute;
  return relative;
}

function nonEmpty(value) {
  const text = String(value ?? '').trim();
  return text ? text : undefined;
}
