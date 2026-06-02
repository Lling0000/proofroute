import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareGithubRepositoryState, desiredGithubRepositoryState, githubRepositoryStateReport, publicRepositoryFaceReport, readmeBadgeReport, repositoryProfileReport } from '../src/agent/repository-profile.js';
import { renderGithubRepositoryState, renderHelp, renderPublicRepositoryFace, renderRepositoryProfile } from '../src/view/terminal.js';

test('repository profile keeps public metadata executable and shareable', async () => {
  const report = await repositoryProfileReport();
  assert.equal(report.github.topics.length, 20);
  assert.equal(report.github.topics[0], 'llm-router');
  assert.match(report.github.description, /OpenAI-compatible LLM router/);
  assert.match(report.github.description, /coding agents/);
  assert.equal(report.github.homepage, 'https://github.com/Lling0000/proofroute#readme');
  assert.equal(report.github.repository, 'Lling0000/proofroute');
  assert.equal(report.npm.name, 'proofroute');
  assert.deepEqual(report.npm.binaries.map((entry) => entry.name), ['proofroute', 'proofroute-classifier']);
  assert.equal(report.npm.binaries.find((entry) => entry.name === 'proofroute-classifier').role, 'reference classifier sidecar');
  assert.ok(report.npm.keywords.includes('vibe-coding'));
  assert.match(report.npm.description, /coding agents/);
  assert.equal(report.social.badges.length, 4);
  assert.equal(report.social.badges[0].id, 'proof');
  assert.match(report.social.badges[0].image, /route%20split-zero--network/);
  assert.match(report.social.shortPitch, /zero-dependency OpenAI-compatible proxy/);
  assert.match(report.social.shortPitch, /local\/cloud split/);
  assert.match(report.commands.firstProof, /proofroute\.js demo/);
  assert.equal(report.commands.singleTrace, 'node ./bin/proofroute.js route --trace --markdown --prompt "why this model?"');
  assert.equal(report.commands.publicFace, 'node ./bin/proofroute.js profile --check-public');
  assert.equal(report.commands.npmDryRun, 'npm run release:npm:dry-run');
  assert.equal(report.commands.localPublishPreflight, 'node ./bin/proofroute.js publish --local-only');
  assert.equal(report.commands.publishPreflight, 'node ./bin/proofroute.js publish --check-public --check-actions');
  assert.equal(report.commands.publishSupportNote, 'node ./bin/proofroute.js publish --check-public --check-actions --probe-actions-dispatch --support-note');
  assert.equal(report.commands.publishSupportPack, 'node ./bin/proofroute.js publish --check-public --check-actions --probe-actions-dispatch --support-pack proofroute-publish-support-pack');
  assert.equal(report.commands.coreLaunch, 'node ./bin/proofroute.js launch --core');
  assert.equal(report.commands.publicLaunch, 'node ./bin/proofroute.js launch --check-public');
  assert.equal(report.commands.coreReleasePack, 'node ./bin/proofroute.js release --core --out proofroute-release-pack');
  assert.equal(report.commands.artifactReleasePack, 'node ./bin/proofroute.js release --core --require-artifact-evidence --artifact-evidence classifier-linear-evidence.json --max-evidence-age-hours 24 --out proofroute-release-pack');
  assert.equal(report.commands.releaseStrictPreflight, 'node ./bin/proofroute.js release --preflight --check-public --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24');
  assert.equal(report.commands.publicReleasePreflight, 'node ./bin/proofroute.js release --preflight --core --check-public');
  assert.equal(report.commands.artifactEvidenceGate, 'npm run classifier:artifact:evidence && npm run classifier:artifact:verify');
  assert.equal(report.commands.linearEvidenceGate, 'npm run classifier:linear:sidecar, then npm run classifier:linear:evidence && npm run classifier:linear:verify');
  assert.equal(report.commands.hardwareDoctor, 'node ./bin/proofroute.js doctor --strict-hardware');
  assert.equal(report.commands.hardwareEvidenceVerify, 'node ./bin/proofroute.js classifier --verify-evidence classifier-evidence.json --require-hardware-probe --max-evidence-age-hours 24');
  assert.equal(report.commands.repairLedger, 'node ./bin/proofroute.js repair --file .proofroute/events.jsonl --out .proofroute/events.repaired.jsonl');
  assert.equal(report.commands.launchReadiness, 'node ./bin/proofroute.js launch');
  assert.equal(report.commands.launchEvidenceGate, 'node ./bin/proofroute.js launch --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24');
  const output = renderRepositoryProfile(report);
  assert.match(output, /REPOSITORY FACE/);
  assert.match(output, /topics/);
  assert.match(output, /badges/);
  assert.match(output, /binaries/);
  assert.match(output, /proofroute-classifier/);
  assert.match(output, /short pitch/);
  assert.match(output, /public face/);
  assert.match(output, /local publish/);
  assert.match(output, /publish gate/);
  assert.match(output, /support note/);
  assert.match(output, /support pack/);
  assert.match(output, /single trace/);
  assert.match(output, /public launch/);
  assert.match(output, /public preflight/);
  assert.match(output, /npm dry run/);
  assert.match(output, /core launch/);
  assert.match(output, /launch ready/);
  assert.match(output, /proof gate/);
  assert.match(output, /ledger repair/);
  assert.match(renderHelp(), /proofroute profile/);
});

test('README first screen stays copy-pasteable from a source checkout', async () => {
  const english = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const chinese = await readFile(new URL('../README.zh-CN.md', import.meta.url), 'utf8');
  assertReadmeFirstRun(english, 'Quick Start');
  assertReadmeFirstRun(chinese, '快速开始');
});

test('npm keyword front matter keeps high-intent discovery tags near the top', async () => {
  const report = await repositoryProfileReport();
  const priority = [
    'llm-router',
    'ai-router',
    'inference-router',
    'openai-compatible',
    'transparent-proxy',
    'local-llm',
    'local-first',
    'coding-agent',
    'vibe-coding',
    'cost-optimization',
    'prompt-privacy'
  ];
  const indexes = priority.map((keyword) => report.npm.keywords.indexOf(keyword));
  assert.ok(indexes.every((index) => index >= 0));
  assert.ok(Math.max(...indexes) < 16);
});

test('profile command emits machine-readable repository face metadata', () => {
  const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'profile', '--json'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.github.topics.length, 20);
  assert.deepEqual(report.npm.binaries.map((entry) => entry.name), ['proofroute', 'proofroute-classifier']);
  assert.equal(report.commands.publicFace, 'node ./bin/proofroute.js profile --check-public');
  assert.equal(report.commands.singleTrace, 'node ./bin/proofroute.js route --trace --markdown --prompt "why this model?"');
  assert.equal(report.commands.npmDryRun, 'npm run release:npm:dry-run');
  assert.equal(report.commands.localPublishPreflight, 'node ./bin/proofroute.js publish --local-only');
  assert.equal(report.commands.publishPreflight, 'node ./bin/proofroute.js publish --check-public --check-actions');
  assert.equal(report.commands.publishSupportNote, 'node ./bin/proofroute.js publish --check-public --check-actions --probe-actions-dispatch --support-note');
  assert.equal(report.commands.publishSupportPack, 'node ./bin/proofroute.js publish --check-public --check-actions --probe-actions-dispatch --support-pack proofroute-publish-support-pack');
  assert.equal(report.commands.coreLaunch, 'node ./bin/proofroute.js launch --core');
  assert.equal(report.commands.publicLaunch, 'node ./bin/proofroute.js launch --check-public');
  assert.equal(report.commands.coreReleasePack, 'node ./bin/proofroute.js release --core --out proofroute-release-pack');
  assert.equal(report.commands.artifactReleasePack, 'node ./bin/proofroute.js release --core --require-artifact-evidence --artifact-evidence classifier-linear-evidence.json --max-evidence-age-hours 24 --out proofroute-release-pack');
  assert.equal(report.commands.releaseStrictPreflight, 'node ./bin/proofroute.js release --preflight --check-public --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24');
  assert.equal(report.commands.publicReleasePreflight, 'node ./bin/proofroute.js release --preflight --core --check-public');
  assert.equal(report.commands.artifactEvidenceGate, 'npm run classifier:artifact:evidence && npm run classifier:artifact:verify');
  assert.equal(report.commands.linearEvidenceGate, 'npm run classifier:linear:sidecar, then npm run classifier:linear:evidence && npm run classifier:linear:verify');
  assert.equal(report.commands.hardwareDoctor, 'node ./bin/proofroute.js doctor --strict-hardware');
  assert.equal(report.commands.hardwareEvidenceVerify, 'node ./bin/proofroute.js classifier --verify-evidence classifier-evidence.json --require-hardware-probe --max-evidence-age-hours 24');
  assert.equal(report.commands.repairLedger, 'node ./bin/proofroute.js repair --file .proofroute/events.jsonl --out .proofroute/events.repaired.jsonl');
  assert.equal(report.commands.launchReadiness, 'node ./bin/proofroute.js launch');
  assert.equal(report.commands.launchEvidenceGate, 'node ./bin/proofroute.js launch --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24');
  assert.equal(report.commands.shareSvg, 'node ./bin/proofroute.js share --svg --out docs/proofroute-terminal.svg');
});

test('CLI accepts equals-style flags for copy-pasteable first proof commands', () => {
  const result = spawnSync(process.execPath, ['./bin/proofroute.js', 'route', '--prompt=fix this flaky test', '--json'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.intent.name, 'code');
  assert.ok(report.model.id);
});

test('public repository face check reports GitHub and npm visibility without credentials', async () => {
  const profile = await repositoryProfileReport();
  const fetch = fakePublicFaceFetch({
    githubStatus: 200,
    github: {
      html_url: 'https://github.com/Lling0000/proofroute',
      description: profile.github.description,
      homepage: profile.github.homepage,
      topics: profile.github.topics
    },
    npmStatus: 200,
    npm: {
      name: profile.npm.name,
      description: profile.npm.description,
      'dist-tags': { latest: profile.npm.version },
      repository: { url: profile.npm.repository },
      versions: {
        [profile.npm.version]: {
          description: profile.npm.description,
          repository: { url: profile.npm.repository }
        }
      }
    }
  });
  const report = await publicRepositoryFaceReport({
    fetchImpl: fetch
  });
  assert.equal(report.kind, 'proofroute-public-repository-face-v1');
  assert.equal(report.status, 'pass');
  assert.ok(report.checks.every((check) => check.pass));
  assert.equal(report.badges.status, 'pass');
  assert.equal(report.checks.find((check) => check.id === 'github_owner_public').pass, true);
  assert.equal(report.checks.find((check) => check.id === 'npm_version').pass, true);
  assert.ok(fetch.calls.every((call) => !hasSensitivePublicHeader(call.options?.headers)));
  const output = renderPublicRepositoryFace(report);
  assert.match(output, /PUBLIC REPOSITORY FACE/);
  assert.match(output, /public GitHub repository/);
  assert.doesNotMatch(JSON.stringify(report), /secret-token|authorization/i);
});

test('public repository face check fails when GitHub or npm is not publicly visible', async () => {
  const report = await publicRepositoryFaceReport({
    fetchImpl: fakePublicFaceFetch({
      githubStatus: 404,
      github: { message: 'Not Found' },
      npmStatus: 404,
      npm: { error: 'Not found' }
    })
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.checks.find((check) => check.id === 'github_public').pass, false);
  assert.equal(report.checks.find((check) => check.id === 'npm_public').pass, false);
  assert.equal(report.github.reason, 'not_found');
  assert.equal(report.npm.reason, 'not_found');
  const output = renderPublicRepositoryFace(report);
  assert.match(output, /FAIL/);
  assert.doesNotMatch(JSON.stringify(report), /secret-token|authorization/i);
});

test('public repository face reports owner visibility separately from repository visibility', async () => {
  const profile = await repositoryProfileReport();
  const report = await publicRepositoryFaceReport({
    fetchImpl: fakePublicFaceFetch({
      githubOwnerStatus: 404,
      githubOwner: { message: 'Not Found' },
      githubStatus: 404,
      github: { message: 'Not Found' },
      npmStatus: 200,
      npm: {
        name: profile.npm.name,
        description: profile.npm.description,
        'dist-tags': { latest: profile.npm.version },
        repository: { url: profile.npm.repository },
        versions: {
          [profile.npm.version]: {
            description: profile.npm.description,
            repository: { url: profile.npm.repository }
          }
        }
      }
    })
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.github.owner.status, 404);
  assert.equal(report.github.owner.reason, 'not_found');
  assert.equal(report.checks.find((check) => check.id === 'github_owner_public').pass, false);
  assert.equal(report.checks.find((check) => check.id === 'github_public').pass, false);
});

test('public repository face check fails when npm latest version drifts', async () => {
  const profile = await repositoryProfileReport();
  const fetch = fakePublicFaceFetch({
    githubStatus: 200,
    github: {
      html_url: 'https://github.com/Lling0000/proofroute',
      description: profile.github.description,
      homepage: profile.github.homepage,
      topics: profile.github.topics
    },
    npmStatus: 200,
    npm: {
      name: profile.npm.name,
      description: profile.npm.description,
      'dist-tags': { latest: '0.0.1' },
      repository: { url: profile.npm.repository },
      versions: {
        '0.0.1': {
          description: profile.npm.description,
          repository: { url: profile.npm.repository }
        }
      }
    }
  });
  const report = await publicRepositoryFaceReport({ fetchImpl: fetch });
  assert.equal(report.status, 'fail');
  assert.equal(report.npm.latest, '0.0.1');
  assert.equal(report.checks.find((check) => check.id === 'npm_version').pass, false);
  assert.equal(report.checks.find((check) => check.id === 'npm_metadata').pass, true);
});

test('README badge report rejects missing first-screen badges', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-badges-'));
  const readme = join(directory, 'README.md');
  try {
    await writeFile(readme, '# ProofRoute\n\nProof without badges.\n');
    const report = await readmeBadgeReport({ readmePath: readme, checkImages: false });
    assert.equal(report.status, 'fail');
    assert.equal(report.expected.length, 4);
    assert.equal(report.missing.length, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('GitHub repository face comparison detects topic drift without caring about order', async () => {
  const profile = await repositoryProfileReport();
  const desired = desiredGithubRepositoryState(profile);
  const current = {
    repository: desired.repository,
    description: desired.description,
    homepage: desired.homepage,
    topics: ['extra-topic', ...desired.topics.slice().reverse().filter((topic) => topic !== 'tensorrt')]
  };
  const comparison = compareGithubRepositoryState(desired, current);
  assert.equal(comparison.status, 'fail');
  assert.deepEqual(comparison.missingTopics, ['tensorrt']);
  assert.deepEqual(comparison.extraTopics, ['extra-topic']);
});

test('GitHub repository face check reports remote drift without leaking tokens', async () => {
  const remote = fakeGithubRemote({
    description: 'old description',
    homepage: '',
    topics: ['llm-router', 'old-topic']
  });
  const report = await githubRepositoryStateReport({
    mode: 'check',
    repo: 'Lling0000/proofroute',
    token: 'secret-token',
    fetchImpl: remote.fetch
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.changed, false);
  assert.deepEqual(report.operations, []);
  assert.ok(report.comparison.missingTopics.includes('ai-gateway'));
  assert.ok(report.comparison.extraTopics.includes('old-topic'));
  assert.doesNotMatch(JSON.stringify(report), /secret-token/);
  const output = renderGithubRepositoryState(report);
  assert.match(output, /GITHUB REPOSITORY FACE/);
  assert.match(output, /FAIL/);
});

test('GitHub repository face sync replaces About metadata and topics', async () => {
  const remote = fakeGithubRemote({
    description: 'old description',
    homepage: '',
    topics: ['old-topic']
  });
  const report = await githubRepositoryStateReport({
    mode: 'sync',
    repo: 'Lling0000/proofroute',
    token: 'secret-token',
    fetchImpl: remote.fetch
  });
  assert.equal(report.status, 'pass');
  assert.equal(report.changed, true);
  assert.deepEqual(report.operations, ['metadata', 'topics']);
  assert.equal(remote.state.description, report.desired.description);
  assert.equal(remote.state.homepage, report.desired.homepage);
  assert.deepEqual(remote.state.topics, report.desired.topics);
  assert.ok(remote.calls.some((call) => call.method === 'PATCH' && call.path === ''));
  assert.ok(remote.calls.some((call) => call.method === 'PUT' && call.path === '/topics'));
  assert.doesNotMatch(JSON.stringify(report), /secret-token/);
});

function assertReadmeFirstRun(readme, heading) {
  const firstScreen = readme.split(/\r?\n/).slice(0, 28).join('\n');
  assert.match(firstScreen, /docs\/proofroute-terminal\.svg/);
  assert.match(firstScreen, /node \.\/bin\/proofroute\.js demo/);
  const quickStart = readme.match(new RegExp(`## ${heading}[\\s\\S]*?\`\`\`sh\\n([\\s\\S]*?)\\n\`\`\``));
  assert.ok(quickStart);
  assert.match(quickStart[1], /node \.\/bin\/proofroute\.js demo/);
  assert.doesNotMatch(quickStart[1], /^proofroute demo$/m);
}

function fakeGithubRemote(initial) {
  const state = {
    description: initial.description,
    homepage: initial.homepage,
    topics: initial.topics
  };
  const calls = [];
  return {
    state,
    calls,
    fetch: async (url, options = {}) => {
      const parsed = new URL(url);
      const path = parsed.pathname.replace('/repos/Lling0000/proofroute', '');
      const method = options.method ?? 'GET';
      calls.push({ method, path, body: options.body ? JSON.parse(options.body) : undefined });
      if (path === '/topics' && method === 'GET') return jsonResponse({ names: state.topics });
      if (path === '/topics' && method === 'PUT') {
        state.topics = JSON.parse(options.body).names;
        return jsonResponse({ names: state.topics });
      }
      if (path === '' && method === 'PATCH') {
        const body = JSON.parse(options.body);
        state.description = body.description;
        state.homepage = body.homepage;
        return jsonResponse({ html_url: 'https://github.com/Lling0000/proofroute', description: state.description, homepage: state.homepage });
      }
      if (path === '' && method === 'GET') return jsonResponse({ html_url: 'https://github.com/Lling0000/proofroute', description: state.description, homepage: state.homepage });
      return jsonResponse({ message: 'not found' }, 404);
    }
  };
}

function fakePublicFaceFetch({ githubStatus, github, githubOwnerStatus = 200, githubOwner = { login: 'Lling0000' }, npmStatus, npm, badgeStatus = 200 }) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    if (parsed.hostname === 'api.github.com' && parsed.pathname.startsWith('/users/')) return jsonResponse(githubOwner, githubOwnerStatus);
    if (parsed.hostname === 'api.github.com') return jsonResponse(github, githubStatus);
    if (parsed.hostname === 'registry.npmjs.org') return jsonResponse(npm, npmStatus);
    if (parsed.hostname === 'github.com' && parsed.pathname.endsWith('/badge.svg')) return textResponse('<svg></svg>', badgeStatus);
    if (parsed.hostname === 'img.shields.io') return textResponse('<svg></svg>', badgeStatus);
    return jsonResponse({ message: 'not found' }, 404);
  };
  fetch.calls = calls;
  return fetch;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

function textResponse(payload, status = 200) {
  return new Response(payload, { status, headers: { 'content-type': 'image/svg+xml' } });
}

function hasSensitivePublicHeader(headers = {}) {
  return Object.keys(headers).some((name) => /^(authorization|cookie)$/i.test(name));
}
