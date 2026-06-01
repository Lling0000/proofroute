#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const targets = process.argv.slice(2);
const paths = targets.length > 0 ? targets : ['README.md', 'docs', 'CONTRIBUTING.md', 'SECURITY.md', '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE'];
const listPattern = /^\s*(?:-|\*|\+|\d+[\.)])\s+/;
const findings = [];

for (const path of paths) {
  await scan(path);
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: paragraph prose rule rejected "${finding.text}"`);
  }
  process.exitCode = 1;
} else {
  console.log(`prose check passed for ${paths.length} path${paths.length === 1 ? '' : 's'}`);
}

async function scan(path) {
  const info = await stat(path);
  if (info.isDirectory()) {
    const entries = await readdir(path);
    for (const entry of entries) {
      await scan(join(path, entry));
    }
    return;
  }
  const text = await readFile(path, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (listPattern.test(line)) {
      findings.push({
        file: path,
        line: index + 1,
        text: line.trim()
      });
    }
  }
}
