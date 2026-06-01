import test from 'node:test';
import assert from 'node:assert/strict';
import { publishReadinessReport } from '../src/agent/publish-readiness.js';
import { renderPublishReadiness } from '../src/view/terminal.js';

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
  assert.match(report.npm.auth.detail, /auth is missing/);
  assert.doesNotMatch(JSON.stringify(report), /NODE_AUTH_TOKEN|secret-token/);
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

function fakePublishRunner({ auth = true, actionsRuns = [] } = {}) {
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
    if (command === 'gh' && args[0] === 'api') {
      return { stdout: '{"enabled":true,"allowed_actions":"all"}\n', stderr: '' };
    }
    if (command === 'gh' && args[0] === 'run') {
      return { stdout: `${JSON.stringify(actionsRuns)}\n`, stderr: '' };
    }
    throw new Error(`unexpected command ${command} ${args.join(' ')}`);
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
