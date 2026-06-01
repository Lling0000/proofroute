import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishReadinessReport } from '../src/agent/publish-readiness.js';
import { renderPublishReadiness, renderPublishSupportNote } from '../src/view/terminal.js';

test('publish readiness passes when package, npm, auth, and Actions evidence are present', async () => {
  const report = await publishReadinessReport({
    checkActions: true,
    runner: fakePublishRunner({
      auth: true,
      actionsRuns: [{ workflowName: 'ProofRoute CI', status: 'completed', conclusion: 'success', headSha: 'abc123' }]
    })
  });
  assert.equal(report.kind, 'proofroute-publish-readiness-v1');
  assert.equal(report.status, 'pass');
  assert.equal(report.npm.pack.pass, true);
  assert.equal(report.npm.publishDryRun.pass, true);
  assert.equal(report.npm.auth.pass, true);
  assert.equal(report.actions.summary.pass, true);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.nextActions, []);
  const output = renderPublishReadiness(report);
  assert.match(output, /PUBLISH READINESS/);
  assert.match(output, /npm publish dry-run/);
  assert.match(output, /GitHub Actions/);
});

test('publish readiness fails when npm auth and CI evidence are missing', async () => {
  const report = await publishReadinessReport({
    checkActions: true,
    runner: fakePublishRunner({ auth: false, actionsRuns: [] })
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.checks.find((check) => check.id === 'npm_auth').pass, false);
  assert.equal(report.checks.find((check) => check.id === 'github_actions').pass, false);
  assert.deepEqual(report.blockers.map((blocker) => blocker.id), ['npm_auth_missing', 'github_actions_not_passing']);
  assert.deepEqual(report.nextActions.map((action) => action.forBlocker), ['npm_auth_missing', 'github_actions_not_passing']);
  assert.match(report.npm.auth.detail, /auth is missing/);
  assert.doesNotMatch(JSON.stringify(report), /NODE_AUTH_TOKEN|secret-token/);
});

test('publish readiness can probe workflow dispatch errors explicitly', async () => {
  const report = await publishReadinessReport({
    checkActions: true,
    probeActionsDispatch: true,
    runner: fakePublishRunner({
      auth: true,
      dispatchError: 'Actions has been disabled for this user'
    })
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.actions.dispatch.ok, false);
  assert.match(report.actions.summary.detail, /dispatch probe failed/);
  assert.match(report.actions.summary.detail, /Actions has been disabled/);
  assert.ok(report.blockers.some((blocker) => blocker.id === 'github_actions_disabled'));
});

test('publish readiness contrasts authenticated GitHub visibility with anonymous public face', async () => {
  const report = await publishReadinessReport({
    checkPublic: true,
    runner: fakePublishRunner({ auth: true }),
    fetchImpl: fakePublicFaceFetch({
      githubOwnerStatus: 404,
      githubStatus: 404,
      npmStatus: 404
    })
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.github.summary.pass, true);
  assert.equal(report.github.repository.visibility, 'PUBLIC');
  assert.equal(report.account.summary.pass, true);
  assert.equal(report.public.github.owner.status, 404);
  assert.equal(report.checks.find((check) => check.id === 'github_authenticated').pass, true);
  assert.equal(report.checks.find((check) => check.id === 'github_account_visibility').pass, true);
  assert.equal(report.checks.find((check) => check.id === 'public_face').pass, false);
  assert.ok(report.blockers.some((blocker) => blocker.id === 'public_face_404' && blocker.evidence.githubStatus === 404 && blocker.evidence.npmStatus === 404));
  const output = renderPublishReadiness(report);
  assert.match(output, /github auth/);
  assert.match(output, /account/);
  assert.match(output, /public face/);
});

test('publish readiness reports account-level GitHub visibility blockers', async () => {
  const report = await publishReadinessReport({
    checkPublic: true,
    runner: fakePublishRunner({
      auth: true,
      accountSearchError: 'User flagged as spammy'
    }),
    fetchImpl: fakePublicFaceFetch({
      githubOwnerStatus: 404,
      githubStatus: 404,
      npmStatus: 404
    })
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.github.summary.pass, true);
  assert.equal(report.account.summary.pass, false);
  assert.equal(report.account.blocker, 'account_flagged_as_spammy');
  assert.match(report.account.summary.detail, /flagged by GitHub search as spammy/);
  assert.match(report.account.output.stdout, /User flagged as spammy/);
  assert.ok(report.blockers.some((blocker) => blocker.id === 'github_account_flagged_spammy' && /Support/.test(blocker.nextAction)));
  assert.ok(report.blockers.some((blocker) => blocker.supportMessage?.includes('flagged as spammy')));
  assert.ok(report.nextActions.some((action) => action.forBlocker === 'github_account_flagged_spammy'));
  assert.equal(report.checks.find((check) => check.id === 'github_account_visibility').pass, false);
  const output = renderPublishReadiness(report);
  assert.match(output, /account_flagged_as_spammy/);
  assert.match(output, /next actions/);
  const supportNote = renderPublishSupportNote(report);
  assert.match(supportNote, /My account owns Lling0000\/proofroute/);
  assert.match(supportNote, /flagged as spammy/);
  assert.doesNotMatch(supportNote, /Actions has been disabled for this user/);
  assert.doesNotMatch(supportNote, /PUBLISH READINESS|\x1b\[/);
  assert.doesNotMatch(supportNote, /NODE_AUTH_TOKEN|secret-token/);
});

test('publish support note includes Actions restrictions only with dispatch evidence', async () => {
  const report = await publishReadinessReport({
    checkPublic: true,
    checkActions: true,
    probeActionsDispatch: true,
    runner: fakePublishRunner({
      auth: true,
      accountSearchError: 'User flagged as spammy',
      dispatchError: 'Actions has been disabled for this user'
    }),
    fetchImpl: fakePublicFaceFetch({
      githubOwnerStatus: 404,
      githubStatus: 404,
      npmStatus: 404
    })
  });
  const supportNote = renderPublishSupportNote(report);
  assert.match(supportNote, /My account owns Lling0000\/proofroute/);
  assert.match(supportNote, /flagged as spammy/);
  assert.match(supportNote, /Actions has been disabled for this user/);
  assert.ok(report.blockers.some((blocker) => blocker.id === 'github_actions_disabled'));
  assert.doesNotMatch(supportNote, /PUBLISH READINESS|\x1b\[/);
  assert.doesNotMatch(supportNote, /NODE_AUTH_TOKEN|secret-token/);
});

test('publish support note redacts secrets and terminal control codes', () => {
  const supportNote = renderPublishSupportNote({
    generatedAt: '2026-06-01T00:00:00.000Z',
    status: 'fail',
    package: {
      name: 'proofroute',
      version: '0.1.0',
      repository: 'https://user:pass@github.com/Lling0000/proofroute'
    },
    blockers: [{
      id: 'npm_auth_missing',
      detail: 'npm auth failed at https://user:pass@registry.npmjs.org/?_authToken=secret-token /Users/alice/.npm/_logs/debug.log \x1b[31mred',
      supportMessage: 'Authorization: Bearer sk-secret-production-key NODE_AUTH_TOKEN=secret-token github_pat_123456789012345678901234567890'
    }],
    nextActions: [{
      forBlocker: 'npm_auth_missing',
      summary: 'Run NODE_AUTH_TOKEN=secret-token npm login --registry https://user:pass@registry.npmjs.org/?token=secret-token',
      command: 'NODE_AUTH_TOKEN=secret-token npm login --registry https://user:pass@registry.npmjs.org/?token=secret-token'
    }]
  });
  assert.match(supportNote, /<redacted>/);
  assert.doesNotMatch(supportNote, /secret-token|user:pass|sk-secret-production-key|\/Users\/alice|\x1b\[31m|github_pat_123456789012345678901234567890/);
});

test('publish CLI renders support note while json keeps priority', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-publish-'));
  const npmPath = join(dir, 'npm-fake.mjs');
  const pack = JSON.stringify([fakePackReport()]);
  await writeFile(npmPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('11.16.0');
} else if (args[0] === 'pack') {
  console.log(${JSON.stringify(pack)});
} else if (args[0] === 'publish') {
  console.log('+ proofroute@0.1.0');
} else if (args[0] === 'whoami') {
  console.error('npm error code ENEEDAUTH');
  process.exit(1);
} else {
  console.error('unexpected fake npm command ' + args.join(' '));
  process.exit(2);
}
`, 'utf8');
  await chmod(npmPath, 0o755);
  try {
    const support = spawnSync(process.execPath, ['./bin/proofroute.js', 'publish', '--npm', npmPath, '--support-note'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8'
    });
    assert.equal(support.status, 1);
    assert.match(support.stdout, /ProofRoute publish support note/);
    assert.doesNotMatch(support.stdout, /PUBLISH READINESS|\x1b\[/);
    const json = spawnSync(process.execPath, ['./bin/proofroute.js', 'publish', '--npm', npmPath, '--support-note', '--json'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8'
    });
    assert.equal(json.status, 1);
    assert.doesNotMatch(json.stdout, /ProofRoute publish support note/);
    assert.equal(JSON.parse(json.stdout).kind, 'proofroute-publish-readiness-v1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('publish readiness reports a missing npm CLI before package commands run', async () => {
  const report = await publishReadinessReport({
    runner: async () => {
      const error = new Error('spawn npm ENOENT');
      error.code = 'ENOENT';
      throw error;
    }
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.npm.cli.pass, false);
  assert.equal(report.npm.pack.skipped, true);
  assert.equal(report.npm.publishDryRun.skipped, true);
  assert.equal(report.npm.auth.skipped, true);
});

function fakePublishRunner({ auth = true, actionsRuns = [], dispatchError, accountSearchError, accountSearchItems = [{ full_name: 'Lling0000/proofroute' }] } = {}) {
  return async (command, args) => {
    if (command === 'npm' && args[0] === '--version') {
      return { stdout: '11.16.0\n', stderr: '' };
    }
    if (command === 'npm' && args[0] === 'pack') {
      return { stdout: `${JSON.stringify([fakePackReport()])}\n`, stderr: '' };
    }
    if (command === 'npm' && args[0] === 'publish') {
      return { stdout: '+ proofroute@0.1.0\n', stderr: 'npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)\n' };
    }
    if (command === 'npm' && args[0] === 'whoami') {
      if (auth) return { stdout: 'proofroute-maintainer\n', stderr: '' };
      const error = new Error('npm auth missing');
      error.code = 1;
      error.stderr = 'npm error code ENEEDAUTH\nnpm error need auth This command requires you to be logged in.\n';
      throw error;
    }
    if (command === 'gh' && args[0] === 'api' && args.includes('/search/repositories')) {
      if (!accountSearchError) return { stdout: `${JSON.stringify({ total_count: accountSearchItems.length, items: accountSearchItems })}\n`, stderr: '' };
      const error = new Error('GitHub account visibility failed');
      error.code = 1;
      error.stdout = `${JSON.stringify({
        message: 'Validation Failed',
        errors: [{ message: accountSearchError, resource: 'Search', field: 'q', code: 'invalid' }],
        status: '422'
      })}\n`;
      error.stderr = 'gh: Validation Failed (HTTP 422)\n';
      throw error;
    }
    if (command === 'gh' && args[0] === 'api') {
      return { stdout: '{"enabled":true,"allowed_actions":"all"}\n', stderr: '' };
    }
    if (command === 'gh' && args[0] === 'repo') {
      return {
        stdout: `${JSON.stringify({
          nameWithOwner: 'Lling0000/proofroute',
          visibility: 'PUBLIC',
          isPrivate: false,
          url: 'https://github.com/Lling0000/proofroute',
          pushedAt: '2026-06-01T00:00:00Z'
        })}\n`,
        stderr: ''
      };
    }
    if (command === 'gh' && args[0] === 'workflow') {
      if (!dispatchError) return { stdout: '', stderr: '' };
      const error = new Error(dispatchError);
      error.code = 1;
      error.stderr = dispatchError;
      throw error;
    }
    if (command === 'gh' && args[0] === 'run') {
      return { stdout: `${JSON.stringify(actionsRuns)}\n`, stderr: '' };
    }
    throw new Error(`unexpected command ${command} ${args.join(' ')}`);
  };
}

function fakePublicFaceFetch({ githubOwnerStatus = 200, githubStatus = 200, npmStatus = 200 }) {
  return async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'api.github.com' && parsed.pathname.startsWith('/users/')) {
      return jsonResponse({ message: githubOwnerStatus === 200 ? undefined : 'Not Found' }, githubOwnerStatus);
    }
    if (parsed.hostname === 'api.github.com') {
      return jsonResponse({
        description: 'ProofRoute is a CLI-first transparent LLM routing proxy that prints prompt-free receipts for cost, latency, privacy, and model choice.',
        homepage: 'https://github.com/Lling0000/proofroute#readme',
        topics: ['llm-router'],
        visibility: 'public',
        private: false,
        message: githubStatus === 200 ? undefined : 'Not Found'
      }, githubStatus);
    }
    if (parsed.hostname === 'registry.npmjs.org') {
      return jsonResponse({ message: npmStatus === 200 ? undefined : 'Not Found' }, npmStatus);
    }
    return textResponse('<svg></svg>', 200);
  };
}

function jsonResponse(body, status) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Map([['content-type', 'application/json']]),
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function textResponse(body, status) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Map([['content-type', 'image/svg+xml']]),
    json: async () => JSON.parse(body),
    text: async () => body
  };
}

function fakePackReport() {
  const files = [
    'bin/proofroute.js',
    'bin/proofroute-classifier.js',
    'src/agent/classifier-evidence.js',
    'src/agent/launch-readiness.js',
    'src/agent/release-pack.js',
    'src/agent/repository-profile.js',
    'README.md',
    'README.zh-CN.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'LICENSE',
    '.env.example'
  ];
  return {
    name: 'proofroute',
    version: '0.1.0',
    filename: 'proofroute-0.1.0.tgz',
    entryCount: files.length,
    files: files.map((path) => ({ path }))
  };
}
