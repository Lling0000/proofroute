import { spawnSync } from 'node:child_process';
import { classifyIntent } from './intent.js';

export class ExternalClassifier {
  constructor({ command, timeoutMs = 12 } = {}) {
    this.command = command;
    this.timeoutMs = timeoutMs;
  }

  classify(prompt) {
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
      return {
        ...parsed,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : fallback.confidence,
        ranked: Array.isArray(parsed.ranked) ? parsed.ranked : fallback.ranked,
        features: { ...fallback.features, ...parsed.features, backend: 'external' }
      };
    } catch {
      return withBackend(fallback, 'builtin-fallback');
    }
  }
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
