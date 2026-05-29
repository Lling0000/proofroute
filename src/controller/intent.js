const INTENTS = [
  {
    name: 'code',
    weights: {
      code: 3.2,
      refactor: 2.6,
      bug: 2.4,
      test: 1.7,
      function: 1.6,
      typescript: 1.9,
      python: 1.7,
      rust: 1.7,
      sql: 1.5,
      api: 1.4,
      stacktrace: 2.4,
      exception: 1.7
    }
  },
  {
    name: 'reasoning',
    weights: {
      prove: 2.4,
      reason: 2.2,
      derive: 2,
      math: 1.8,
      theorem: 2.4,
      strategy: 1.5,
      compare: 1.3,
      tradeoff: 1.5,
      algorithm: 1.9,
      optimize: 1.6
    }
  },
  {
    name: 'writing',
    weights: {
      write: 1.6,
      rewrite: 2.2,
      email: 2.1,
      memo: 1.8,
      story: 2.1,
      tone: 1.7,
      brand: 1.7,
      launch: 1.4,
      readme: 1.5,
      narrative: 1.7
    }
  },
  {
    name: 'extraction',
    weights: {
      extract: 2.6,
      classify: 2.1,
      json: 2,
      csv: 1.6,
      parse: 1.8,
      table: 1.3,
      entities: 2.1,
      summarize: 1.5,
      schema: 1.7
    }
  },
  {
    name: 'long_context',
    weights: {
      document: 1.6,
      transcript: 1.6,
      repository: 1.5,
      codebase: 1.8,
      analyze: 1.4,
      audit: 1.6,
      migration: 1.4,
      architecture: 1.5
    }
  },
  {
    name: 'chat',
    weights: {
      explain: 1.4,
      help: 1.2,
      brainstorm: 1.3,
      idea: 1.1,
      ask: 1,
      simple: 1,
      quick: 1
    }
  }
];

export function classifyIntent(prompt) {
  const text = normalize(prompt);
  const tokens = tokenize(text);
  const lengthScore = Math.min(2.2, prompt.length / 24000);
  const features = {
    chars: prompt.length,
    tokens: estimateTokens(prompt),
    hasCodeFence: /```/.test(prompt),
    hasJson: /[{[]\s*["\w-]+["\w-]*\s*:/.test(prompt),
    hasStackTrace: /at\s+\S+\s+\(|Traceback|Exception|Error:/.test(prompt)
  };
  const scores = {};
  for (const intent of INTENTS) {
    let score = 0.05;
    for (const token of tokens) score += intent.weights[token] ?? 0;
    if (intent.name === 'code' && features.hasCodeFence) score += 2.8;
    if (intent.name === 'code' && features.hasStackTrace) score += 2.1;
    if (intent.name === 'extraction' && features.hasJson) score += 1.4;
    if (intent.name === 'long_context') score += lengthScore;
    scores[intent.name] = score;
  }
  const distribution = stableSoftmax(Object.values(scores), 0.72);
  const ranked = Object.keys(scores)
    .map((name, index) => ({ name, score: scores[name], probability: distribution[index] }))
    .sort((a, b) => b.probability - a.probability);
  return {
    name: ranked[0].name,
    confidence: ranked[0].probability,
    ranked,
    features
  };
}

export function estimateTokens(text) {
  const cjk = (text.match(/[\u3400-\u9FFF]/g) ?? []).length;
  const ascii = Math.max(0, text.length - cjk);
  return Math.max(1, Math.ceil(cjk * 0.85 + ascii / 4));
}

export function stableSoftmax(values, temperature = 1) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const safeTemperature = Number.isFinite(temperature) && temperature > 0 ? temperature : 1;
  const scaled = values.map((value) => Number.isFinite(value) ? value / safeTemperature : Number.NEGATIVE_INFINITY);
  const max = Math.max(...scaled);
  if (max === Number.NEGATIVE_INFINITY) return values.map(() => 1 / values.length);
  const exps = scaled.map((value) => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) return values.map(() => 1 / values.length);
  return exps.map((value) => value / sum);
}

function normalize(prompt) {
  return prompt.toLowerCase().replace(/[_./:-]/g, ' ');
}

function tokenize(text) {
  return (text.match(/[a-z0-9]+|[\u3400-\u9FFF]+/g) ?? []).flatMap((token) => {
    const normalized = normalizeToken(token);
    return normalized === token ? [token] : [token, normalized];
  });
}

function normalizeToken(token) {
  if (!/^[a-z]+$/.test(token) || token.length < 5) return token;
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('offs')) return token.slice(0, -1);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}
