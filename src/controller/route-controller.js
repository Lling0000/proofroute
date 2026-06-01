import { createHash } from 'node:crypto';
import { classifyIntent, estimateTokens, stableSoftmax } from './intent.js';

export const ROUTING_POLICIES = Object.freeze(['balanced', 'save', 'fast', 'quality', 'local']);

export class NoRouteError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'NoRouteError';
    this.code = 'no_route';
    this.status = 422;
    this.details = details;
  }
}

export class RouteController {
  constructor(config, classifier = { classify: classifyIntent }) {
    this.config = config;
    this.models = config.models ?? [];
    this.classifier = classifier;
    this.cache = new Map();
    this.cacheSize = normalizeCacheSize(config.router?.cacheSize ?? 256);
    if (this.models.length === 0) throw new Error('No models are configured.');
  }

  route({ prompt, tokens, outputTokens, requestedModel, executableOnly = false, policy, maxCostUsd, maxLatencyMs } = {}) {
    const resolvedPolicy = resolvePolicy(policy ?? this.config.router?.policy);
    const cacheKey = this.cacheKey({ prompt, tokens, outputTokens, requestedModel, executableOnly, policy: resolvedPolicy, maxCostUsd, maxLatencyMs });
    const cached = this.readCache(cacheKey);
    if (cached) return withCache(cached, { hit: true, key: cacheKey, size: this.cache.size });
    const intent = normalizeIntent(this.classifier.classify(prompt ?? ''));
    const decision = this.routeWithIntent({ prompt, tokens, outputTokens, requestedModel, executableOnly, policy: resolvedPolicy, intent, maxCostUsd, maxLatencyMs });
    this.writeCache(cacheKey, decision);
    return withCache(decision, { hit: false, key: cacheKey, size: this.cache.size });
  }

  async routeAsync({ prompt, tokens, outputTokens, requestedModel, executableOnly = false, policy, maxCostUsd, maxLatencyMs } = {}) {
    const resolvedPolicy = resolvePolicy(policy ?? this.config.router?.policy);
    const cacheKey = this.cacheKey({ prompt, tokens, outputTokens, requestedModel, executableOnly, policy: resolvedPolicy, maxCostUsd, maxLatencyMs });
    const cached = this.readCache(cacheKey);
    if (cached) return withCache(cached, { hit: true, key: cacheKey, size: this.cache.size });
    const classify = typeof this.classifier.classifyAsync === 'function' ? this.classifier.classifyAsync.bind(this.classifier) : this.classifier.classify.bind(this.classifier);
    const intent = normalizeIntent(await classify(prompt ?? ''));
    const decision = this.routeWithIntent({ prompt, tokens, outputTokens, requestedModel, executableOnly, policy: resolvedPolicy, intent, maxCostUsd, maxLatencyMs });
    this.writeCache(cacheKey, decision);
    return withCache(decision, { hit: false, key: cacheKey, size: this.cache.size });
  }

  async routeBatchAsync(inputs = []) {
    const output = Array.from({ length: inputs.length });
    const misses = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index] ?? {};
      const executableOnly = input.executableOnly ?? false;
      const cacheKey = this.cacheKey({ ...input, executableOnly });
      const cached = this.readCache(cacheKey);
      if (cached) {
        output[index] = withCache(cached, { hit: true, key: cacheKey, size: this.cache.size });
      } else {
        misses.push({ index, input: { ...input, executableOnly }, cacheKey });
      }
    }
    if (misses.length === 0) return output;
    const intents = await this.classifyMany(misses.map((miss) => miss.input.prompt ?? ''));
    for (let missIndex = 0; missIndex < misses.length; missIndex += 1) {
      const miss = misses[missIndex];
      const intent = normalizeIntent(intents[missIndex]);
      const decision = this.routeWithIntent({ ...miss.input, intent });
      this.writeCache(miss.cacheKey, decision);
      output[miss.index] = withCache(decision, { hit: false, key: miss.cacheKey, size: this.cache.size });
    }
    return output;
  }

  async classifyMany(prompts) {
    if (typeof this.classifier.classifyMany === 'function') return this.classifier.classifyMany(prompts);
    const classify = typeof this.classifier.classifyAsync === 'function' ? this.classifier.classifyAsync.bind(this.classifier) : this.classifier.classify.bind(this.classifier);
    return Promise.all(prompts.map((prompt) => classify(prompt)));
  }

  routeWithIntent({ prompt, tokens, outputTokens, requestedModel, executableOnly = false, policy, intent, maxCostUsd, maxLatencyMs } = {}) {
    const resolvedPolicy = resolvePolicy(policy ?? this.config.router?.policy);
    const inputTokens = tokens ?? estimateTokens(prompt ?? '');
    const plannedOutputTokens = normalizeOutputTokens(outputTokens, inputTokens);
    const requiredTokens = inputTokens + plannedOutputTokens;
    const rejected = [];
    const candidates = [];
    for (const model of this.models) {
      if (model.contextWindow < requiredTokens) {
        rejected.push(stripRejected({ model, reason: 'context_window', requiredTokens, executable: this.canExecute(model) }));
        continue;
      }
      if (executableOnly && !this.canExecute(model)) {
        rejected.push(stripRejected({ model, reason: 'not_executable', requiredTokens, executable: false }));
        continue;
      }
      const candidate = this.scoreModel({ model, intent, inputTokens, outputTokens: plannedOutputTokens, requestedModel, policy: resolvedPolicy });
      if (withinCostBudget(maxCostUsd) && candidate.estimatedCostUsd > Number(maxCostUsd)) {
        rejected.push(stripRejected({ model, reason: 'cost_budget', requiredTokens, executable: this.canExecute(model), estimatedCostUsd: candidate.estimatedCostUsd, maxCostUsd: Number(maxCostUsd) }));
        continue;
      }
      if (withinLatencyBudget(maxLatencyMs) && candidate.estimatedLatencyMs > Number(maxLatencyMs)) {
        rejected.push(stripRejected({ model, reason: 'latency_budget', requiredTokens, executable: this.canExecute(model), estimatedLatencyMs: candidate.estimatedLatencyMs, maxLatencyMs: Number(maxLatencyMs) }));
        continue;
      }
      candidates.push(candidate);
    }
    if (candidates.length === 0) {
      const constraints = [];
      if (withinCostBudget(maxCostUsd)) constraints.push(`max cost $${Number(maxCostUsd).toFixed(6)}`);
      if (withinLatencyBudget(maxLatencyMs)) constraints.push(`max latency ${Number(maxLatencyMs).toFixed(2)}ms`);
      const budgetText = constraints.length ? ` within ${constraints.join(' and ')}` : '';
      throw new NoRouteError(`No configured executable model can fit ${requiredTokens} estimated tokens${budgetText}.`, {
        requiredTokens,
        inputTokens,
        outputTokens: plannedOutputTokens,
        maxCostUsd: withinCostBudget(maxCostUsd) ? Number(maxCostUsd) : undefined,
        maxLatencyMs: withinLatencyBudget(maxLatencyMs) ? Number(maxLatencyMs) : undefined,
        rejected
      });
    }
    const probabilities = stableSoftmax(candidates.map((candidate) => candidate.logit), this.config.router?.softmaxTemperature ?? 1);
    candidates.forEach((candidate, index) => {
      candidate.probability = probabilities[index];
    });
    const ranked = candidates.sort((a, b) => b.probability - a.probability);
    const chosen = ranked[0];
    const fallback = ranked.find((candidate) => candidate.model.id !== chosen.model.id) ?? chosen;
    const mostExpensive = ranked.reduce((max, candidate) => {
      return candidate.estimatedCostUsd > max.estimatedCostUsd ? candidate : max;
    }, ranked[0]);
    return {
      model: chosen.model,
      policy: resolvedPolicy,
      intent,
      inputTokens,
      outputTokens: plannedOutputTokens,
      confidence: chosen.probability,
      ranked: ranked.map(stripInternal),
      rejected,
      fallback: stripInternal(fallback),
      economics: {
        estimatedCostUsd: chosen.estimatedCostUsd,
        baselineCostUsd: mostExpensive.estimatedCostUsd,
        savingsUsd: Math.max(0, mostExpensive.estimatedCostUsd - chosen.estimatedCostUsd),
        savingsPct: mostExpensive.estimatedCostUsd > 0 ? Math.max(0, 1 - chosen.estimatedCostUsd / mostExpensive.estimatedCostUsd) : 0
      },
      performance: {
        estimatedLatencyMs: chosen.estimatedLatencyMs,
        baselineLatencyMs: mostExpensive.estimatedLatencyMs,
        speedup: mostExpensive.estimatedLatencyMs > 0 ? mostExpensive.estimatedLatencyMs / chosen.estimatedLatencyMs : 1
      }
    };
  }

  scoreModel({ model, intent, inputTokens, outputTokens, requestedModel, policy }) {
    const weights = policyWeights(policy ?? this.config.router?.policy);
    const quality = model.quality?.[intent.name] ?? model.quality?.chat ?? 0.5;
    const estimatedCostUsd = estimateCost({ model, inputTokens, outputTokens });
    const estimatedLatencyMs = estimateLatency({ model, inputTokens, outputTokens });
    const costPenalty = estimatedCostUsd / (this.config.router?.costPenaltyUsd ?? 0.00035);
    const latencyPenalty = estimatedLatencyMs / (this.config.router?.latencyPenaltyMs ?? 900);
    const qualityWeight = (this.config.router?.qualityWeight ?? 2) * weights.quality;
    const localBias = model.local ? (this.config.router?.localBias ?? 0.12) * weights.local : 0;
    const requestedBias = requestedModel && model.id === requestedModel ? 0.42 : 0;
    const contextFit = Math.log1p(model.contextWindow / Math.max(1, inputTokens + outputTokens)) * 0.05;
    const components = {
      quality: quality * qualityWeight,
      context: contextFit,
      local: localBias,
      requested: requestedBias,
      cost: -costPenalty * weights.cost,
      latency: -latencyPenalty * weights.latency
    };
    const logit = Object.values(components).reduce((total, value) => total + value, 0);
    return {
      model,
      logit,
      quality,
      components,
      weights,
      penalties: {
        cost: costPenalty,
        latency: latencyPenalty
      },
      estimatedCostUsd,
      estimatedLatencyMs,
      probability: 0
    };
  }

  canExecute(model) {
    const provider = this.config.providers?.[model.provider];
    if (!provider) return false;
    if (provider.kind === 'ollama' || model.local) return Boolean(provider.baseUrl);
    if (provider.requiresApiKey === false) return Boolean(provider.baseUrl);
    return Boolean(provider.baseUrl && provider.apiKey);
  }

  executableModels() {
    return this.models.filter((model) => this.canExecute(model));
  }

  cacheKey({ prompt, tokens, outputTokens, requestedModel, executableOnly, policy, maxCostUsd, maxLatencyMs }) {
    const hash = createHash('sha256').update(String(prompt ?? '')).digest('hex').slice(0, 16);
    return [
      hash,
      tokens ?? '',
      outputTokens ?? '',
      maxCostUsd ?? '',
      maxLatencyMs ?? '',
      requestedModel ?? '',
      executableOnly ? 'exec' : 'all',
      resolvePolicy(policy ?? this.config.router?.policy)
    ].join(':');
  }

  readCache(key) {
    if (this.cacheSize <= 0 || !this.cache.has(key)) return undefined;
    const value = this.cache.get(key);
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  writeCache(key, decision) {
    if (this.cacheSize <= 0) return;
    this.cache.set(key, withoutCache(decision));
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }
}

export function resolvePolicy(policy = 'balanced') {
  const normalized = typeof policy === 'string' ? policy.toLowerCase() : policy;
  if (normalized === 'auto') return 'balanced';
  return ROUTING_POLICIES.includes(normalized) ? normalized : 'balanced';
}

export function policyWeights(policy = 'balanced') {
  const policies = {
    balanced: { quality: 1, cost: 0.9, latency: 0.38, local: 1 },
    save: { quality: 0.88, cost: 1.55, latency: 0.32, local: 1.2 },
    fast: { quality: 0.92, cost: 0.72, latency: 0.74, local: 1.15 },
    quality: { quality: 1.34, cost: 0.55, latency: 0.24, local: 0.72 },
    local: { quality: 0.84, cost: 1.2, latency: 0.42, local: 2.8 }
  };
  return policies[resolvePolicy(policy)];
}

function normalizeIntent(intent) {
  if (!intent || typeof intent.name !== 'string') return classifyIntent('');
  return {
    confidence: typeof intent.confidence === 'number' ? intent.confidence : 0,
    ranked: Array.isArray(intent.ranked) ? intent.ranked : [],
    features: intent.features ?? {},
    ...intent
  };
}

export function estimateCost({ model, inputTokens, outputTokens }) {
  return inputTokens / 1_000_000 * model.inputUsdPer1M + outputTokens / 1_000_000 * model.outputUsdPer1M;
}

export function estimateLatency({ model, inputTokens, outputTokens }) {
  const generationMs = outputTokens / Math.max(1, model.throughputTokensPerSecond) * 1000;
  const promptMs = Math.min(600, inputTokens / 1000 * 18);
  return Math.max(1, model.medianLatencyMs + generationMs + promptMs);
}

function stripInternal(candidate) {
  return {
    model: candidate.model.id,
    provider: candidate.model.provider,
    probability: candidate.probability,
    logit: candidate.logit,
    quality: candidate.quality,
    components: candidate.components,
    penalties: candidate.penalties,
    estimatedCostUsd: candidate.estimatedCostUsd,
    estimatedLatencyMs: candidate.estimatedLatencyMs,
    local: Boolean(candidate.model.local)
  };
}

function stripRejected({ model, reason, requiredTokens, executable, estimatedCostUsd, maxCostUsd, estimatedLatencyMs, maxLatencyMs }) {
  return {
    model: model.id,
    provider: model.provider,
    reason,
    requiredTokens,
    contextWindow: model.contextWindow,
    estimatedCostUsd,
    maxCostUsd,
    estimatedLatencyMs,
    maxLatencyMs,
    executable,
    local: Boolean(model.local)
  };
}

function withoutCache(decision) {
  const { cache, ...rest } = decision;
  return rest;
}

function withCache(decision, cache) {
  return {
    ...decision,
    cache
  };
}

function normalizeCacheSize(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 256;
}

function normalizeOutputTokens(value, inputTokens) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
  return Math.max(256, Math.ceil(inputTokens * 0.35));
}

function withinCostBudget(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

function withinLatencyBudget(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}
