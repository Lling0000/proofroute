import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releasePreflightReport, releaseProofPack } from '../src/agent/release-pack.js';
import { repositoryProfileReport } from '../src/agent/repository-profile.js';
import { AgentRuntime } from '../src/agent/runtime.js';
import { demoCatalog } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';
import { renderHelp, renderReleasePreflight, renderReleaseProofPack } from '../src/view/terminal.js';

const promptLeakPattern = /Refactor this webhook|Extract customer ids|Rewrite this README|Refactor this TypeScript|Rewrite this launch|Audit this repository|customer ids|stacktrace|Bearer smoke-key/;
const secretLeakPattern = /secret-token|Refactor this webhook|Extract customer ids|Rewrite this README|Refactor this TypeScript|Rewrite this launch|Audit this repository|customer ids|stacktrace|Bearer smoke-key/;

test('release proof pack writes prompt-free launch evidence and assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-pack-'));
  const outDir = join(dir, 'pack');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const profile = await repositoryProfileReport();
    const evidencePath = join(dir, 'classifier-evidence.json');
    const now = new Date('2026-06-01T00:00:00.000Z');
    await writeFile(evidencePath, `${JSON.stringify(await fixtureEvidence({ generatedAt: '2026-05-31T23:00:00.000Z' }), null, 2)}\n`, 'utf8');
    const report = await releaseProofPack({
      controller,
      runtime,
      outDir,
      telemetryPath: join(dir, 'missing-events.jsonl'),
      evidencePath,
      maxEvidenceAgeMs: 24 * 60 * 60 * 1000,
      now,
      smoke: false,
      github: true,
      githubRepo: 'Lling0000/proofroute',
      githubToken: 'secret-token',
      githubFetch: fakeGithubFetch(profile),
      githubEnv: {},
      gitRunner: fakeGitRunner()
    });
    assert.equal(report.kind, 'proofroute-release-proof-pack-v1');
    assert.equal(report.status, 'warn');
    assert.equal(report.launch.github.status, 'pass');
    assert.ok(report.files.some((file) => file.endsWith('launch-readiness.json')));
    assert.ok(report.files.some((file) => file.endsWith('repository-profile.json')));
    assert.ok(report.files.some((file) => file.endsWith('git-provenance.json')));
    assert.ok(report.files.some((file) => file.endsWith('proofroute-release.md')));
    assert.ok(report.files.some((file) => file.endsWith('launch-copy.md')));
    assert.ok(report.files.some((file) => file.endsWith('classifier-evidence.json')));
    assert.ok(report.files.some((file) => file.endsWith('classifier-evidence-verify.json')));
    assert.ok(report.evidenceFiles.some((file) => file.status === 'pass'));
    assert.equal(report.git.shortCommit, 'abc123def456');
    assert.equal(report.git.dirty, false);
    assert.equal(report.launch.evidence.checks.find((check) => check.id === 'evidence_freshness').pass, true);
    assert.equal(report.assetCopies.filter((asset) => asset.status === 'copied').length, 3);
    assert.ok(existsSync(join(outDir, 'assets', 'proofroute-terminal.svg')));
    const markdown = await readFile(join(outDir, 'proofroute-release.md'), 'utf8');
    const launchCopy = await readFile(join(outDir, 'launch-copy.md'), 'utf8');
    const output = renderReleaseProofPack(report);
    assert.match(output, /RELEASE PROOF PACK/);
    assert.match(renderHelp(), /proofroute release/);
    assert.match(launchCopy, /ProofRoute Launch Copy/);
    assert.match(launchCopy, /Vibe Coding paragraph/);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${markdown}\n${launchCopy}\n${output}`, secretLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release proof pack fails stale classifier evidence when freshness is required', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-stale-'));
  const outDir = join(dir, 'pack');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const evidencePath = join(dir, 'classifier-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(await fixtureEvidence({ generatedAt: '2026-05-30T00:00:00.000Z' }), null, 2)}\n`, 'utf8');
    const report = await releaseProofPack({
      controller,
      runtime,
      outDir,
      telemetryPath: join(dir, 'missing-events.jsonl'),
      evidencePath,
      maxEvidenceAgeMs: 60 * 60 * 1000,
      now: new Date('2026-06-01T00:00:00.000Z'),
      smoke: false,
      gitRunner: fakeGitRunner({ status: ' M README.md\n?? classifier-evidence.json\n' })
    });
    const freshness = report.launch.evidence.checks.find((check) => check.id === 'evidence_freshness');
    assert.equal(report.status, 'fail');
    assert.equal(report.launch.status, 'fail');
    assert.equal(freshness.pass, false);
    assert.equal(report.git.dirty, true);
    assert.equal(report.git.changedFileCount, 2);
    assert.ok(report.evidenceFiles.some((file) => file.status === 'fail'));
    const verification = JSON.parse(await readFile(join(outDir, 'classifier-evidence-verify.json'), 'utf8'));
    assert.equal(verification.checks.find((check) => check.id === 'evidence_freshness').pass, false);
    const markdown = await readFile(join(outDir, 'proofroute-release.md'), 'utf8');
    const launchCopy = await readFile(join(outDir, 'launch-copy.md'), 'utf8');
    const output = renderReleaseProofPack(report);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${markdown}\n${launchCopy}\n${output}`, promptLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release proof pack does not archive raw classifier evidence when verification fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-poisoned-evidence-'));
  const outDir = join(dir, 'pack');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const evidencePath = join(dir, 'classifier-evidence.json');
    const evidence = await fixtureEvidence({ generatedAt: '2026-05-31T23:00:00.000Z' });
    evidence.evidence.prompt = 'Refactor this webhook with secret-token and customer ids';
    evidence.evidence.benchmark.content = 'secret production prompt with stacktrace';
    evidence.evidence.artifacts[0].content = 'Extract customer ids with Bearer smoke-key';
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    const report = await releaseProofPack({
      controller,
      runtime,
      outDir,
      telemetryPath: join(dir, 'missing-events.jsonl'),
      evidencePath,
      requireEvidence: true,
      maxEvidenceAgeMs: 24 * 60 * 60 * 1000,
      now: new Date('2026-06-01T00:00:00.000Z'),
      smoke: false,
      gitRunner: fakeGitRunner()
    });
    assert.equal(report.status, 'fail');
    assert.equal(report.launch.evidence.status, 'fail');
    assert.equal(report.launch.evidence.checks.find((check) => check.id === 'prompt_free').pass, false);
    assert.equal(existsSync(join(outDir, 'classifier-evidence.json')), false);
    assert.equal(existsSync(join(outDir, 'classifier-evidence-verify.json')), true);
    assert.ok(report.evidenceFiles.some((file) => file.status === 'not_copied'));
    assert.ok(report.evidenceFiles.some((file) => file.status === 'fail' && file.target?.endsWith('classifier-evidence-verify.json')));
    assert.equal(report.files.some((file) => file.endsWith('classifier-evidence.json')), false);
    assert.equal(report.files.some((file) => file.endsWith('classifier-evidence-verify.json')), true);
    const verification = await readFile(join(outDir, 'classifier-evidence-verify.json'), 'utf8');
    const markdown = await readFile(join(outDir, 'proofroute-release.md'), 'utf8');
    const launchCopy = await readFile(join(outDir, 'launch-copy.md'), 'utf8');
    const output = renderReleaseProofPack(report);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${verification}\n${markdown}\n${launchCopy}\n${output}`, secretLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release proof pack sanitizes invalid classifier evidence parse failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-invalid-evidence-'));
  const outDir = join(dir, 'pack');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const evidencePath = join(dir, 'classifier-evidence.json');
    await writeFile(evidencePath, 'not json secret production prompt with customer ids and sk-secret\n', 'utf8');
    const report = await releaseProofPack({
      controller,
      runtime,
      outDir,
      telemetryPath: join(dir, 'missing-events.jsonl'),
      evidencePath,
      requireEvidence: true,
      maxEvidenceAgeMs: 24 * 60 * 60 * 1000,
      now: new Date('2026-06-01T00:00:00.000Z'),
      smoke: false,
      gitRunner: fakeGitRunner()
    });
    assert.equal(report.status, 'fail');
    assert.equal(report.launch.evidence.status, 'fail');
    assert.equal(existsSync(join(outDir, 'classifier-evidence.json')), false);
    assert.equal(existsSync(join(outDir, 'classifier-evidence-verify.json')), true);
    assert.ok(report.evidenceFiles.some((file) => file.status === 'fail' && file.message === 'classifier evidence could not be verified'));
    const launchReadiness = await readFile(join(outDir, 'launch-readiness.json'), 'utf8');
    const verification = await readFile(join(outDir, 'classifier-evidence-verify.json'), 'utf8');
    const markdown = await readFile(join(outDir, 'proofroute-release.md'), 'utf8');
    const launchCopy = await readFile(join(outDir, 'launch-copy.md'), 'utf8');
    const output = renderReleaseProofPack(report);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${launchReadiness}\n${verification}\n${markdown}\n${launchCopy}\n${output}`, secretLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('core release proof pack passes without accelerator evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-core-'));
  const outDir = join(dir, 'pack');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const report = await releaseProofPack({
      controller,
      runtime,
      outDir,
      telemetryPath: join(dir, 'missing-events.jsonl'),
      evidencePath: join(dir, 'missing-classifier-evidence.json'),
      core: true,
      gitRunner: fakeGitRunner()
    });
    assert.equal(report.status, 'pass');
    assert.equal(report.core, true);
    assert.equal(report.launch.evidence.status, 'not_claimed');
    assert.equal(report.launch.smokeMatrix.status, 'pass');
    assert.equal(report.launch.smokeMatrix.passed, 4);
    assert.equal(report.launch.smokeMatrix.privacyStatus, 'pass');
    assert.equal(report.launch.checks.find((check) => check.id === 'classifier_evidence').status, 'pass');
    assert.equal(report.launch.checks.find((check) => check.id === 'proxy_matrix').status, 'pass');
    assert.ok(report.evidenceFiles.some((file) => file.status === 'not_claimed'));
    const markdown = await readFile(join(outDir, 'proofroute-release.md'), 'utf8');
    const launchCopy = await readFile(join(outDir, 'launch-copy.md'), 'utf8');
    assert.match(markdown, /proxy matrix is pass across 4\/4 scenarios/);
    assert.match(launchCopy, /no CUDA, TensorRT, or multi-GPU claim/);
    assert.match(launchCopy, /transparent proxy matrix proves 4\/4 intent, context, and cost scenarios/);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${markdown}\n${launchCopy}`, promptLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('core release proof pack can require local artifact evidence without hardware claim', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-artifact-'));
  const outDir = join(dir, 'pack');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const artifactEvidencePath = join(dir, 'classifier-linear-evidence.json');
    await writeFile(artifactEvidencePath, `${JSON.stringify(await fixtureArtifactOnlyEvidence({ generatedAt: '2026-05-31T23:30:00.000Z' }), null, 2)}\n`, 'utf8');
    const report = await releaseProofPack({
      controller,
      runtime,
      outDir,
      telemetryPath: join(dir, 'missing-events.jsonl'),
      core: true,
      artifactEvidencePath,
      requireArtifactEvidence: true,
      artifactMaxEvidenceAgeMs: 24 * 60 * 60 * 1000,
      now: new Date('2026-06-01T00:00:00.000Z'),
      smoke: false,
      gitRunner: fakeGitRunner()
    });
    assert.equal(report.status, 'warn');
    assert.equal(report.core, true);
    assert.equal(report.launch.evidence.status, 'not_claimed');
    assert.equal(report.launch.artifactEvidence.status, 'pass');
    assert.equal(report.launch.artifactEvidence.claim, 'local_artifact');
    assert.equal(report.launch.checks.find((check) => check.id === 'classifier_evidence').status, 'pass');
    assert.equal(report.launch.checks.find((check) => check.id === 'classifier_artifact_evidence').status, 'pass');
    assert.ok(report.files.some((file) => file.endsWith('classifier-artifact-evidence.json')));
    assert.ok(report.files.some((file) => file.endsWith('classifier-artifact-evidence-verify.json')));
    assert.ok(report.evidenceFiles.some((file) => file.claim === 'none' && file.status === 'not_claimed'));
    assert.ok(report.evidenceFiles.some((file) => file.claim === 'local_artifact' && file.status === 'pass'));
    const verification = JSON.parse(await readFile(join(outDir, 'classifier-artifact-evidence-verify.json'), 'utf8'));
    assert.equal(verification.checks.find((check) => check.id === 'artifact_presence').pass, true);
    assert.equal(verification.checks.find((check) => check.id === 'evidence_freshness').pass, true);
    assert.equal(verification.checks.some((check) => check.id === 'device_profiles'), false);
    assert.equal(verification.checks.some((check) => check.id === 'hardware_probe'), false);
    const launchCopy = await readFile(join(outDir, 'launch-copy.md'), 'utf8');
    assert.match(launchCopy, /local artifact proof is pass and makes no hardware claim/);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${launchCopy}`, promptLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('core release proof pack does not archive polluted local artifact evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-artifact-poisoned-'));
  const outDir = join(dir, 'pack');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const artifactEvidencePath = join(dir, 'classifier-linear-evidence.json');
    const evidence = await fixtureArtifactOnlyEvidence({ generatedAt: '2026-05-31T23:30:00.000Z' });
    evidence.evidence.benchmark.content = 'secret production prompt with stacktrace';
    evidence.evidence.artifacts[0].content = 'Refactor this webhook with customer ids';
    await writeFile(artifactEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    const report = await releaseProofPack({
      controller,
      runtime,
      outDir,
      telemetryPath: join(dir, 'missing-events.jsonl'),
      core: true,
      artifactEvidencePath,
      requireArtifactEvidence: true,
      artifactMaxEvidenceAgeMs: 24 * 60 * 60 * 1000,
      now: new Date('2026-06-01T00:00:00.000Z'),
      smoke: false,
      gitRunner: fakeGitRunner()
    });
    assert.equal(report.status, 'fail');
    assert.equal(report.launch.evidence.status, 'not_claimed');
    assert.equal(report.launch.artifactEvidence.status, 'fail');
    assert.equal(report.launch.artifactEvidence.checks.find((check) => check.id === 'prompt_free').pass, false);
    assert.equal(existsSync(join(outDir, 'classifier-artifact-evidence.json')), false);
    assert.equal(existsSync(join(outDir, 'classifier-artifact-evidence-verify.json')), true);
    assert.ok(report.evidenceFiles.some((file) => file.claim === 'local_artifact' && file.status === 'not_copied'));
    const verification = await readFile(join(outDir, 'classifier-artifact-evidence-verify.json'), 'utf8');
    const launchCopy = await readFile(join(outDir, 'launch-copy.md'), 'utf8');
    assert.match(launchCopy, /no CUDA, TensorRT, or multi-GPU claim/);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${verification}\n${launchCopy}`, secretLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('strict hardware release rejects artifact-only evidence without hardware probe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-artifact-strict-'));
  const outDir = join(dir, 'pack');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const evidencePath = join(dir, 'classifier-linear-evidence.json');
    await writeFile(evidencePath, `${JSON.stringify(await fixtureArtifactOnlyEvidence({ generatedAt: '2026-05-31T23:30:00.000Z' }), null, 2)}\n`, 'utf8');
    const report = await releaseProofPack({
      controller,
      runtime,
      outDir,
      telemetryPath: join(dir, 'missing-events.jsonl'),
      evidencePath,
      requireEvidence: true,
      maxEvidenceAgeMs: 24 * 60 * 60 * 1000,
      now: new Date('2026-06-01T00:00:00.000Z'),
      smoke: false,
      gitRunner: fakeGitRunner()
    });
    assert.equal(report.status, 'fail');
    assert.equal(report.launch.evidence.status, 'fail');
    assert.equal(report.launch.evidence.checks.find((check) => check.id === 'hardware_probe').pass, false);
    assert.equal(report.launch.artifactEvidence, undefined);
    assert.ok(report.evidenceFiles.some((file) => file.claim === 'hardware' && file.status === 'fail'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release preflight reports strict hardware blockers without writing pack files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-preflight-'));
  const outDir = join(dir, 'pack');
  const evidencePath = join(dir, 'classifier-linear-evidence.json');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    await writeFile(evidencePath, `${JSON.stringify(await fixtureArtifactOnlyEvidence({ generatedAt: '2026-05-31T23:30:00.000Z' }), null, 2)}\n`, 'utf8');
    const report = await releasePreflightReport({
      controller,
      runtime,
      outDir,
      telemetryPath: join(dir, 'missing-events.jsonl'),
      evidencePath,
      requireEvidence: true,
      maxEvidenceAgeMs: 24 * 60 * 60 * 1000,
      now: new Date('2026-06-01T00:00:00.000Z'),
      smoke: false,
      gitRunner: fakeGitRunner()
    });
    assert.equal(report.kind, 'proofroute-release-preflight-v1');
    assert.equal(report.status, 'fail');
    assert.equal(existsSync(outDir), false);
    assert.equal(report.evidenceFiles.find((file) => file.claim === 'hardware').status, 'fail');
    assert.ok(report.evidenceFiles.find((file) => file.claim === 'hardware').failedChecks.some((check) => check.id === 'hardware_probe'));
    const output = renderReleasePreflight(report);
    assert.match(output, /RELEASE PREFLIGHT/);
    assert.match(output, /hardware proof/);
    assert.match(output, /hardware_probe/);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${output}`, promptLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release preflight fails explicit public face gate on anonymous GitHub or npm 404', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-public-preflight-'));
  const outDir = join(dir, 'pack');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const report = await releasePreflightReport({
      controller,
      runtime,
      outDir,
      telemetryPath: join(dir, 'missing-events.jsonl'),
      evidencePath: join(dir, 'missing-classifier-evidence.json'),
      core: true,
      smoke: false,
      publicFace: true,
      publicFetch: fakePublicFaceFetch({
        githubStatus: 404,
        github: { message: 'Not Found' },
        npmStatus: 404,
        npm: { error: 'Not found' }
      }),
      gitRunner: fakeGitRunner()
    });
    assert.equal(report.status, 'fail');
    assert.equal(report.launch.public.status, 'fail');
    assert.equal(report.launch.public.github.status, 404);
    assert.equal(report.launch.checks.find((check) => check.id === 'public_repository_face').status, 'fail');
    assert.equal(existsSync(outDir), false);
    const output = renderReleasePreflight(report);
    assert.match(output, /public face/);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${output}`, promptLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release command emits machine-readable proof pack report', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-cli-'));
  const outDir = join(dir, 'pack');
  try {
    const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'release', '--out', outDir, '--telemetry', join(dir, 'missing-events.jsonl'), '--no-smoke', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 2000
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, 'proofroute-release-proof-pack-v1');
    assert.equal(report.status, 'warn');
    assert.ok(report.files.some((file) => file.endsWith('proofroute-release.md')));
    assert.ok(report.files.some((file) => file.endsWith('launch-copy.md')));
    assert.doesNotMatch(result.stdout, promptLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release command preflight emits blockers without creating pack directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-cli-preflight-'));
  const outDir = join(dir, 'pack');
  const evidencePath = join(dir, 'classifier-linear-evidence.json');
  try {
    await writeFile(evidencePath, `${JSON.stringify(await fixtureArtifactOnlyEvidence(), null, 2)}\n`, 'utf8');
    const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'release', '--preflight', '--require-evidence', '--evidence', evidencePath, '--max-evidence-age-hours', '24', '--out', outDir, '--telemetry', join(dir, 'missing-events.jsonl'), '--no-smoke', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5000
    });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, 'proofroute-release-preflight-v1');
    assert.equal(report.status, 'fail');
    assert.equal(existsSync(outDir), false);
    assert.equal(report.launch.evidence.failedChecks.some((check) => check.id === 'hardware_probe'), true);
    assert.equal(report.launch.checks.find((check) => check.id === 'proxy_smoke').status, 'warn');
    assert.match(report.launch.checks.find((check) => check.id === 'proxy_smoke').detail, /skipped/);
    assert.equal(report.launch.checks.find((check) => check.id === 'proxy_matrix').status, 'warn');
    assert.match(report.launch.checks.find((check) => check.id === 'proxy_matrix').detail, /skipped/);
    assert.equal(report.launch.smoke, undefined);
    assert.equal(report.launch.smokeMatrix, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release command preflight skips proxy smoke unless explicitly requested', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-cli-preflight-smoke-'));
  const outDir = join(dir, 'pack');
  const evidencePath = join(dir, 'classifier-linear-evidence.json');
  try {
    await writeFile(evidencePath, `${JSON.stringify(await fixtureArtifactOnlyEvidence(), null, 2)}\n`, 'utf8');
    const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'release', '--preflight', '--require-evidence', '--evidence', evidencePath, '--max-evidence-age-hours', '24', '--out', outDir, '--telemetry', join(dir, 'missing-events.jsonl'), '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5000
    });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, 'proofroute-release-preflight-v1');
    assert.equal(report.launch.checks.find((check) => check.id === 'proxy_smoke').status, 'warn');
    assert.match(report.launch.checks.find((check) => check.id === 'proxy_smoke').detail, /skipped/);
    assert.equal(report.launch.checks.find((check) => check.id === 'proxy_matrix').status, 'warn');
    assert.match(report.launch.checks.find((check) => check.id === 'proxy_matrix').detail, /skipped/);
    assert.equal(report.launch.smoke, undefined);
    assert.equal(report.launch.smokeMatrix, undefined);
    assert.equal(existsSync(outDir), false);
    assert.doesNotMatch(result.stdout, promptLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release command core artifact mode emits machine-readable proof pack', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-cli-artifact-'));
  const outDir = join(dir, 'pack');
  const artifactEvidencePath = join(dir, 'classifier-linear-evidence.json');
  try {
    await writeFile(artifactEvidencePath, `${JSON.stringify(await fixtureArtifactOnlyEvidence(), null, 2)}\n`, 'utf8');
    const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'release', '--core', '--require-artifact-evidence', '--artifact-evidence', artifactEvidencePath, '--max-evidence-age-hours', '24', '--out', outDir, '--telemetry', join(dir, 'missing-events.jsonl'), '--no-smoke', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5000
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.core, true);
    assert.equal(report.launch.evidence.status, 'not_claimed');
    assert.equal(report.launch.artifactEvidence.status, 'pass');
    assert.ok(report.files.some((file) => file.endsWith('classifier-artifact-evidence-verify.json')));
    assert.doesNotMatch(result.stdout, promptLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release command core mode emits no-accelerator-claim proof pack', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-cli-core-'));
  const outDir = join(dir, 'pack');
  try {
    const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'release', '--core', '--out', outDir, '--telemetry', join(dir, 'missing-events.jsonl'), '--no-smoke', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 3000
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.core, true);
    assert.equal(report.launch.evidence.status, 'not_claimed');
    assert.ok(report.files.some((file) => file.endsWith('launch-copy.md')));
    assert.doesNotMatch(result.stdout, promptLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('release command fails stale classifier evidence from freshness flag', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-release-cli-stale-'));
  const outDir = join(dir, 'pack');
  const evidencePath = join(dir, 'classifier-evidence.json');
  try {
    await writeFile(evidencePath, `${JSON.stringify(await fixtureEvidence({ generatedAt: '2000-01-01T00:00:00.000Z' }), null, 2)}\n`, 'utf8');
    const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'release', '--out', outDir, '--telemetry', join(dir, 'missing-events.jsonl'), '--evidence', evidencePath, '--max-evidence-age-hours', '1', '--no-smoke', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5000
    });
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, 'proofroute-release-proof-pack-v1');
    assert.equal(report.status, 'fail');
    assert.equal(report.launch.evidence.checks.find((check) => check.id === 'evidence_freshness').pass, false);
    assert.doesNotMatch(result.stdout, promptLeakPattern);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function fakeGithubFetch(profile) {
  return async (url) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace('/repos/Lling0000/proofroute', '');
    if (path === '/topics') return jsonResponse({ names: profile.github.topics });
    return jsonResponse({
      html_url: 'https://github.com/Lling0000/proofroute',
      description: profile.github.description,
      homepage: profile.github.homepage
    });
  };
}

function fakePublicFaceFetch({ githubStatus, github, npmStatus, npm }) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'api.github.com') return jsonResponse(github, githubStatus);
    if (parsed.hostname === 'registry.npmjs.org') return jsonResponse(npm, npmStatus);
    if (parsed.hostname === 'github.com' && parsed.pathname.endsWith('/badge.svg')) return textResponse('<svg></svg>');
    if (parsed.hostname === 'img.shields.io') return textResponse('<svg></svg>');
    return jsonResponse({ message: 'not found' }, 404);
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function textResponse(payload, status = 200) {
  return new Response(payload, { status, headers: { 'content-type': 'image/svg+xml' } });
}

function fakeGitRunner({ status = '' } = {}) {
  const outputs = new Map([
    ['rev-parse\u0000--show-toplevel', `${process.cwd()}\n`],
    ['rev-parse\u0000--abbrev-ref\u0000HEAD', 'main\n'],
    ['rev-parse\u0000HEAD', 'abc123def456abc123def456abc123def456abcd\n'],
    ['log\u0000-1\u0000--format=%cI', '2026-05-31T12:00:00+00:00\n'],
    ['status\u0000--porcelain', status]
  ]);
  return async (args) => outputs.get(args.join('\u0000')) ?? '';
}

async function fixtureEvidence({ generatedAt = new Date().toISOString() } = {}) {
  const artifactPath = 'examples/linear-intent-model.json';
  const bytes = await readFile(artifactPath);
  return {
    status: 'pass',
    evidence: {
      kind: 'proofroute-classifier-evidence-v1',
      generatedAt,
      classifier: {
        status: 'pass'
      },
      benchmark: {
        deviceProfileCount: 1
      },
      gates: [
        { id: 'device_profiles', label: 'device profiles', pass: true, value: 1, target: 1, direction: 'min', unit: 'count' }
      ],
      deviceProfiles: [
        { id: '0', name: 'Fixture GPU' }
      ],
      artifacts: [
        {
          env: 'PROOFROUTE_ACCELERATOR_MODEL',
          path: artifactPath,
          status: 'hashed',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex')
        }
      ]
    }
  };
}

async function fixtureArtifactOnlyEvidence({ generatedAt = new Date().toISOString() } = {}) {
  const artifactPath = 'examples/linear-intent-model.json';
  const bytes = await readFile(artifactPath);
  return {
    status: 'pass',
    evidence: {
      kind: 'proofroute-classifier-evidence-v1',
      generatedAt,
      classifier: {
        status: 'pass'
      },
      benchmark: {
        p95Ms: 1.5,
        accuracy: 1
      },
      gates: [
        { id: 'p95_latency', label: 'p95 latency', pass: true, value: 1.5, target: 200, direction: 'max', unit: 'ms' },
        { id: 'accuracy', label: 'accuracy', pass: true, value: 1, target: 0.8, direction: 'min', unit: 'ratio' }
      ],
      artifacts: [
        {
          env: 'PROOFROUTE_ACCELERATOR_MODEL',
          path: artifactPath,
          status: 'hashed',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex')
        }
      ]
    }
  };
}
