import { classifyIntent, estimateTokens, stableSoftmax } from './intent.js';

export class RouteController {
  constructor(config, classifier = { classify: classifyIntent }) {
    this.config = config;
    this.models = config.models ?? [];
    this.classifier = classifier;
    if (this.models.length === 0) throw new Error('No models are configured.');
  }

  route({ prompt, tokens, requestedModel, executableOnly = false, policy } = {}) {
    const inputTokens = tokens ?? estimateTokens(prompt ?? '');
    const outputTokens = Math.max(256, Math.ceil(inputTokens * 0.35));
    const intent = normalizeIntent(this.classifier.classify(prompt ?? ''));
    const candidates = this.models
      .filter((model) => model.contextWindow >= inputTokens + outputTokens)
      .filter((model) => !executableOnly || this.canExecute(model))
      .map((model) => this.scoreModel({ model, intent, inputTokens, outputTokens, requestedModel, policy }));
    if (candidates.length === 0) {
      throw new Error(`No configured executable model can fit ${inputTokens + outputTokens} estimated tokens.`);
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
      intent,
      inputTokens,
      outputTokens,
      confidence: chosen.probability,
      ranked: ranked.map(stripInternal),
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
    const logit = quality * qualityWeight + localBias + requestedBias + contextFit - costPenalty * weights.cost - latencyPenalty * weights.latency;
    return {
      model,
      logit,
      quality,
      estimatedCostUsd,
      estimatedLatencyMs,
      probability: 0
    };
  }

  canExecute(model) {
    const provider = this.config.providers?.[model.provider];
    if (!provider) return false;
    if (provider.kind === 'ollama' || model.local) return Boolean(provider.baseUrl);
    return Boolean(provider.baseUrl && provider.apiKey);
  }

  executableModels() {
    return this.models.filter((model) => this.canExecute(model));
  }
}

export function policyWeights(policy = 'balanced') {
  const policies = {
    balanced: { quality: 1, cost: 0.9, latency: 0.38, local: 1 },
    save: { quality: 0.88, cost: 1.55, latency: 0.32, local: 1.2 },
    fast: { quality: 0.92, cost: 0.72, latency: 0.74, local: 1.15 },
    quality: { quality: 1.34, cost: 0.55, latency: 0.24, local: 0.72 },
    local: { quality: 0.84, cost: 1.2, latency: 0.42, local: 2.8 }
  };
  return policies[policy] ?? policies.balanced;
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
    quality: candidate.quality,
    estimatedCostUsd: candidate.estimatedCostUsd,
    estimatedLatencyMs: candidate.estimatedLatencyMs,
    local: Boolean(candidate.model.local)
  };
}
