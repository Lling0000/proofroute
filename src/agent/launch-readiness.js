import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyClassifierEvidenceFile } from './classifier-evidence.js';
import { privacyReport } from './privacy.js';
import { githubRepositoryStateReport, publicRepositoryFaceReport, repositoryProfileReport } from './repository-profile.js';
import { runSmokeTest } from './smoke.js';

const defaultAssets = Object.freeze([
  'docs/proofroute-terminal.svg',
  'docs/proofroute-classifier.svg',
  'docs/proofroute-classifier-benchmark.svg'
]);

const assetExpectations = Object.freeze({
  'docs/proofroute-terminal.svg': Object.freeze({
    title: 'ProofRoute shareable routing proof',
    terms: ['ProofRoute', 'zero-network launch proof', 'prompt-free proof', 'provider calls 0', 'local routes', 'cloud routes', '2/5', '3/5', 'balanced:3, save:2', 'llama3.2:3b:2', 'saved', 'speed lift', 'p95 router']
  }),
  'docs/proofroute-classifier.svg': Object.freeze({
    title: 'ProofRoute classifier accelerator proof',
    terms: ['ProofRoute Classifier', 'prompt-free accelerator receipt', 'HTTP sidecar', 'hardware claim none']
  }),
  'docs/proofroute-classifier-benchmark.svg': Object.freeze({
    title: 'ProofRoute classifier benchmark proof',
    terms: ['ProofRoute Classifier', 'sidecar benchmark receipt', 'p95 decision', 'throughput', 'accuracy', 'hardware claim none']
  })
});

const promptLeakPattern = /Refactor this webhook|Extract customer ids|Rewrite this README|secret production prompt|sk-secret|\x1b\[/i;
const unprovenHardwarePattern = /local hardware proof|RTX\s?\d|A6000|CUDA\s?\d|driver\s?\d|nvidia-smi\s+[1-9]|hardware probe profiles\s+[1-9]/i;

const repositoryFaceAnchorTopics = Object.freeze([
  'llm-router',
  'openai-compatible',
  'transparent-proxy',
  'local-llm',
  'prompt-privacy',
  'coding-agent',
  'gpu-classifier',
  'tensorrt',
  'openai-proxy',
  'cost-optimization',
  'vibe-coding'
]);

export async function launchReadinessReport({ controller, runtime, telemetryPath, evidencePath = 'classifier-evidence.json', requireEvidence = false, evidenceMode, maxEvidenceAgeMs, artifactEvidencePath, requireArtifactEvidence = false, artifactMaxEvidenceAgeMs, now, smoke = true, github = false, githubRepo, githubToken, githubTokenEnv, githubFetch, githubEnv, publicFace = false, publicFetch, cwd = process.cwd() } = {}) {
  if (!controller || !runtime) throw new Error('launch readiness requires a controller and runtime.');
  const checks = [];
  const profile = await repositoryProfileReport();
  checks.push(profileCheck(profile));
  const githubReport = github ? await githubReadiness({ repo: githubRepo, token: githubToken, tokenEnv: githubTokenEnv, fetchImpl: githubFetch, env: githubEnv }) : undefined;
  if (githubReport) checks.push(githubCheck(githubReport));
  const publicReport = publicFace ? await publicReadiness({ fetchImpl: publicFetch }) : undefined;
  if (publicReport) checks.push(publicFaceCheck(publicReport));
  const proof = await runtime.prove({
    controller,
    thresholds: {
      maxP95Ms: 5,
      maxRouterOverheadPct: 1,
      minAccuracy: 0.8,
      minSavingsUsd: 0.001,
      minSpeedup: 1.1
    }
  });
  checks.push(proofCheck(proof));
  const smokeReport = smoke ? await runSmokeTest({ throughProxy: true }) : undefined;
  const smokeMatrixReport = smoke ? await runSmokeTest({ throughProxy: true, matrix: true }) : undefined;
  checks.push(smoke ? smokeCheck(smokeReport) : skippedCheck('proxy_smoke', 'proxy smoke', 'Proxy smoke was skipped by request.'));
  checks.push(smoke ? smokeMatrixCheck(smokeMatrixReport) : skippedCheck('proxy_matrix', 'proxy matrix', 'Proxy matrix smoke was skipped by request.'));
  const privacy = await privacyReport(telemetryPath);
  checks.push(privacyCheck(privacy));
  const assets = await assetReport(cwd, defaultAssets);
  checks.push(assetCheck(assets));
  const evidence = await classifierEvidenceReadiness({ cwd, evidencePath, required: requireEvidence, requireHardwareProbe: requireEvidence, evidenceMode, maxEvidenceAgeMs, now });
  checks.push(evidence.check);
  const resolvedArtifactEvidencePath = requireArtifactEvidence || artifactEvidencePath !== undefined ? artifactEvidencePath ?? 'classifier-linear-evidence.json' : undefined;
  const artifactEvidence = resolvedArtifactEvidencePath === undefined ? undefined : await classifierEvidenceReadiness({
    cwd,
    evidencePath: resolvedArtifactEvidencePath,
    required: requireArtifactEvidence,
    allowArtifactOnly: true,
    evidenceMode: 'artifact',
    maxEvidenceAgeMs: artifactMaxEvidenceAgeMs,
    now,
    checkId: 'classifier_artifact_evidence',
    label: 'local artifact evidence'
  });
  if (artifactEvidence) checks.push(artifactEvidence.check);
  return {
    kind: 'proofroute-launch-readiness-v1',
    generatedAt: new Date().toISOString(),
    status: readinessStatus(checks),
    checks,
    profile: {
      githubDescription: profile.github.description,
      topicCount: profile.github.topics.length,
      npmDescription: profile.npm.description,
      keywordCount: profile.npm.keywords.length,
      privacy: profile.privacy
    },
    github: githubReport,
    public: publicReport,
    proof: {
      status: proof.status,
      aggregate: proof.aggregate,
      checks: proof.checks
    },
    smoke: smokeReport ? {
      status: smokeReport.status,
      mode: smokeReport.mode,
      routerDecisionMs: smokeReport.routerDecisionMs,
      model: smokeReport.response.headers?.model,
      requestedModel: smokeReport.response.headers?.requestedModel,
      modelSwap: smokeReport.response.headers?.modelSwap,
      routerOverheadPct: Number(smokeReport.response.headers?.routerOverheadPct ?? 0),
      usageSource: smokeReport.response.headers?.usageSource,
      browserProofHeaders: smokeReport.cors?.exposeHeaders?.includes('x-proofroute-model') ?? false
    } : undefined,
    smokeMatrix: smokeMatrixReport ? {
      status: smokeMatrixReport.status,
      mode: smokeMatrixReport.mode,
      count: smokeMatrixReport.aggregate.count,
      passed: smokeMatrixReport.aggregate.passed,
      modelSwaps: smokeMatrixReport.aggregate.modelSwaps,
      p95RouterMs: smokeMatrixReport.aggregate.p95RouterMs,
      averageSpeedup: smokeMatrixReport.aggregate.averageSpeedup,
      savingsUsd: smokeMatrixReport.aggregate.savingsUsd,
      proofs: smokeMatrixReport.aggregate.proofs,
      intents: smokeMatrixReport.aggregate.intents,
      models: smokeMatrixReport.aggregate.models,
      promptFreeLedger: smokeMatrixReport.ledger.promptFree,
      privacyStatus: smokeMatrixReport.ledger.privacy.status,
      forbiddenMatchCount: smokeMatrixReport.ledger.privacy.forbiddenMatchCount,
      parseErrorCount: smokeMatrixReport.ledger.privacy.parseErrorCount,
      browserProofHeaders: smokeMatrixReport.cors?.exposeHeaders?.includes('x-proofroute-model') ?? false
    } : undefined,
    privacy: {
      status: privacy.status,
      path: privacy.path,
      events: privacy.events,
      forbiddenMatchCount: privacy.forbiddenMatchCount,
      parseErrorCount: privacy.parseErrorCount,
      exists: privacy.exists
    },
    assets,
    evidence: evidence.report,
    artifactEvidence: artifactEvidence?.report
  };
}

function profileCheck(profile) {
  const hasTopics = profile.github.topics.length === 20;
  const hasAnchorTopics = repositoryFaceAnchorTopics.every((topic) => profile.github.topics.includes(topic));
  const hasPrivacy = /prompt-free privacy|prompt-free/i.test(profile.github.description) && /prompt-free privacy|prompt-free/i.test(profile.npm.description);
  const hasProxyPositioning = /OpenAI-compatible/i.test(profile.github.description) && /router\/proxy|router and proxy/i.test(profile.npm.description);
  const hasLaunchReadiness = Boolean(profile.commands.launchReadiness);
  const hasCoreLaunch = Boolean(profile.commands.coreLaunch);
  const hasHardwareGate = Boolean(profile.commands.hardwareProbeGate);
  const pass = hasTopics && hasAnchorTopics && hasPrivacy && hasProxyPositioning && hasLaunchReadiness && hasCoreLaunch && hasHardwareGate;
  return {
    id: 'repository_face',
    label: 'repository face',
    status: pass ? 'pass' : 'fail',
    detail: `${profile.github.topics.length}/20 topics, anchor tags ${hasAnchorTopics ? 'present' : 'missing'}, proxy copy ${hasProxyPositioning ? 'present' : 'missing'}, privacy copy ${hasPrivacy ? 'present' : 'missing'}, core launch ${hasCoreLaunch ? 'present' : 'missing'}, launch command ${hasLaunchReadiness ? 'present' : 'missing'}, hardware gate ${hasHardwareGate ? 'present' : 'missing'}.`
  };
}

function proofCheck(proof) {
  const passed = proof.status === 'pass';
  return {
    id: 'zero_network_proof',
    label: 'zero-network proof',
    status: passed ? 'pass' : 'fail',
    detail: `${proof.aggregate.count} prompts, p95 ${proof.aggregate.p95RouterMs.toFixed(2)}ms, overhead ${proof.aggregate.p95RouterOverheadPct.toFixed(2)}%, saved ${money(proof.aggregate.savingsUsd)}, speed ${proof.aggregate.averageSpeedup.toFixed(2)}x.`
  };
}

async function githubReadiness({ repo, token, tokenEnv, fetchImpl, env }) {
  try {
    return await githubRepositoryStateReport({ mode: 'check', repo, token, tokenEnv, fetchImpl, env });
  } catch (error) {
    return {
      kind: 'proofroute-github-repository-face-v1',
      mode: 'check',
      status: 'fail',
      message: error.message
    };
  }
}

function githubCheck(report) {
  const topicCheck = report.comparison?.checks?.find((check) => check.id === 'topics');
  return {
    id: 'github_repository_face',
    label: 'github face',
    status: report.status === 'pass' ? 'pass' : 'fail',
    detail: report.status === 'pass'
      ? `${report.repository} matches local description, homepage, and ${topicCheck?.current?.length ?? 0} topics.`
      : `GitHub repository face drift or check failure: ${report.message ?? `${report.comparison?.missingTopics?.length ?? 0} missing topics, ${report.comparison?.extraTopics?.length ?? 0} extra topics`}.`
  };
}

async function publicReadiness({ fetchImpl }) {
  try {
    return await publicRepositoryFaceReport({ fetchImpl });
  } catch (error) {
    return {
      kind: 'proofroute-public-repository-face-v1',
      status: 'fail',
      message: error.message,
      checks: []
    };
  }
}

function publicFaceCheck(report) {
  const checks = report.checks ?? [];
  const requiredFailed = checks.filter((check) => check.severity !== 'advisory' && !check.pass).length;
  const advisoryFailed = checks.filter((check) => check.severity === 'advisory' && !check.pass).length;
  return {
    id: 'public_repository_face',
    label: 'public face',
    status: report.status === 'pass' ? 'pass' : 'fail',
    detail: report.status === 'pass'
      ? `${report.repository} and npm package ${report.npmPackage} are publicly visible; ${advisoryFailed} advisory checks failed.`
      : `Public repository face is not launchable: ${requiredFailed} required checks failed, ${advisoryFailed} advisory checks failed.`
  };
}

function smokeCheck(report) {
  const passed = report?.status === 'pass';
  const headers = report?.response?.headers ?? {};
  return {
    id: 'proxy_smoke',
    label: 'proxy smoke',
    status: passed ? 'pass' : 'fail',
    detail: `status ${report?.response?.status ?? 'unknown'}, model ${headers.requestedModel ?? 'none'}->${headers.model ?? 'none'}, browser proof ${report?.cors?.exposeHeaders?.includes('x-proofroute-model') ? 'readable' : 'missing'}.`
  };
}

function smokeMatrixCheck(report) {
  const passed = report?.status === 'pass';
  const aggregate = report?.aggregate ?? {};
  const ledger = report?.ledger ?? {};
  const privacy = ledger.privacy ?? {};
  const proofs = Object.keys(aggregate.proofs ?? {}).sort().join(',') || 'none';
  return {
    id: 'proxy_matrix',
    label: 'proxy matrix',
    status: passed ? 'pass' : 'fail',
    detail: `${aggregate.passed ?? 0}/${aggregate.count ?? 0} scenarios, model swaps ${aggregate.modelSwaps ?? 0}/${aggregate.count ?? 0}, axes ${proofs}, ledger ${ledger.promptFree ? 'prompt-free' : 'needs audit'}, privacy ${privacy.status ?? 'unknown'} with ${privacy.forbiddenMatchCount ?? 0} forbidden fields and ${privacy.parseErrorCount ?? 0} parse errors.`
  };
}

function privacyCheck(report) {
  return {
    id: 'privacy_boundary',
    label: 'privacy boundary',
    status: report.status === 'pass' ? 'pass' : 'fail',
    detail: `${report.events} events, ${report.forbiddenMatchCount} forbidden fields, ${report.parseErrorCount} parse errors at ${report.path}.`
  };
}

function assetCheck(assets) {
  const valid = assets.filter((asset) => asset.status === 'present');
  const missing = assets.filter((asset) => asset.status === 'missing');
  const invalid = assets.filter((asset) => asset.status === 'invalid');
  return {
    id: 'share_assets',
    label: 'share assets',
    status: valid.length === assets.length ? 'pass' : 'fail',
    detail: `${valid.length}/${assets.length} SVG proof assets valid, ${invalid.length} invalid, ${missing.length} missing.`
  };
}

async function assetReport(cwd, assets) {
  return Promise.all(assets.map(async (asset) => {
    const absolute = resolve(cwd, asset);
    try {
      const info = await stat(absolute);
      const text = await readFile(absolute, 'utf8');
      const validation = validateSvgAsset(asset, text);
      if (validation.status !== 'present') {
        return { path: asset, status: 'invalid', bytes: info.size, ...validation };
      }
      return { path: asset, status: 'present', bytes: info.size, ...validation };
    } catch (error) {
      return { path: asset, status: 'missing', message: error.code === 'ENOENT' ? 'not found' : error.message };
    }
  }));
}

function validateSvgAsset(path, text) {
  const messages = [];
  const svgTag = text.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const width = numberAttribute(svgTag, 'width');
  const height = numberAttribute(svgTag, 'height');
  const title = tagText(text, 'title');
  const desc = tagText(text, 'desc');
  const expectation = assetExpectations[path];
  if (!svgTag) messages.push('missing root svg element');
  if (width !== 1200 || height !== 720) messages.push(`expected 1200x720 SVG, got ${width ?? 'unknown'}x${height ?? 'unknown'}`);
  if (!/\brole="img"/.test(svgTag)) messages.push('missing role="img"');
  if (!/\baria-labelledby="title desc"/.test(svgTag)) messages.push('missing aria-labelledby title desc');
  if (!title.includes('ProofRoute')) messages.push('title does not mention ProofRoute');
  if (!desc.includes('ProofRoute')) messages.push('description does not mention ProofRoute');
  if (expectation?.title && title !== expectation.title) messages.push(`expected title ${expectation.title}`);
  for (const term of expectation?.terms ?? []) {
    if (!text.includes(term)) messages.push(`missing receipt term ${term}`);
  }
  if (promptLeakPattern.test(text)) messages.push('asset contains prompt-like text, credentials, or ANSI control codes');
  if (unprovenHardwarePattern.test(text)) messages.push('asset contains hardware-claim copy that belongs in strict hardware evidence, not checked-in default assets');
  return {
    status: messages.length === 0 ? 'present' : 'invalid',
    width,
    height,
    title,
    desc,
    message: messages.join('; ')
  };
}

function numberAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}="([0-9.]+)"`, 'i'));
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function tagText(text, name) {
  const match = text.match(new RegExp(`<${name}\\b[^>]*>([^<]*)<\\/${name}>`, 'i'));
  return match?.[1] ?? '';
}

async function classifierEvidenceReadiness({ cwd, evidencePath, required = false, requireHardwareProbe = false, allowArtifactOnly = false, evidenceMode, maxEvidenceAgeMs, now, checkId = 'classifier_evidence', label = 'classifier evidence' }) {
  if (evidenceMode === 'skipped') {
    return {
      check: {
        id: checkId,
        label,
        status: 'pass',
        detail: `Accelerator evidence was not required at ${evidencePath} because this core release makes no CUDA, TensorRT, or multi-GPU claim.`
      },
      report: {
        status: 'not_claimed',
        path: evidencePath,
        mode: evidenceMode,
        claim: 'none',
        requireHardwareProbe: false,
        message: 'core release makes no accelerator claim'
      }
    };
  }
  const strictEvidence = required || maxEvidenceAgeMs !== undefined;
  try {
    const report = await verifyClassifierEvidenceFile(evidencePath, { cwd, allowArtifactOnly, requireHardwareProbe, maxAgeMs: maxEvidenceAgeMs, now });
    const claim = allowArtifactOnly ? 'local_artifact' : requireHardwareProbe ? 'hardware' : 'classifier';
    return {
      check: {
        id: checkId,
        label,
        status: report.status === 'pass' ? 'pass' : 'fail',
        detail: `${report.checks.filter((check) => check.pass).length}/${report.checks.length} ${allowArtifactOnly ? 'local artifact ' : ''}evidence checks passed at ${evidencePath}.`
      },
      report: {
        status: report.status,
        path: report.path,
        mode: evidenceMode ?? claim,
        claim,
        allowArtifactOnly,
        requireHardwareProbe,
        evidenceKind: report.evidenceKind,
        evidenceGeneratedAt: report.evidenceGeneratedAt,
        evidenceAgeMs: report.evidenceAgeMs,
        maxEvidenceAgeMs: report.maxEvidenceAgeMs,
        checks: report.checks,
        failedChecks: report.checks.filter((check) => !check.pass)
      }
    };
  } catch (error) {
    return {
      check: {
        id: checkId,
        label,
        status: strictEvidence ? 'fail' : 'warn',
        detail: `No verifiable ${allowArtifactOnly ? 'local artifact ' : ''}classifier evidence at ${evidencePath}; ${strictEvidence ? 'required for this launch check' : 'run classifier:hardware:evidence on real hardware when making accelerator claims'}.`
      },
      report: {
        status: strictEvidence ? 'fail' : 'missing',
        path: evidencePath,
        mode: evidenceMode,
        claim: allowArtifactOnly ? 'local_artifact' : requireHardwareProbe ? 'hardware' : 'classifier',
        allowArtifactOnly,
        requireHardwareProbe,
        message: error.code === 'ENOENT' ? 'not found' : error.message,
        failedChecks: [{ id: 'evidence_file', pass: false, message: error.code === 'ENOENT' ? `${evidencePath} was not found` : error.message }]
      }
    };
  }
}

function skippedCheck(id, label, detail) {
  return { id, label, status: 'warn', detail };
}

function readinessStatus(checks) {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'pass';
}

function money(value) {
  return `$${Number(value ?? 0).toFixed(6)}`;
}
