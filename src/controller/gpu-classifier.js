import { spawn, spawnSync } from 'node:child_process';
import { classifyIntent } from './intent.js';

export class ExternalClassifier {
  constructor({ command, url, timeoutMs = 12, env, failureThreshold = 3, cooldownMs = 1000, now = () => Date.now() } = {}) {
    this.command = command;
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.env = env;
    this.failureThreshold = normalizePositiveInteger(failureThreshold, 3);
    this.cooldownMs = normalizePositiveInteger(cooldownMs, 1000);
    this.now = now;
    this.failures = 0;
    this.openUntil = 0;
  }

  classify(prompt) {
    if (this.isCircuitOpen()) return withBackend(classifyIntent(prompt), 'builtin-circuit-open', circuitFeatures(this));
    if (this.url && !this.command) return withBackend(classifyIntent(prompt), 'builtin-fallback');
    if (!this.command) return classifyIntent(prompt);
    const fallback = classifyIntent(prompt);
    const result = spawnSync(this.command, {
      input: JSON.stringify({ prompt }),
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      shell: true,
      timeout: this.timeoutMs,
      env: mergeEnv(this.env)
    });
    if (result.error || result.status !== 0) {
      this.recordFailure();
      return withBackend(fallback, 'builtin-fallback', circuitFeatures(this));
    }
    try {
      const parsed = JSON.parse(result.stdout);
      if (!parsed || typeof parsed.name !== 'string') {
        this.recordFailure();
        return withBackend(fallback, 'builtin-fallback', circuitFeatures(this));
      }
      this.recordSuccess();
      return mergeIntent({ parsed, fallback, backend: 'external' });
    } catch {
      this.recordFailure();
      return withBackend(fallback, 'builtin-fallback', circuitFeatures(this));
    }
  }

  async classifyAsync(prompt) {
    if (this.url) return this.classifyViaUrl(prompt);
    return this.classify(prompt);
  }

  async classifyMany(prompts) {
    if (this.isCircuitOpen()) return prompts.map((prompt) => withBackend(classifyIntent(prompt), 'builtin-circuit-open', circuitFeatures(this)));
    if (this.url) return this.classifyBatchViaUrl(prompts);
    if (this.command) return this.classifyBatchViaCommand(prompts);
    return prompts.map((prompt) => classifyIntent(prompt));
  }

  classifyBatchViaCommand(prompts) {
    const fallbacks = prompts.map((prompt) => classifyIntent(prompt));
    if (prompts.length === 0) return [];
    const result = spawnSync(this.command, {
      input: JSON.stringify({ prompts }),
      encoding: 'utf8',
      maxBuffer: 512 * 1024,
      shell: true,
      timeout: this.timeoutMs,
      env: mergeEnv(this.env)
    });
    if (result.error || result.status === 127) {
      this.recordFailure();
      return fallbacks.map((fallback) => withBackend(fallback, 'builtin-fallback', circuitFeatures(this)));
    }
    if (result.status !== 0) {
      this.recordFailure();
      return fallbacks.map((fallback) => withBackend(fallback, 'builtin-fallback', circuitFeatures(this)));
    }
    try {
      const parsed = JSON.parse(result.stdout);
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.data) ? parsed.data : [];
      if (rows.length !== prompts.length) {
        this.recordFailure();
        return fallbacks.map((fallback) => withBackend(fallback, 'builtin-fallback', circuitFeatures(this)));
      }
      this.recordSuccess();
      return prompts.map((prompt, index) => {
        const fallback = fallbacks[index];
        const row = rows[index];
        if (!row || typeof row.name !== 'string') return withBackend(fallback, 'builtin-fallback', circuitFeatures(this));
        return mergeIntent({ parsed: row, fallback, backend: 'external' });
      });
    } catch {
      this.recordFailure();
      return fallbacks.map((fallback) => withBackend(fallback, 'builtin-fallback', circuitFeatures(this)));
    }
  }

  async classifyViaUrl(prompt) {
    const fallback = classifyIntent(prompt);
    if (this.isCircuitOpen()) return withBackend(fallback, 'builtin-circuit-open', circuitFeatures(this));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: controller.signal
      });
      if (!response.ok) {
        this.recordFailure();
        return withBackend(fallback, 'builtin-fallback', circuitFeatures(this));
      }
      const parsed = await response.json();
      if (!parsed || typeof parsed.name !== 'string') {
        this.recordFailure();
        return withBackend(fallback, 'builtin-fallback', circuitFeatures(this));
      }
      this.recordSuccess();
      return mergeIntent({ parsed, fallback, backend: 'external-url' });
    } catch {
      this.recordFailure();
      return withBackend(fallback, 'builtin-fallback', circuitFeatures(this));
    } finally {
      clearTimeout(timeout);
    }
  }

  async classifyBatchViaUrl(prompts) {
    const fallbacks = prompts.map((prompt) => classifyIntent(prompt));
    if (this.isCircuitOpen()) return fallbacks.map((fallback) => withBackend(fallback, 'builtin-circuit-open', circuitFeatures(this)));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(classifierBatchUrl(this.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompts }),
        signal: controller.signal
      });
      if (!response.ok) {
        this.recordFailure();
        return fallbacks.map((fallback) => withBackend(fallback, 'builtin-fallback', circuitFeatures(this)));
      }
      const parsed = await response.json();
      const rows = Array.isArray(parsed.data) ? parsed.data : [];
      if (rows.length !== prompts.length) {
        this.recordFailure();
        return fallbacks.map((fallback) => withBackend(fallback, 'builtin-fallback', circuitFeatures(this)));
      }
      this.recordSuccess();
      return prompts.map((prompt, index) => {
        const fallback = fallbacks[index];
        const row = rows[index];
        if (!row || typeof row.name !== 'string') return withBackend(fallback, 'builtin-fallback', circuitFeatures(this));
        return mergeIntent({ parsed: row, fallback, backend: 'external-url' });
      });
    } catch {
      this.recordFailure();
      return fallbacks.map((fallback) => withBackend(fallback, 'builtin-fallback', circuitFeatures(this)));
    } finally {
      clearTimeout(timeout);
    }
  }

  circuitState() {
    return {
      open: this.isCircuitOpen(),
      failures: this.failures,
      failureThreshold: this.failureThreshold,
      cooldownMs: this.cooldownMs,
      openUntil: this.openUntil
    };
  }

  isCircuitOpen() {
    return this.openUntil > this.now();
  }

  recordSuccess() {
    this.failures = 0;
    this.openUntil = 0;
  }

  recordFailure() {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.openUntil = this.now() + this.cooldownMs;
    }
  }
}

export class PersistentClassifier {
  constructor({ command, timeoutMs = 12, env } = {}) {
    this.command = command;
    this.timeoutMs = timeoutMs;
    this.env = env;
    this.nextId = 1;
    this.pending = new Map();
    this.stdout = '';
    this.child = undefined;
    if (command) this.start();
  }

  classify(prompt) {
    return withBackend(classifyIntent(prompt), this.command ? 'persistent-async-required' : 'builtin-fallback');
  }

  async classifyAsync(prompt) {
    const fallback = classifyIntent(prompt);
    const parsed = await this.request({ prompt });
    if (!parsed || typeof parsed.name !== 'string') return withBackend(fallback, 'builtin-fallback');
    return mergeIntent({ parsed, fallback, backend: 'persistent' });
  }

  async classifyMany(prompts) {
    const fallbacks = prompts.map((prompt) => classifyIntent(prompt));
    if (prompts.length === 0) return [];
    const parsed = await this.request({ prompts });
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : [];
    if (rows.length !== prompts.length) return fallbacks.map((fallback) => withBackend(fallback, 'builtin-fallback'));
    return prompts.map((prompt, index) => {
      const fallback = fallbacks[index];
      const row = rows[index];
      if (!row || typeof row.name !== 'string') return withBackend(fallback, 'builtin-fallback');
      return mergeIntent({ parsed: row, fallback, backend: 'persistent' });
    });
  }

  close() {
    if (!this.child) return;
    this.child.kill();
    this.child = undefined;
  }

  start() {
    if (!this.command || this.child) return;
    const child = spawn(this.command, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: mergeEnv(this.env)
    });
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this.receive(chunk));
    child.stderr.resume();
    child.on('error', () => this.failPending());
    child.on('exit', () => {
      this.child = undefined;
      this.failPending();
    });
  }

  request(payload) {
    if (!this.command) return Promise.resolve(undefined);
    if (!this.child) this.start();
    if (!this.child?.stdin?.writable) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const id = String(this.nextId);
      this.nextId += 1;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve(undefined);
      }, this.timeoutMs);
      this.pending.set(id, { resolve, timeout });
      this.child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.resolve(undefined);
      });
    });
  }

  receive(chunk) {
    this.stdout += chunk;
    let newline = this.stdout.indexOf('\n');
    while (newline >= 0) {
      const line = this.stdout.slice(0, newline).trim();
      this.stdout = this.stdout.slice(newline + 1);
      this.receiveLine(line);
      newline = this.stdout.indexOf('\n');
    }
  }

  receiveLine(line) {
    if (!line) return;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const id = parsed.id === undefined ? this.pending.keys().next().value : String(parsed.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    const { id: ignored, ...withoutId } = parsed;
    pending.resolve(parsed.data ?? parsed.result ?? withoutId);
  }

  failPending() {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      this.pending.delete(id);
      pending.resolve(undefined);
    }
  }
}

function classifierBatchUrl(url) {
  const parsed = new URL(url);
  parsed.pathname = parsed.pathname.replace(/\/classify\/?$/, '/classify/batch') || '/classify/batch';
  if (!parsed.pathname.endsWith('/classify/batch')) parsed.pathname = '/classify/batch';
  parsed.search = '';
  return parsed.toString();
}

function mergeIntent({ parsed, fallback, backend }) {
  return {
    ...parsed,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : fallback.confidence,
    ranked: Array.isArray(parsed.ranked) ? parsed.ranked : fallback.ranked,
    features: { ...fallback.features, ...parsed.features, backend }
  };
}

function withBackend(intent, backend, extra = {}) {
  return {
    ...intent,
    features: {
      ...intent.features,
      backend,
      ...extra
    }
  };
}

function mergeEnv(env) {
  if (!env) return undefined;
  return {
    ...process.env,
    ...env
  };
}

function circuitFeatures(classifier) {
  return {
    classifierCircuitOpen: classifier.isCircuitOpen(),
    classifierFailures: classifier.failures,
    classifierFailureThreshold: classifier.failureThreshold,
    classifierCooldownMs: classifier.cooldownMs
  };
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
