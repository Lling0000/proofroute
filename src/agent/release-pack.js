import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { classifierEvidenceVerificationFailure, verifyClassifierEvidenceFile } from './classifier-evidence.js';
import { launchReadinessReport } from './launch-readiness.js';
import { repositoryProfileReport } from './repository-profile.js';

const execFile = promisify(execFileCallback);
const promptLeakPattern = /Refactor this webhook|Extract customer ids|Rewrite this README|secret production prompt|sk-secret/i;

export async function releaseProofPack({ controller, runtime, outDir = 'proofroute-release-pack', telemetryPath, evidencePath = 'classifier-evidence.json', requireEvidence = false, core = false, maxEvidenceAgeMs, artifactEvidencePath, requireArtifactEvidence = false, artifactMaxEvidenceAgeMs, now, smoke = true, github = false, githubRepo, githubToken, githubTokenEnv, githubFetch, githubEnv, publicFace = false, publicFetch, git = true, gitRunner, cwd = process.cwd() } = {}) {
  if (!controller || !runtime) throw new Error('release proof pack requires a controller and runtime.');
  const absoluteOut = resolve(cwd, outDir);
  const profile = await repositoryProfileReport();
  const resolvedArtifactEvidencePath = requireArtifactEvidence || artifactEvidencePath !== undefined ? artifactEvidencePath ?? 'classifier-linear-evidence.json' : undefined;
  const launch = await launchReadinessReport({
    controller,
    runtime,
    telemetryPath,
    evidencePath,
    requireEvidence,
    evidenceMode: core ? 'skipped' : undefined,
    maxEvidenceAgeMs,
    artifactEvidencePath: resolvedArtifactEvidencePath,
    requireArtifactEvidence,
    artifactMaxEvidenceAgeMs,
    now,
    smoke,
    github,
    githubRepo,
    githubToken,
    githubTokenEnv,
    githubFetch,
    githubEnv,
    publicFace,
    publicFetch,
    cwd
  });
  const packLaunch = releasePackSafeLaunch(launch);
  const gitReport = git === false ? skippedGitProvenance() : await gitProvenanceReport({ cwd, gitRunner });
  await mkdir(absoluteOut, { recursive: true });
  await mkdir(join(absoluteOut, 'assets'), { recursive: true });
  const files = [];
  await writeJson(join(absoluteOut, 'repository-profile.json'), profile, files, cwd);
  await writeJson(join(absoluteOut, 'launch-readiness.json'), packLaunch, files, cwd);
  await writeJson(join(absoluteOut, 'git-provenance.json'), gitReport, files, cwd);
  const assetCopies = [];
  for (const asset of launch.assets ?? []) {
    if (asset.status !== 'present') {
      assetCopies.push({ source: asset.path, status: 'missing' });
      continue;
    }
    const target = join(absoluteOut, 'assets', basename(asset.path));
    await copyFile(resolve(cwd, asset.path), target);
    const copied = { source: asset.path, target: displayPath(cwd, target), status: 'copied', bytes: asset.bytes };
    assetCopies.push(copied);
    files.push(copied.target);
  }
  const evidenceFiles = [];
  if (core) {
    evidenceFiles.push({
      source: evidencePath,
      status: 'not_claimed',
      claim: 'none',
      message: 'core release makes no accelerator claim'
    });
  } else {
    evidenceFiles.push(...await copyClassifierEvidence({
      cwd,
      absoluteOut,
      evidencePath,
      required: requireEvidence,
      requireHardwareProbe: requireEvidence,
      maxEvidenceAgeMs,
      now,
      files,
      claim: requireEvidence ? 'hardware' : 'classifier',
      targetName: 'classifier-evidence.json',
      verifyName: 'classifier-evidence-verify.json'
    }));
  }
  if (resolvedArtifactEvidencePath !== undefined) {
    evidenceFiles.push(...await copyClassifierEvidence({
      cwd,
      absoluteOut,
      evidencePath: resolvedArtifactEvidencePath,
      required: requireArtifactEvidence,
      allowArtifactOnly: true,
      maxEvidenceAgeMs: artifactMaxEvidenceAgeMs,
      now,
      files,
      claim: 'local_artifact',
      targetName: 'classifier-artifact-evidence.json',
      verifyName: 'classifier-artifact-evidence-verify.json'
    }));
  }
  const generatedAt = new Date().toISOString();
  const status = releaseStatus([packLaunch.status, gitReport.status, evidenceFilesStatus(evidenceFiles)]);
  const markdown = releaseMarkdown({ profile, launch: packLaunch, assetCopies, git: gitReport, generatedAt });
  const launchCopy = launchCopyMarkdown({ profile, launch: packLaunch, git: gitReport, generatedAt });
  if (promptLeakPattern.test(`${markdown}\n${launchCopy}`)) throw new Error('release proof pack markdown would expose prompt-like content.');
  await writeText(join(absoluteOut, 'proofroute-release.md'), markdown, files, cwd);
  await writeText(join(absoluteOut, 'launch-copy.md'), launchCopy, files, cwd);
  const report = {
    kind: 'proofroute-release-proof-pack-v1',
    generatedAt,
    status,
    outDir: displayPath(cwd, absoluteOut),
    files,
    assetCopies,
    evidenceFiles,
    core,
    git: gitReport,
    launch: {
      status: packLaunch.status,
      checks: packLaunch.checks,
      proof: packLaunch.proof,
      github: packLaunch.github,
      public: packLaunch.public,
      smoke: packLaunch.smoke,
      smokeMatrix: packLaunch.smokeMatrix,
      privacy: packLaunch.privacy,
      assets: packLaunch.assets,
      evidence: packLaunch.evidence,
      artifactEvidence: packLaunch.artifactEvidence
    },
    profile: {
      githubDescription: profile.github.description,
      topicCount: profile.github.topics.length,
      homepage: profile.github.homepage
    }
  };
  if (promptLeakPattern.test(JSON.stringify(report))) throw new Error('release proof pack report would expose prompt-like content.');
  return report;
}

export async function releasePreflightReport({ controller, runtime, outDir = 'proofroute-release-pack', telemetryPath, evidencePath = 'classifier-evidence.json', requireEvidence = false, core = false, maxEvidenceAgeMs, artifactEvidencePath, requireArtifactEvidence = false, artifactMaxEvidenceAgeMs, now, smoke = true, github = false, githubRepo, githubToken, githubTokenEnv, githubFetch, githubEnv, publicFace = false, publicFetch, git = true, gitRunner, cwd = process.cwd() } = {}) {
  if (!controller || !runtime) throw new Error('release preflight requires a controller and runtime.');
  const profile = await repositoryProfileReport();
  const resolvedArtifactEvidencePath = requireArtifactEvidence || artifactEvidencePath !== undefined ? artifactEvidencePath ?? 'classifier-linear-evidence.json' : undefined;
  const launch = await launchReadinessReport({
    controller,
    runtime,
    telemetryPath,
    evidencePath,
    requireEvidence,
    evidenceMode: core ? 'skipped' : undefined,
    maxEvidenceAgeMs,
    artifactEvidencePath: resolvedArtifactEvidencePath,
    requireArtifactEvidence,
    artifactMaxEvidenceAgeMs,
    now,
    smoke,
    github,
    githubRepo,
    githubToken,
    githubTokenEnv,
    githubFetch,
    githubEnv,
    publicFace,
    publicFetch,
    cwd
  });
  const gitReport = git === false ? skippedGitProvenance() : await gitProvenanceReport({ cwd, gitRunner });
  const evidenceFiles = [];
  if (core) {
    evidenceFiles.push({
      source: evidencePath,
      status: 'not_claimed',
      claim: 'none',
      message: 'core release makes no accelerator claim'
    });
  } else {
    evidenceFiles.push(await verifyReleaseEvidence({
      cwd,
      evidencePath,
      required: requireEvidence,
      requireHardwareProbe: requireEvidence,
      maxEvidenceAgeMs,
      now,
      claim: requireEvidence ? 'hardware' : 'classifier'
    }));
  }
  if (resolvedArtifactEvidencePath !== undefined) {
    evidenceFiles.push(await verifyReleaseEvidence({
      cwd,
      evidencePath: resolvedArtifactEvidencePath,
      required: requireArtifactEvidence,
      allowArtifactOnly: true,
      maxEvidenceAgeMs: artifactMaxEvidenceAgeMs,
      now,
      claim: 'local_artifact'
    }));
  }
  const status = releaseStatus([launch.status, gitReport.status, evidenceFilesStatus(evidenceFiles)]);
  return {
    kind: 'proofroute-release-preflight-v1',
    generatedAt: new Date().toISOString(),
    status,
    outDir,
    wouldWrite: [
      'repository-profile.json',
      'launch-readiness.json',
      'git-provenance.json',
      'assets/*.svg',
      'proofroute-release.md',
      'launch-copy.md'
    ],
    evidenceFiles,
    core,
    git: gitReport,
    launch: {
      status: launch.status,
      checks: launch.checks,
      proof: launch.proof,
      github: launch.github,
      public: launch.public,
      smoke: launch.smoke,
      smokeMatrix: launch.smokeMatrix,
      privacy: launch.privacy,
      assets: launch.assets,
      evidence: launch.evidence,
      artifactEvidence: launch.artifactEvidence
    },
    profile: {
      githubDescription: profile.github.description,
      topicCount: profile.github.topics.length,
      homepage: profile.github.homepage
    }
  };
}

async function copyClassifierEvidence({ cwd, absoluteOut, evidencePath, required = false, requireHardwareProbe = false, allowArtifactOnly = false, maxEvidenceAgeMs, now, files, claim = 'classifier', targetName = 'classifier-evidence.json', verifyName = 'classifier-evidence-verify.json' }) {
  const output = [];
  const target = join(absoluteOut, targetName);
  const verificationPath = join(absoluteOut, verifyName);
  const strictEvidence = required || maxEvidenceAgeMs !== undefined;
  try {
    const verification = await verifyClassifierEvidenceFile(evidencePath, { cwd, allowArtifactOnly, requireHardwareProbe, maxAgeMs: maxEvidenceAgeMs, now });
    await writeJson(verificationPath, releasePackSafeVerification(verification), files, cwd);
    if (verification.status === 'pass') {
      await copyFile(resolve(cwd, evidencePath), target);
      const copied = { source: evidencePath, target: displayPath(cwd, target), status: 'copied', claim, verified: true };
      output.push(copied);
      files.push(copied.target);
    } else {
      output.push({
        source: evidencePath,
        status: 'not_copied',
        claim,
        message: 'classifier evidence verification failed, so raw evidence was not copied into the release pack'
      });
    }
    output.push({ source: evidencePath, target: displayPath(cwd, verificationPath), status: verification.status, claim });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      const verification = releasePackSafeVerification(classifierEvidenceVerificationFailure(evidencePath, error, { cwd, now }));
      await writeJson(verificationPath, verification, files, cwd);
      output.push({ source: evidencePath, target: displayPath(cwd, verificationPath), status: verification.status, claim });
    }
    output.push({ source: evidencePath, status: strictEvidence || error.code !== 'ENOENT' ? 'fail' : 'missing', claim, message: error.code === 'ENOENT' ? 'not found' : 'classifier evidence could not be verified' });
  }
  return output;
}

function releasePackSafeLaunch(launch) {
  return {
    ...launch,
    evidence: releasePackSafeEvidenceReport(launch.evidence),
    artifactEvidence: releasePackSafeEvidenceReport(launch.artifactEvidence)
  };
}

function releasePackSafeEvidenceReport(report) {
  if (!report || report.status === 'pass' || report.status === 'not_claimed') return report;
  return releasePackSafeVerification(report);
}

function releasePackSafeVerification(report) {
  if (!report || report.status === 'pass' || report.status === 'not_claimed') return report;
  const checks = safeVerificationChecks(report.checks);
  const failedChecks = safeVerificationChecks(report.failedChecks ?? checks.filter((check) => !check.pass));
  return {
    kind: report.kind,
    status: report.status,
    path: report.path,
    mode: report.mode,
    claim: report.claim,
    allowArtifactOnly: report.allowArtifactOnly,
    requireHardwareProbe: report.requireHardwareProbe,
    generatedAt: safeTimestamp(report.generatedAt),
    evidenceGeneratedAt: safeTimestamp(report.evidenceGeneratedAt),
    evidenceAgeMs: finiteNumber(report.evidenceAgeMs),
    maxEvidenceAgeMs: finiteNumber(report.maxEvidenceAgeMs),
    evidenceKind: report.evidenceKind,
    checks,
    failedChecks,
    artifacts: Array.isArray(report.artifacts) ? [] : undefined,
    message: 'classifier evidence verification failed without archiving raw evidence'
  };
}

function safeVerificationChecks(checks = []) {
  return (Array.isArray(checks) ? checks : []).map((check) => ({
    id: check.id,
    pass: Boolean(check.pass),
    message: check.pass ? 'passed' : 'failed'
  }));
}

function safeTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

async function verifyReleaseEvidence({ cwd, evidencePath, required = false, requireHardwareProbe = false, allowArtifactOnly = false, maxEvidenceAgeMs, now, claim = 'classifier' }) {
  const strictEvidence = required || maxEvidenceAgeMs !== undefined;
  try {
    const verification = await verifyClassifierEvidenceFile(evidencePath, { cwd, allowArtifactOnly, requireHardwareProbe, maxAgeMs: maxEvidenceAgeMs, now });
    return {
      source: evidencePath,
      status: verification.status,
      claim,
      checks: verification.checks,
      failedChecks: verification.checks.filter((check) => !check.pass)
    };
  } catch (error) {
    return {
      source: evidencePath,
      status: strictEvidence ? 'fail' : 'missing',
      claim,
      message: error.code === 'ENOENT' ? 'not found' : error.message,
      failedChecks: [{ id: 'evidence_file', pass: false, message: error.code === 'ENOENT' ? `${evidencePath} was not found` : error.message }]
    };
  }
}

async function gitProvenanceReport({ cwd, gitRunner }) {
  try {
    const root = cleanLine(await gitOutput(['rev-parse', '--show-toplevel'], { cwd, gitRunner }));
    const branch = cleanLine(await gitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, gitRunner }));
    const commit = cleanLine(await gitOutput(['rev-parse', 'HEAD'], { cwd, gitRunner }));
    const commitTimestamp = cleanLine(await gitOutput(['log', '-1', '--format=%cI'], { cwd, gitRunner }));
    const statusText = await gitOutput(['status', '--porcelain'], { cwd, gitRunner });
    const statusLines = statusText.split(/\r?\n/).filter(Boolean);
    const untrackedCount = statusLines.filter((line) => line.startsWith('??')).length;
    const stagedCount = statusLines.filter((line) => !line.startsWith('??') && line[0] !== ' ').length;
    const unstagedCount = statusLines.filter((line) => !line.startsWith('??') && line[1] !== ' ').length;
    return {
      kind: 'proofroute-git-provenance-v1',
      status: statusLines.length ? 'warn' : 'pass',
      available: true,
      root: displayPath(cwd, root),
      branch,
      commit,
      shortCommit: commit.slice(0, 12),
      commitTimestamp,
      dirty: statusLines.length > 0,
      changedFileCount: statusLines.length,
      stagedCount,
      unstagedCount,
      untrackedCount,
      statusSha256: createHash('sha256').update(statusText).digest('hex')
    };
  } catch (error) {
    return {
      kind: 'proofroute-git-provenance-v1',
      status: 'warn',
      available: false,
      message: compactMessage(error.message)
    };
  }
}

async function gitOutput(args, { cwd, gitRunner }) {
  if (gitRunner) {
    const result = await gitRunner(args, { cwd });
    return typeof result === 'string' ? result : result?.stdout ?? '';
  }
  const result = await execFile('git', args, { cwd, timeout: 1000, maxBuffer: 1024 * 1024 });
  return result.stdout;
}

function skippedGitProvenance() {
  return {
    kind: 'proofroute-git-provenance-v1',
    status: 'pass',
    available: false,
    skipped: true,
    message: 'git provenance skipped by request'
  };
}

function releaseMarkdown({ profile, launch, assetCopies, git, generatedAt }) {
  const proof = launch.proof?.aggregate ?? {};
  const github = launch.github ? ` The live GitHub repository face check is ${launch.github.status}, with description, homepage, and topics compared against the local profile.` : '';
  const publicFace = launch.public ? ` The no-credential public face check is ${launch.public.status}, with owner status ${launch.public.github?.owner?.status ?? 'unknown'}, GitHub repository status ${launch.public.github?.status ?? 'unknown'}, and npm status ${launch.public.npm?.status ?? 'unknown'}.` : '';
  const proxyProof = releaseProxyProofText(launch);
  const evidenceText = releaseEvidenceText(launch.evidence, launch.artifactEvidence);
  const freshness = releaseEvidenceFreshness(launch.evidence, launch.artifactEvidence);
  const source = gitMarkdown(git);
  const assets = assetCopies.filter((asset) => asset.status === 'copied').length;
  return [
    '# ProofRoute Release Proof',
    '',
    `ProofRoute release proof generated at ${generatedAt} finished with ${launch.status.toUpperCase()} launch status. The repository face is ${profile.github.description} The local proof routed ${proof.count ?? 0} synthetic launch-suite requests with ${ms(proof.p95RouterMs)} p95 router latency, ${percent(proof.p95RouterOverheadPct)} router overhead, ${speed(proof.averageSpeedup)} speed lift, and ${money(proof.savingsUsd)} estimated savings while keeping prompt and completion text out of the release artifact.${proxyProof}${github}${publicFace}${source} The privacy audit status is ${launch.privacy?.status ?? 'unknown'}, ${assets} SVG proof assets were copied into this pack, and ${evidenceText}.${freshness} A strict accelerator claim should only be published when classifier evidence verifies as pass, records nvidia-smi hardware profiles, is fresh for the release window, and the launch readiness status is pass.`
  ].join('\n');
}

function launchCopyMarkdown({ profile, launch, git, generatedAt }) {
  const proof = launch.proof?.aggregate ?? {};
  const source = git?.available ? ` The source proof is branch ${git.branch} at ${git.shortCommit}, with ${git.dirty ? `${git.changedFileCount} dirty paths recorded before packaging` : 'a clean working tree recorded before packaging'}.` : '';
  const github = launch.github ? ` The live GitHub repository face check is ${launch.github.status}.` : '';
  const publicFace = launch.public ? ` The no-credential public face check is ${launch.public.status}.` : '';
  const proxyProof = launch.smokeMatrix ? ` The transparent proxy matrix proves ${launch.smokeMatrix.passed ?? 0}/${launch.smokeMatrix.count ?? 0} intent, context, and cost scenarios through one local OpenAI-compatible entrypoint with prompt-free ledger privacy ${launch.smokeMatrix.privacyStatus ?? 'unknown'}.` : '';
  const evidenceText = launchCopyEvidenceText(launch.evidence, launch.artifactEvidence);
  const freshness = launchCopyEvidenceFreshness(launch.evidence, launch.artifactEvidence);
  return [
    '# ProofRoute Launch Copy',
    '',
    `GitHub release paragraph generated at ${generatedAt}: ${profile.social.shortPitch} The latest local release proof routed ${proof.count ?? 0} prompt-free launch-suite requests with ${ms(proof.p95RouterMs)} p95 router latency, ${percent(proof.p95RouterOverheadPct)} router overhead, ${speed(proof.averageSpeedup)} speed lift, and ${money(proof.savingsUsd)} estimated savings.${proxyProof} The first command stays ` + '`node ./bin/proofroute.js demo`' + ` so curiosity converts into a local receipt instead of a vague promise.${github}${publicFace}${source}`,
    '',
    `Vibe Coding paragraph: ${profile.social.vibePitch} The shareable receipt is generated by ` + '`node ./bin/proofroute.js share --svg --out docs/proofroute-terminal.svg`' + `, while the release proof pack keeps repository metadata, source provenance, privacy status, proof assets, and classifier evidence status together without logging prompt text.`,
    '',
    `Hardware claim paragraph: publish CUDA, TensorRT, or multi-GPU accelerator claims only when ` + '`node ./bin/proofroute.js release --out proofroute-release-pack --check-github --check-public --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24`' + ` passes. The current classifier evidence status is ${evidenceText}.${freshness}`
  ].join('\n');
}

function releaseProxyProofText(launch) {
  const smoke = launch.smoke;
  const matrix = launch.smokeMatrix;
  const smokeText = smoke ? ` The transparent proxy smoke is ${smoke.status ?? 'unknown'}, routing ${smoke.requestedModel ?? 'none'} to ${smoke.model ?? 'none'} with browser proof ${smoke.browserProofHeaders ? 'readable' : 'missing'}.` : '';
  const matrixText = matrix ? ` The proxy matrix is ${matrix.status ?? 'unknown'} across ${matrix.passed ?? 0}/${matrix.count ?? 0} scenarios, with ${matrix.modelSwaps ?? 0}/${matrix.count ?? 0} model swaps, axes ${compactCounts(matrix.proofs)}, and prompt-free ledger privacy ${matrix.privacyStatus ?? 'unknown'}.` : '';
  return `${smokeText}${matrixText}`;
}

function releaseEvidenceText(evidence, artifactEvidence) {
  const classifierEvidence = evidence?.status === 'not_claimed'
    ? 'accelerator evidence status is not claimed because this core release makes no accelerator claim'
    : `classifier evidence status is ${evidence?.status ?? 'unknown'} with claim ${evidence?.claim ?? 'classifier'}${evidence?.requireHardwareProbe ? ' and a required hardware_probe gate' : ''}`;
  if (!artifactEvidence) return classifierEvidence;
  const artifactText = artifactEvidence.status === 'pass'
    ? `local artifact evidence status is pass at ${artifactEvidence.path}, verifying the hashed classifier model artifact without asserting CUDA, TensorRT, or multi-GPU hardware`
    : `local artifact evidence status is ${artifactEvidence.status ?? 'unknown'} at ${artifactEvidence.path ?? 'classifier-linear-evidence.json'}`;
  return `${classifierEvidence}, and ${artifactText}`;
}

function compactCounts(values = {}) {
  return Object.entries(values).map(([key, value]) => `${key}:${value}`).join(',') || 'none';
}

function releaseEvidenceFreshness(evidence, artifactEvidence) {
  const rows = [];
  if (evidence?.maxEvidenceAgeMs !== undefined) {
    rows.push(`The classifier evidence freshness gate requires an artifact no older than ${hours(evidence.maxEvidenceAgeMs)} hours, and the submitted evidence is currently ${evidence.evidenceAgeMs === undefined ? 'unaged' : `${hours(evidence.evidenceAgeMs)} hours old`}.`);
  }
  if (artifactEvidence?.maxEvidenceAgeMs !== undefined) {
    rows.push(`The local artifact evidence freshness gate requires an artifact no older than ${hours(artifactEvidence.maxEvidenceAgeMs)} hours, and the submitted artifact evidence is currently ${artifactEvidence.evidenceAgeMs === undefined ? 'unaged' : `${hours(artifactEvidence.evidenceAgeMs)} hours old`}.`);
  }
  return rows.length ? ` ${rows.join(' ')}` : '';
}

function launchCopyEvidenceText(evidence, artifactEvidence) {
  const classifierEvidence = evidence?.status === 'not_claimed'
    ? 'not claimed because this core release makes no CUDA, TensorRT, or multi-GPU claim'
    : `${evidence?.status ?? 'unknown'} with claim ${evidence?.claim ?? 'classifier'}${evidence?.requireHardwareProbe ? ' and required hardware_probe verification' : ''}`;
  if (!artifactEvidence) return classifierEvidence;
  return `${classifierEvidence}; local artifact proof is ${artifactEvidence.status ?? 'unknown'} and makes no hardware claim`;
}

function launchCopyEvidenceFreshness(evidence, artifactEvidence) {
  const rows = [];
  if (evidence?.maxEvidenceAgeMs !== undefined) rows.push(`The classifier evidence freshness window is ${hours(evidence.maxEvidenceAgeMs)} hours.`);
  if (artifactEvidence?.maxEvidenceAgeMs !== undefined) rows.push(`The local artifact evidence freshness window is ${hours(artifactEvidence.maxEvidenceAgeMs)} hours.`);
  return rows.length ? ` ${rows.join(' ')}` : '';
}

function gitMarkdown(git) {
  if (!git) return '';
  if (git.available) {
    const state = git.dirty ? `dirty with ${git.changedFileCount} changed paths, ${git.stagedCount} staged paths, ${git.unstagedCount} unstaged paths, and ${git.untrackedCount} untracked paths` : 'clean';
    return ` The source snapshot is branch ${git.branch} at commit ${git.shortCommit}, with commit time ${git.commitTimestamp} and a ${state} working tree recorded before the pack files were written.`;
  }
  return ` Git provenance is ${git.skipped ? 'skipped' : 'unavailable'}${git.message ? ` because ${git.message}` : ''}.`;
}

async function writeJson(path, value, files, cwd) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`, files, cwd);
}

async function writeText(path, value, files, cwd) {
  await writeFile(path, value, 'utf8');
  files.push(displayPath(cwd, path));
}

function displayPath(cwd, path) {
  const absolute = resolve(path);
  const root = resolve(cwd);
  const prefix = `${root}/`;
  return absolute.startsWith(prefix) ? absolute.slice(prefix.length) : absolute;
}

function releaseStatus(statuses) {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.some((status) => ['warn', 'missing'].includes(status))) return 'warn';
  return 'pass';
}

function evidenceFilesStatus(files) {
  if (files.some((file) => file.status === 'fail')) return 'fail';
  if (files.some((file) => file.status === 'missing')) return 'warn';
  return 'pass';
}

function cleanLine(value) {
  return String(value ?? '').trim().split(/\r?\n/)[0] ?? '';
}

function compactMessage(value) {
  return cleanLine(value).slice(0, 200);
}

function ms(value) {
  return `${Number(value ?? 0).toFixed(2)}ms`;
}

function percent(value) {
  return `${Number(value ?? 0).toFixed(2)}%`;
}

function speed(value) {
  return `${Number(value ?? 0).toFixed(2)}x`;
}

function money(value) {
  return `$${Number(value ?? 0).toFixed(6)}`;
}

function hours(value) {
  return (Number(value ?? 0) / 3600000).toFixed(2);
}
