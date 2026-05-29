import { spawnSync } from 'node:child_process';
import { classifyIntent } from './intent.js';

export class ExternalClassifier {
  constructor({ command, url, timeoutMs = 12 } = {}) {
    this.command = command;
    this.url = url;
    this.timeoutMs = timeoutMs;
  }

  classify(prompt) {
    if (this.url && !this.command) return withBackend(classifyIntent(prompt), 'builtin-fallback');
    if (!this.command) return classifyIntent(prompt);
    const fallback = classifyIntent(prompt);
    const result = spawnSync(this.command, {
      input: JSON.stringify({ prompt }),
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      shell: true,
      timeout: this.timeoutMs
    });
    if (result.error || result.status !== 0) {
      return withBackend(fallback, 'builtin-fallback');
    }
    try {
      const parsed = JSON.parse(result.stdout);
      if (!parsed || typeof parsed.name !== 'string') return withBackend(fallback, 'builtin-fallback');
      return mergeIntent({ parsed, fallback, backend: 'external' });
    } catch {
      return withBackend(fallback, 'builtin-fallback');
    }
  }

  async classifyAsync(prompt) {
    if (this.url) return this.classifyViaUrl(prompt);
    return this.classify(prompt);
  }

  async classifyMany(prompts) {
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
      timeout: this.timeoutMs
    });
    if (result.error || result.status === 127) {
      return fallbacks.map((fallback) => withBackend(fallback, 'builtin-fallback'));
    }
    if (result.status !== 0) {
      return prompts.map((prompt) => this.classify(prompt));
    }
    try {
      const parsed = JSON.parse(result.stdout);
      const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.data) ? parsed.data : [];
      if (rows.length !== prompts.length) return prompts.map((prompt) => this.classify(prompt));
      return prompts.map((prompt, index) => {
        const fallback = fallbacks[index];
        const row = rows[index];
        if (!row || typeof row.name !== 'string') return withBackend(fallback, 'builtin-fallback');
        return mergeIntent({ parsed: row, fallback, backend: 'external' });
      });
    } catch {
      return prompts.map((prompt) => this.classify(prompt));
    }
  }

  async classifyViaUrl(prompt) {
    const fallback = classifyIntent(prompt);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: controller.signal
      });
      if (!response.ok) return withBackend(fallback, 'builtin-fallback');
      const parsed = await response.json();
      if (!parsed || typeof parsed.name !== 'string') return withBackend(fallback, 'builtin-fallback');
      return mergeIntent({ parsed, fallback, backend: 'external-url' });
    } catch {
      return withBackend(fallback, 'builtin-fallback');
    } finally {
      clearTimeout(timeout);
    }
  }

  async classifyBatchViaUrl(prompts) {
    const fallbacks = prompts.map((prompt) => classifyIntent(prompt));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(classifierBatchUrl(this.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompts }),
        signal: controller.signal
      });
      if (!response.ok) return fallbacks.map((fallback) => withBackend(fallback, 'builtin-fallback'));
      const parsed = await response.json();
      const rows = Array.isArray(parsed.data) ? parsed.data : [];
      return prompts.map((prompt, index) => {
        const fallback = fallbacks[index];
        const row = rows[index];
        if (!row || typeof row.name !== 'string') return withBackend(fallback, 'builtin-fallback');
        return mergeIntent({ parsed: row, fallback, backend: 'external-url' });
      });
    } catch {
      return fallbacks.map((fallback) => withBackend(fallback, 'builtin-fallback'));
    } finally {
      clearTimeout(timeout);
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

function withBackend(intent, backend) {
  return {
    ...intent,
    features: {
      ...intent.features,
      backend
    }
  };
}
