import { readFile } from 'node:fs/promises';

export async function readConfig(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function demoCatalog() {
  return {
    router: {
      softmaxTemperature: 0.82,
      latencyPenaltyMs: 900,
      costPenaltyUsd: 0.00035,
      qualityWeight: 2.1,
      localBias: 0.18,
      cacheSize: 256,
      upstreamTimeoutMs: 120000
    },
    providers: {
      local: {
        baseUrl: 'http://127.0.0.1:11434',
        kind: 'ollama'
      }
    },
    models: [
      {
        id: 'llama3.2:3b',
        provider: 'local',
        endpoint: '/api/chat',
        local: true,
        contextWindow: 128000,
        inputUsdPer1M: 0,
        outputUsdPer1M: 0,
        medianLatencyMs: 240,
        throughputTokensPerSecond: 92,
        quality: {
          code: 0.62,
          reasoning: 0.48,
          writing: 0.56,
          extraction: 0.58,
          chat: 0.64,
          long_context: 0.44
        }
      },
      {
        id: 'gpt-4.1-mini',
        provider: 'openai',
        endpoint: '/chat/completions',
        local: false,
        contextWindow: 1047576,
        inputUsdPer1M: 0.4,
        outputUsdPer1M: 1.6,
        medianLatencyMs: 820,
        throughputTokensPerSecond: 138,
        quality: {
          code: 0.78,
          reasoning: 0.72,
          writing: 0.74,
          extraction: 0.76,
          chat: 0.75,
          long_context: 0.76
        }
      },
      {
        id: 'gpt-4.1',
        provider: 'openai',
        endpoint: '/chat/completions',
        local: false,
        contextWindow: 1047576,
        inputUsdPer1M: 2,
        outputUsdPer1M: 8,
        medianLatencyMs: 1240,
        throughputTokensPerSecond: 118,
        quality: {
          code: 0.91,
          reasoning: 0.9,
          writing: 0.87,
          extraction: 0.84,
          chat: 0.86,
          long_context: 0.9
        }
      },
      {
        id: 'claude-sonnet-4',
        provider: 'anthropic',
        endpoint: '/messages',
        local: false,
        contextWindow: 200000,
        inputUsdPer1M: 3,
        outputUsdPer1M: 15,
        medianLatencyMs: 1500,
        throughputTokensPerSecond: 104,
        quality: {
          code: 0.92,
          reasoning: 0.9,
          writing: 0.91,
          extraction: 0.82,
          chat: 0.88,
          long_context: 0.82
        }
      },
      {
        id: 'deepseek-coder-v2',
        provider: 'openai',
        endpoint: '/chat/completions',
        local: false,
        contextWindow: 128000,
        inputUsdPer1M: 0.14,
        outputUsdPer1M: 0.28,
        medianLatencyMs: 760,
        throughputTokensPerSecond: 155,
        quality: {
          code: 0.84,
          reasoning: 0.72,
          writing: 0.62,
          extraction: 0.66,
          chat: 0.68,
          long_context: 0.62
        }
      }
    ]
  };
}

export function mergeConfig(...configs) {
  return configs.reduce((merged, config) => mergeObject(merged, config ?? {}), {});
}

function mergeObject(left, right) {
  if (Array.isArray(right)) return right;
  if (!isObject(left) || !isObject(right)) return right ?? left;
  const output = { ...left };
  for (const [key, value] of Object.entries(right)) {
    output[key] = mergeObject(output[key], value);
  }
  return output;
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
