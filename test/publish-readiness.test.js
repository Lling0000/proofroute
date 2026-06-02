import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishReadinessReport, writePublishSupportPack } from '../src/agent/publish-readiness.js';
import { renderPublishReadiness, renderPublishSupportNote } from '../src/view/terminal.js';

const currentTestSha = 'abc1230000000000000000000000000000000000';
const staleTestSha = 'def4560000000000000000000000000000000000';

test('publish readiness passes when package, npm, auth, and Actions evidence are present', async () => {
  const report = await publishReadinessReport({
    checkActions: true,
    runner: fakePublishRunner({
      auth: true,
      actionsRuns: [{ workflowName: 'ProofRoute CI', status: 'completed', conclusion: 'success', headSha: currentTestSha }]
    })
  });
  assert.equal(report.kind, 'proofroute-publish-readiness-v1');
  assert.equal(report.status, 'pass');
  assert.equal(report.npm.pack.pass, true);
  assert.equal(report.npm.publishDryRun.pass, true);
  assert.equal(report.npm.auth.pass, true);
  assert.match(report.npm.metadata.detail, /configured for public npm access/);
  assert.doesNotMatch(report.npm.metadata.detail, /is public, has CLI bins/);
  assert.equal(report.npm.evidence.version, '11.16.0');
  assert.equal(report.npm.evidence.pack, 'pass');
  assert.equal(report.npm.evidence.requiredFilesMissing, 0);
  assert.equal(report.summary.localEvidence, 'pass');
  assert.equal(report.summary.remainingBlockerScope, 'none');
  assert.equal(report.actions.summary.pass, true);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.nextActions, []);
  const output = renderPublishReadiness(report);
  assert.match(output, /PUBLISH READINESS/);
  assert.match(output, /npm evidence/);
  assert.match(output, /local evidence/);
  assert.match(output, /npm publish dry-run/);
  assert.match(output, /GitHub Actions/);
  assert.doesNotMatch(output, /launch evidence/);
  assert.doesNotMatch(output, /--support-pack proofroute-publish-support-pack/);
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
  assert.equal(report.blockers.find((blocker) => blocker.id === 'npm_auth_missing').scope, 'operator_auth');
  assert.equal(report.summary.localEvidence, 'pass');
  assert.equal(report.summary.remainingBlockerScope, 'external_or_operator');
  assert.deepEqual(report.nextActions.map((action) => action.forBlocker), ['npm_auth_missing', 'github_actions_not_passing']);
  assert.match(report.npm.auth.detail, /auth is missing/);
  const output = renderPublishReadiness(report);
  assert.match(output, /support pack/);
  assert.match(output, /--support-pack proofroute-publish-support-pack/);
  assert.match(output, /status fails until blockers clear/);
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
  assert.ok(report.blockers.some((blocker) => blocker.id === 'github_actions_disabled' && blocker.supportMessage?.includes('account-level Actions restriction')));
  assert.match(renderPublishSupportNote(report), /Actions has been disabled for this user/);
});

test('publish readiness requires a passing run from the requested workflow', async () => {
  const report = await publishReadinessReport({
    checkActions: true,
    runner: fakePublishRunner({
      auth: true,
      actionsRuns: [{
        workflowName: 'Unrelated',
        status: 'completed',
        conclusion: 'success',
        headSha: currentTestSha
      }]
    })
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.actions.summary.pass, false);
  assert.match(report.actions.summary.detail, /ProofRoute CI runs 0/);
  assert.ok(report.blockers.some((blocker) => blocker.id === 'github_actions_not_passing'));
});

test('publish readiness rejects stale passing workflow runs from older commits', async () => {
  const report = await publishReadinessReport({
    checkActions: true,
    runner: fakePublishRunner({
      auth: true,
      actionsRuns: [{
        workflowName: 'ProofRoute CI',
        status: 'completed',
        conclusion: 'success',
        headSha: staleTestSha
      }]
    })
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.actions.summary.pass, false);
  assert.match(report.actions.summary.detail, /current head abc1230 no/);
  assert.equal(report.actions.head.sha, currentTestSha);
  assert.ok(report.blockers.some((blocker) => blocker.id === 'github_actions_not_passing' && blocker.evidence.headSha === currentTestSha));
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
  assert.ok(report.blockers.some((blocker) => blocker.id === 'public_face_404' && blocker.evidence.failedChecks.some((check) => check.id === 'github_public')));
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
  assert.equal(report.blockers.find((blocker) => blocker.id === 'github_account_flagged_spammy').scope, 'external_platform');
  assert.equal(report.summary.remainingBlockerScope, 'external_or_operator');
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
  assert.match(supportNote, /Npm evidence is command npm, version 11\.16\.0/);
  assert.match(supportNote, /Local publish evidence is pass with remaining scope external_or_operator/);
  assert.doesNotMatch(supportNote, /Actions restriction/);
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

test('publish support pack writes redacted evidence files without changing blocker status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'proofroute-publish-support-pack-'));
  const outDir = join(dir, 'pack');
  try {
    const report = {
      kind: 'proofroute-publish-readiness-v1',
      generatedAt: '2026-06-01T00:00:00.000Z',
      status: 'fail',
      package: {
        name: 'proofroute',
        version: '0.1.0',
        repository: 'https://user:pass@github.com/Lling0000/proofroute'
      },
      blockers: [{
        id: 'npm_auth_missing',
        detail: 'npm auth failed at /Users/alice/.npm/_logs/debug.log with NODE_AUTH_TOKEN=secret-token'
      }],
      nextActions: [{
        forBlocker: 'npm_auth_missing',
        summary: 'Run NODE_AUTH_TOKEN=secret-token npm login --registry https://user:pass@registry.npmjs.org/?token=secret-token'
      }],
      checks: []
    };
    const supportNote = renderPublishSupportNote(report);
    const pack = await writePublishSupportPack({ report, supportNote, outDir, now: '2026-06-01T00:01:00.000Z' });
    assert.equal(pack.kind, 'proofroute-publish-support-pack-v1');
    assert.equal(pack.status, 'fail');
    assert.equal(pack.readyToPublish, false);
    assert.deepEqual(pack.blockerIds, ['npm_auth_missing']);
    assert.equal(pack.statusSummary.kind, 'proofroute-publish-support-status-v1');
    assert.equal(pack.statusSummary.readyToPublish, false);
    assert.deepEqual(pack.statusSummary.blockerIds, ['npm_auth_missing']);
    assert.equal(pack.statusSummary.support.operatorActionRequired, false);
    assert.ok(existsSync(join(outDir, 'manifest.json')));
    assert.ok(existsSync(join(outDir, 'status.json')));
    assert.ok(existsSync(join(outDir, 'publish-readiness.json')));
    assert.ok(existsSync(join(outDir, 'publish-support-note.txt')));
    assert.ok(existsSync(join(outDir, 'next-actions.md')));
    assert.ok(existsSync(join(outDir, 'redaction-policy.txt')));
    const status = JSON.parse(await readFile(join(outDir, 'status.json'), 'utf8'));
    assert.equal(status.kind, 'proofroute-publish-support-status-v1');
    assert.equal(status.status, 'fail');
    assert.equal(status.readyToPublish, false);
    assert.equal(status.localEvidence, 'not_summarized');
    assert.equal(status.github.publicFace, 'not_checked');
    const combined = [
      await readFile(join(outDir, 'manifest.json'), 'utf8'),
      await readFile(join(outDir, 'status.json'), 'utf8'),
      await readFile(join(outDir, 'publish-readiness.json'), 'utf8'),
      await readFile(join(outDir, 'publish-support-note.txt'), 'utf8'),
      await readFile(join(outDir, 'next-actions.md'), 'utf8'),
      await readFile(join(outDir, 'redaction-policy.txt'), 'utf8')
    ].join('\n');
    assert.match(combined, /<redacted>|<redacted-secret>|<local-path>/);
    assert.doesNotMatch(combined, /secret-token|user:pass|\/Users\/alice|\x1b\[/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
    const packDir = join(dir, 'support-pack');
    const packJson = spawnSync(process.execPath, ['./bin/proofroute.js', 'publish', '--npm', npmPath, '--support-pack', packDir, '--json'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8'
    });
    assert.equal(packJson.status, 1);
    const packReport = JSON.parse(packJson.stdout);
    assert.equal(packReport.kind, 'proofroute-publish-readiness-v1');
    assert.equal(packReport.supportPack.kind, 'proofroute-publish-support-pack-v1');
    assert.equal(packReport.supportPack.status, 'fail');
    assert.equal(packReport.supportPack.statusSummary.kind, 'proofroute-publish-support-status-v1');
    assert.equal(packReport.supportPack.statusSummary.localEvidence, 'pass');
    assert.ok(existsSync(join(packDir, 'manifest.json')));
    assert.ok(existsSync(join(packDir, 'status.json')));
    assert.ok(existsSync(join(packDir, 'publish-readiness.json')));
    assert.ok(existsSync(join(packDir, 'publish-support-note.txt')));
    const packStatus = JSON.parse(await readFile(join(packDir, 'status.json'), 'utf8'));
    assert.equal(packStatus.readyToPublish, false);
    assert.equal(packStatus.localEvidence, 'pass');
    assert.deepEqual(packStatus.operatorBlockerIds, ['npm_auth_missing']);
    const renderedPack = renderPublishReadiness(packReport);
    assert.match(renderedPack, /support pack/);
    assert.doesNotMatch(renderedPack, /--support-pack proofroute-publish-support-pack/);
    const packNote = await readFile(join(packDir, 'publish-support-note.txt'), 'utf8');
    assert.match(packNote, /ProofRoute publish support note/);
    assert.match(packNote, /\nBlockers\n/);
    assert.doesNotMatch(packNote, /PUBLISH READINESS|\x1b\[/);
    const packSupportNote = spawnSync(process.execPath, ['./bin/proofroute.js', 'publish', '--npm', npmPath, '--support-note', '--support-pack', join(dir, 'support-pack-note')], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8'
    });
    assert.equal(packSupportNote.status, 1);
    assert.match(packSupportNote.stdout, /ProofRoute publish support note/);
    assert.ok(existsSync(join(dir, 'support-pack-note', 'manifest.json')));
    const missingDir = spawnSync(process.execPath, ['./bin/proofroute.js', 'publish', '--npm', npmPath, '--support-pack'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8'
    });
    assert.equal(missingDir.status, 1);
    assert.match(missingDir.stderr, /Pass --support-pack as a directory/);
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
  assert.equal(report.npm.evidence.cli, 'fail');
  assert.equal(report.npm.evidence.pack, 'skipped');
  assert.equal(report.summary.localEvidence, 'fail');
  assert.deepEqual(report.blockers.map((blocker) => blocker.id), ['npm_cli_missing']);
  assert.equal(report.nextActions[0].forBlocker, 'npm_cli_missing');
});

test('publish readiness turns npm package surface and dry-run failures into actions', async () => {
  const missingReadme = await publishReadinessReport({
    runner: fakePublishRunner({
      auth: true,
      packReport: fakePackReport({ omit: ['README.zh-CN.md'] })
    })
  });
  assert.equal(missingReadme.status, 'fail');
  assert.equal(missingReadme.npm.pack.pass, false);
  assert.deepEqual(missingReadme.npm.pack.missing, ['README.zh-CN.md']);
  assert.ok(missingReadme.blockers.some((blocker) => blocker.id === 'npm_package_surface_failed' && blocker.evidence.missing.includes('README.zh-CN.md')));
  assert.ok(missingReadme.nextActions.some((action) => action.forBlocker === 'npm_package_surface_failed'));

  const autoCorrected = await publishReadinessReport({
    runner: fakePublishRunner({
      auth: true,
      publishStderr: 'npm notice package errors corrected automatically during dry-run'
    })
  });
  assert.equal(autoCorrected.status, 'fail');
  assert.equal(autoCorrected.npm.publishDryRun.pass, false);
  assert.ok(autoCorrected.blockers.some((blocker) => blocker.id === 'npm_publish_dry_run_failed'));
  assert.ok(autoCorrected.nextActions.some((action) => action.forBlocker === 'npm_publish_dry_run_failed'));
});

test('publish readiness redacts command output before JSON reports expose it', async () => {
  const report = await publishReadinessReport({
    runner: async (command, args) => {
      if (command === 'npm' && args[0] === '--version') return { stdout: '11.16.0\n', stderr: '' };
      if (command === 'npm' && args[0] === 'pack') return { stdout: `${JSON.stringify([fakePackReport()])}\n`, stderr: '' };
      if (command === 'npm' && args[0] === 'publish') return { stdout: '+ proofroute@0.1.0\n', stderr: '' };
      if (command === 'npm' && args[0] === 'whoami') {
        const error = new Error('auth failed with NODE_AUTH_TOKEN=secret-token at /Users/alice/.npm/_logs/debug.log');
        error.code = 1;
        error.stderr = 'npm error auth failed at https://user:pass@registry.npmjs.org/?_authToken=secret-token Authorization: Bearer sk-secret-production-key /Users/alice/.npm/_logs/debug.log';
        throw error;
      }
      throw new Error(`unexpected command ${command} ${args.join(' ')}`);
    }
  });
  const encoded = JSON.stringify(report);
  assert.match(encoded, /<redacted>|<redacted-secret>|<local-path>|sk-<redacted>/);
  assert.doesNotMatch(encoded, /secret-token|user:pass|sk-secret-production-key|\/Users\/alice|Authorization: Bearer [^<]/);
});

function fakePublishRunner({ auth = true, actionsRuns = [], dispatchError, accountSearchError, accountSearchItems = [{ full_name: 'Lling0000/proofroute' }], packReport = fakePackReport(), publishStderr = 'npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)\n', gitHead = currentTestSha } = {}) {
  return async (command, args) => {
    if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') {
      return { stdout: `${gitHead}\n`, stderr: '' };
    }
    if (command === 'npm' && args[0] === '--version') {
      return { stdout: '11.16.0\n', stderr: '' };
    }
    if (command === 'npm' && args[0] === 'pack') {
      return { stdout: `${JSON.stringify([packReport])}\n`, stderr: '' };
    }
    if (command === 'npm' && args[0] === 'publish') {
      return { stdout: '+ proofroute@0.1.0\n', stderr: publishStderr };
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

function fakePackReport({ omit = [] } = {}) {
  const files = [
    'bin/proofroute.js',
    'bin/proofroute-classifier.js',
    'src/agent/classifier-evidence.js',
    'src/agent/launch-readiness.js',
    'src/agent/publish-readiness.js',
    'src/agent/release-pack.js',
    'src/agent/repository-profile.js',
    'scripts/check-prose-docs.js',
    'docs/repository-profile.md',
    'docs/proofroute-terminal.svg',
    'docs/proofroute-classifier.svg',
    'docs/proofroute-classifier-benchmark.svg',
    'README.md',
    'README.zh-CN.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'LICENSE',
    '.env.example'
  ].filter((path) => !omit.includes(path));
  return {
    name: 'proofroute',
    version: '0.1.0',
    filename: 'proofroute-0.1.0.tgz',
    entryCount: files.length,
    size: 146988,
    unpackedSize: 632228,
    integrity: 'sha512-proofroute',
    files: files.map((path) => ({ path }))
  };
}
