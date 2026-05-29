#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AgentRuntime } from '../src/agent/runtime.js';
import { demoCatalog, mergeConfig, readConfig } from '../src/config.js';
import { ExternalClassifier } from '../src/controller/gpu-classifier.js';
import { RouteController } from '../src/controller/route-controller.js';
import { renderAgentPlan, renderCalibration, renderDecision, renderDashboard, renderHelp, renderJson } from '../src/view/terminal.js';

const command = process.argv[2] ?? 'help';
const args = parseArgs(process.argv.slice(3));

try {
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(renderHelp());
  } else if (command === 'route') {
    const config = await loadRuntimeConfig(args);
    const prompt = await readPrompt(args);
    const controller = new RouteController(config, createClassifier(config));
    const decision = controller.route({ prompt, tokens: Number(args.tokens ?? 0) || undefined, policy: args.policy });
    console.log(args.json ? renderJson(decision) : renderDecision(decision));
  } else if (command === 'bench') {
    const config = await loadRuntimeConfig(args);
    const prompt = args.prompt ?? 'Refactor this payment webhook, explain the bug, and write a focused regression test.';
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const report = await runtime.benchmark({ prompt, runs: Number(args.runs ?? 7), controller, policy: args.policy });
    console.log(args.json ? renderJson(report) : renderDashboard(report));
  } else if (command === 'calibrate') {
    const config = await loadRuntimeConfig(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const samples = await readSamples(args);
    const report = await runtime.calibrate({ samples, controller, policy: args.policy });
    console.log(args.json ? renderJson(report) : renderCalibration(report));
  } else if (command === 'plan') {
    const config = await loadRuntimeConfig(args);
    const prompt = await readPrompt(args);
    const controller = new RouteController(config, createClassifier(config));
    const runtime = new AgentRuntime(config);
    const plan = await runtime.planAgents({ prompt, controller, policy: args.policy });
    console.log(args.json ? renderJson(plan) : renderAgentPlan(plan));
  } else if (command === 'proxy') {
    const config = await loadRuntimeConfig(args);
    await startProxy({ config, port: Number(args.port ?? process.env.PORT ?? 8787), verbose: Boolean(args.verbose) });
  } else if (command === 'init') {
    console.log(JSON.stringify(demoCatalog(), null, 2));
  } else {
    console.error(`Unknown command: ${command}`);
    console.error(renderHelp());
    process.exitCode = 1;
  }
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}

async function loadRuntimeConfig(args) {
  const fileConfig = args.config ? await readConfig(resolve(String(args.config))) : {};
  return resolveEnvReferences(mergeConfig(demoCatalog(), fileConfig, envConfig()));
}

function envConfig() {
  const providers = {};
  if (process.env.OPENAI_API_KEY) {
    providers.openai = {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    providers.anthropic = {
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1'
    };
  }
  if (process.env.OLLAMA_BASE_URL) {
    providers.local = { baseUrl: process.env.OLLAMA_BASE_URL, kind: 'ollama' };
  }
  return { providers };
}

function resolveEnvReferences(value) {
  if (Array.isArray(value)) return value.map(resolveEnvReferences);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, resolveEnvReferences(entry)]));
  }
  if (typeof value === 'string' && value.startsWith('env:')) {
    return process.env[value.slice(4)] ?? '';
  }
  return value;
}

async function readPrompt(args) {
  if (args.prompt) return String(args.prompt);
  if (args.file) return readFile(resolve(String(args.file)), 'utf8');
  if (!process.stdin.isTTY) return readStdin();
  throw new Error('Pass --prompt "..." or pipe a prompt into stdin.');
}

async function readSamples(args) {
  if (args.file) return JSON.parse(await readFile(resolve(String(args.file)), 'utf8'));
  return [
    {
      id: 'code-fix',
      intent: 'code',
      prompt: 'Refactor this TypeScript webhook, fix the stacktrace, and add a regression test.'
    },
    {
      id: 'long-audit',
      intent: 'long_context',
      prompt: 'Audit this repository migration plan, compare every risk, and summarize the cross-file action items.'
    },
    {
      id: 'extract-json',
      intent: 'extraction',
      prompt: 'Extract the customer ids, invoice totals, and renewal dates into strict JSON.'
    },
    {
      id: 'launch-copy',
      intent: 'writing',
      prompt: 'Rewrite this README introduction so the launch feels credible, sharp, and easy to share.'
    },
    {
      id: 'tradeoff',
      intent: 'reasoning',
      prompt: 'Compare these routing algorithms and explain the cost, latency, and quality tradeoffs.'
    }
  ];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function startProxy({ config, port, verbose }) {
  const controller = new RouteController(config, createClassifier(config));
  const runtime = new AgentRuntime(config);
  const server = createServer(async (req, res) => {
    const startedAt = performance.now();
    try {
      if (req.method === 'GET' && req.url === '/health') {
        return sendJson(res, 200, { ok: true, name: 'llm-router', latency_ms: 0 });
      }
      if (req.method === 'GET' && req.url === '/ready') {
        const readiness = runtime.readiness({ controller });
        return sendJson(res, readiness.ok ? 200 : 503, readiness);
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        return sendJson(res, 200, runtime.modelList({ controller }));
      }
      if (req.method !== 'POST' || !String(req.url).startsWith('/v1/chat/completions')) {
        return sendJson(res, 404, { error: { message: 'Supported routes are GET /health, GET /ready, GET /v1/models, and POST /v1/chat/completions.' } });
      }
      const body = await readJson(req);
      const prompt = extractPrompt(body);
      const decision = controller.route({ prompt, requestedModel: body.model, executableOnly: true, policy: body.metadata?.llm_router_policy });
      const upstream = await runtime.executeChatCompletion({ body, decision });
      const elapsedMs = Math.max(0, performance.now() - startedAt);
      res.setHeader('x-llm-router-model', decision.model.id);
      res.setHeader('x-llm-router-intent', decision.intent.name);
      res.setHeader('x-llm-router-saved-usd', decision.economics.savingsUsd.toFixed(6));
      if (verbose) process.stderr.write(`${renderDecision(decision)}\n`);
      return sendRaw(res, upstream.status, upstream.headers, upstream.body, elapsedMs);
    } catch (error) {
      return sendJson(res, 500, { error: { message: error.message } });
    }
  });
  server.listen(port, () => {
    console.log(`llm-router proxy listening on http://127.0.0.1:${port}/v1/chat/completions`);
  });
}

function createClassifier(config) {
  const command = config.classifier?.command ?? process.env.LLM_ROUTER_CLASSIFIER;
  const timeoutMs = Number(config.classifier?.timeoutMs ?? process.env.LLM_ROUTER_CLASSIFIER_TIMEOUT_MS ?? 12);
  return new ExternalClassifier({ command, timeoutMs });
}

function extractPrompt(body) {
  if (typeof body.prompt === 'string') return body.prompt;
  if (!Array.isArray(body.messages)) return '';
  return body.messages.map((message) => {
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => typeof part.text === 'string' ? part.text : '').join('\n');
    }
    return '';
  }).join('\n');
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendRaw(res, status, headers, body, elapsedMs) {
  const safeHeaders = Object.fromEntries(Object.entries(headers ?? {}).filter(([key]) => {
    return !['content-encoding', 'transfer-encoding', 'connection', 'keep-alive'].includes(key.toLowerCase());
  }));
  safeHeaders['x-llm-router-latency-ms'] = elapsedMs.toFixed(2);
  res.writeHead(status, safeHeaders);
  res.end(body);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function formatError(error) {
  if (existsSync('/.dockerenv')) return error.stack ?? error.message;
  return `llm-router: ${error.message}`;
}
