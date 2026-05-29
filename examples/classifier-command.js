#!/usr/bin/env node
import { classifyIntent } from '../src/controller/intent.js';

try {
  const body = JSON.parse(await readStdin() || '{}');
  if (Array.isArray(body.prompts)) {
    process.stdout.write(`${JSON.stringify({ data: body.prompts.map((prompt) => classifyIntent(String(prompt ?? ''))) })}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(classifyIntent(String(body.prompt ?? '')))}\n`);
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
