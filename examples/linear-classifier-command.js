#!/usr/bin/env node
import { classifyMany } from './linear-accelerator-module.js';

try {
  const body = JSON.parse(await readStdin() || '{}');
  if (Array.isArray(body.prompts)) {
    process.stdout.write(`${JSON.stringify({ data: await classifyMany(body.prompts.map((prompt) => String(prompt ?? '')), { device: 'local-artifact' }) })}\n`);
  } else {
    const rows = await classifyMany([String(body.prompt ?? '')], { device: 'local-artifact' });
    process.stdout.write(`${JSON.stringify(rows[0])}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
