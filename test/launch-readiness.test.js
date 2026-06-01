import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchReadinessReport } from '../src/agent/launch-readiness.js';
import { repositoryProfileReport } from '../src/agent/repository-profile.js';
import { AgentRuntime } from '../src/agent/runtime.js';
import { demoCatalog } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';
import { renderHelp, renderLaunchReadiness } from '../src/view/terminal.js';

test('launch readiness summarizes local proof surfaces without prompt text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-launch-readiness-'));
  const telemetryPath = join(dir, 'missing-events.jsonl');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const report = await launchReadinessReport({
      controller,
      runtime,
      telemetryPath,
      smoke: false,
      evidencePath: join(dir, 'missing-evidence.json')
    });
    assert.equal(report.status, 'warn');
    assert.deepEqual(report.checks.map((check) => check.id), [
      'repository_face',
      'zero_network_proof',
      'proxy_smoke',
      'privacy_boundary',
      'share_assets',
      'classifier_evidence'
    ]);
    assert.equal(report.checks.find((check) => check.id === 'zero_network_proof').status, 'pass');
    assert.equal(report.checks.find((check) => check.id === 'privacy_boundary').status, 'pass');
    assert.equal(report.checks.find((check) => check.id === 'classifier_evidence').status, 'warn');
    assert.equal(report.profile.topicCount, 20);
    assert.equal(report.proof.status, 'pass');
    assert.equal(report.privacy.status, 'pass');
    assert.equal(report.assets.length, 3);
    assert.ok(report.assets.every((asset) => asset.status === 'present'));
    assert.ok(report.assets.every((asset) => asset.width === 1200 && asset.height === 720));
    assert.match(report.assets.find((asset) => asset.path === 'docs/proofroute-terminal.svg').title, /ProofRoute/);
    const output = renderLaunchReadiness(report);
    assert.match(output, /LAUNCH READINESS/);
    assert.match(output, /zero-network proof/);
    assert.match(output, /classifier evidence/);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${output}`, /Refactor this webhook|Extract customer ids|Rewrite this README/);
    assert.match(renderHelp(), /proofroute launch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('launch readiness rejects invalid share SVG proof assets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-launch-assets-'));
  const docsDir = join(dir, 'docs');
  try {
    await mkdir(docsDir, { recursive: true });
    await writeFile(join(docsDir, 'proofroute-terminal.svg'), '<svg width="100" height="100"><title>Not ProofRoute</title></svg>\n', 'utf8');
    await writeFile(join(docsDir, 'proofroute-classifier.svg'), await readFile('docs/proofroute-classifier.svg', 'utf8'), 'utf8');
    await writeFile(join(docsDir, 'proofroute-classifier-benchmark.svg'), await readFile('docs/proofroute-classifier-benchmark.svg', 'utf8'), 'utf8');
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const report = await launchReadinessReport({
      controller,
      runtime,
      cwd: dir,
      telemetryPath: join(dir, 'missing-events.jsonl'),
      smoke: false,
      evidencePath: join(dir, 'missing-evidence.json')
    });
    const shareCheck = report.checks.find((check) => check.id === 'share_assets');
    const invalidAsset = report.assets.find((asset) => asset.path === 'docs/proofroute-terminal.svg');
    assert.equal(report.status, 'fail');
    assert.equal(shareCheck.status, 'fail');
    assert.match(shareCheck.detail, /1 invalid/);
    assert.equal(invalidAsset.status, 'invalid');
    assert.match(invalidAsset.message, /expected 1200x720/);
    assert.match(invalidAsset.message, /expected title ProofRoute shareable routing proof/);
    assert.doesNotMatch(JSON.stringify(report), /Refactor this webhook|Extract customer ids|Rewrite this README/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('launch command emits machine-readable readiness proof', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-launch-cli-'));
  const telemetryPath = join(dir, 'missing-events.jsonl');
  try {
    const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'launch', '--telemetry', telemetryPath, '--no-smoke', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 2000
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, 'proofroute-launch-readiness-v1');
    assert.equal(report.status, 'warn');
    assert.equal(report.checks.find((check) => check.id === 'proxy_smoke').status, 'warn');
    assert.equal(report.checks.find((check) => check.id === 'privacy_boundary').status, 'pass');
    assert.doesNotMatch(result.stdout, /Refactor this webhook|Extract customer ids|Rewrite this README/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('launch command artifact evidence mode makes no hardware claim', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-launch-artifact-'));
  const telemetryPath = join(dir, 'missing-events.jsonl');
  const artifactEvidencePath = join(dir, 'classifier-linear-evidence.json');
  try {
    await writeFile(artifactEvidencePath, `${JSON.stringify(await fixtureArtifactOnlyEvidence(), null, 2)}\n`, 'utf8');
    const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'launch', '--require-artifact-evidence', '--artifact-evidence', artifactEvidencePath, '--max-evidence-age-hours', '24', '--telemetry', telemetryPath, '--no-smoke', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 3000
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, 'proofroute-launch-readiness-v1');
    assert.equal(report.evidence.status, 'not_claimed');
    assert.equal(report.evidence.claim, 'none');
    assert.equal(report.artifactEvidence.status, 'pass');
    assert.equal(report.artifactEvidence.claim, 'local_artifact');
    assert.equal(report.checks.find((check) => check.id === 'classifier_evidence').status, 'pass');
    assert.equal(report.checks.find((check) => check.id === 'classifier_artifact_evidence').status, 'pass');
    assert.doesNotMatch(result.stdout, /Refactor this webhook|Extract customer ids|Rewrite this README/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('launch readiness can include the live GitHub repository face gate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-launch-github-'));
  const telemetryPath = join(dir, 'missing-events.jsonl');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const profile = await repositoryProfileReport();
    const report = await launchReadinessReport({
      controller,
      runtime,
      telemetryPath,
      smoke: false,
      evidencePath: join(dir, 'missing-evidence.json'),
      github: true,
      githubRepo: 'Lling0000/proofroute',
      githubToken: 'secret-token',
      githubFetch: fakeGithubFetch(profile),
      githubEnv: {}
    });
    assert.equal(report.status, 'warn');
    assert.equal(report.github.status, 'pass');
    assert.equal(report.checks.find((check) => check.id === 'github_repository_face').status, 'pass');
    const output = renderLaunchReadiness(report);
    assert.match(output, /github face/);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${output}`, /secret-token|Refactor this webhook|Extract customer ids|Rewrite this README/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('launch readiness only runs public face gate when explicitly requested', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-launch-public-default-'));
  const telemetryPath = join(dir, 'missing-events.jsonl');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const report = await launchReadinessReport({
      controller,
      runtime,
      telemetryPath,
      smoke: false,
      evidencePath: join(dir, 'missing-evidence.json'),
      publicFetch: async () => {
        throw new Error('public fetch should not run by default');
      }
    });
    assert.equal(report.public, undefined);
    assert.equal(report.checks.some((check) => check.id === 'public_repository_face'), false);
    assert.equal(report.status, 'warn');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('launch readiness fails public face gate on anonymous GitHub or npm 404', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-launch-public-fail-'));
  const telemetryPath = join(dir, 'missing-events.jsonl');
  try {
    const config = demoCatalog();
    const controller = new RouteController(config);
    const runtime = new AgentRuntime(config);
    const report = await launchReadinessReport({
      controller,
      runtime,
      telemetryPath,
      smoke: false,
      evidencePath: join(dir, 'missing-evidence.json'),
      publicFace: true,
      publicFetch: fakePublicFaceFetch({
        githubStatus: 404,
        github: { message: 'Not Found' },
        npmStatus: 404,
        npm: { error: 'Not found' }
      })
    });
    assert.equal(report.status, 'fail');
    assert.equal(report.public.status, 'fail');
    assert.equal(report.public.github.status, 404);
    assert.equal(report.public.npm.status, 404);
    assert.equal(report.checks.find((check) => check.id === 'public_repository_face').status, 'fail');
    const output = renderLaunchReadiness(report);
    assert.match(output, /public face/);
    assert.doesNotMatch(`${JSON.stringify(report)}\n${output}`, /Refactor this webhook|Extract customer ids|Rewrite this README/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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

function fakeGithubFetch(profile) {
  return async (url, options = {}) => {
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
