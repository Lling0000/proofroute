#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { classifyIntent } from '../src/controller/intent.js';

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

for await (const line of input) {
  if (!line.trim()) continue;
  try {
    const body = JSON.parse(line);
    if (Array.isArray(body.prompts)) {
      process.stdout.write(`${JSON.stringify({
        id: body.id,
        data: body.prompts.map((prompt) => classifyIntent(String(prompt ?? '')))
      })}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({
        id: body.id,
        ...classifyIntent(String(body.prompt ?? ''))
      })}\n`);
    }
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      error: error.message
    })}\n`);
  }
}
