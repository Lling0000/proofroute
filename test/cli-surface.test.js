import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const cli = new URL('../bin/proofroute.js', import.meta.url);

test('CLI version prints the package version without dumping help', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const flag of ['--version', '-v', 'version']) {
    const result = spawnSync(process.execPath, [cli.pathname, flag], {
      cwd: root,
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), pkg.version);
    assert.doesNotMatch(result.stdout, /Usage/);
  }
});

test('subcommand help is read-only and command-specific', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'proofroute-help-'));
  try {
    for (const command of ['demo', 'profile', 'publish', 'doctor', 'release', 'smoke']) {
      const result = spawnSync(process.execPath, [cli.pathname, command, '--help'], {
        cwd,
        encoding: 'utf8'
      });
      assert.equal(result.status, 0, `${command} --help failed: ${result.stderr || result.stdout}`);
      assert.match(result.stdout, new RegExp(`proofroute ${command}`));
      assert.match(result.stdout, /Proof boundary/);
      assert.doesNotMatch(result.stdout, /REPOSITORY FACE|PUBLISH READINESS|RELEASE PROOF PACK|DOCTOR REPORT/);
    }
    assert.equal(existsSync(join(cwd, 'proofroute-release-pack')), false);
    assert.equal(existsSync(join(cwd, '.proofroute')), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('help can target a subcommand without executing it', () => {
  const result = spawnSync(process.execPath, [cli.pathname, 'help', 'publish'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /proofroute publish/);
  assert.match(result.stdout, /--check-public --check-actions/);
  assert.doesNotMatch(result.stdout, /publish readiness/i);
});
