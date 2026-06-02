import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('prose docs checker accepts paragraph-only files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-prose-pass-'));
  try {
    const file = join(directory, 'good.md');
    await writeFile(file, 'This paragraph keeps the repository face in prose.\n\nAnother paragraph stays list-free.\n');
    const result = spawnSync(process.execPath, ['scripts/check-prose-docs.js', file], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /prose check passed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('prose docs checker rejects list markers inside recursive targets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-prose-fail-'));
  try {
    const nested = join(directory, 'nested');
    await mkdir(nested);
    const file = join(nested, 'bad.md');
    await writeFile(file, 'This paragraph is fine.\n' + '- This list marker should fail.\n');
    const result = spawnSync(process.execPath, ['scripts/check-prose-docs.js', directory], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bad\.md:2/);
    assert.match(result.stderr, /paragraph prose rule rejected/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('prose docs checker rejects markdown table rows outside code fences', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-prose-table-fail-'));
  try {
    const file = join(directory, 'table.md');
    await writeFile(file, 'This paragraph is fine.\n' + '| command | proof |\n' + '| --- | --- |\n');
    const result = spawnSync(process.execPath, ['scripts/check-prose-docs.js', file], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /table\.md:2/);
    assert.match(result.stderr, /paragraph prose rule rejected/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('prose docs checker allows table-looking text inside code fences', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-prose-code-pass-'));
  try {
    const file = join(directory, 'code.md');
    await writeFile(file, 'A prose paragraph introduces a terminal capture.\n\n```text\n| command | proof |\n```\n');
    const result = spawnSync(process.execPath, ['scripts/check-prose-docs.js', file], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /prose check passed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('prose docs npm script scans every public documentation surface', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const script = pkg.scripts['check:prose'];
  for (const target of [
    'README.md',
    'README.zh-CN.md',
    'docs',
    'CONTRIBUTING.md',
    'SECURITY.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.github/ISSUE_TEMPLATE',
    'src',
    'bin',
    'examples',
    'test',
    'package.json',
    'LICENSE',
    '.env.example'
  ]) {
    assert.match(script, new RegExp(`(^| )${escapeRegExp(target)}($| )`));
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
