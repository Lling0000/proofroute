export class AgentRuntime {
  constructor(config) {
    this.config = config;
  }

  async executeChatCompletion({ body, decision }) {
    const provider = this.config.providers?.[decision.model.provider];
    if (!provider) throw new Error(`Provider "${decision.model.provider}" is not configured.`);
    if (provider.kind === 'ollama' || decision.model.local) {
      return this.callOllama({ provider, body, decision });
    }
    if (decision.model.provider === 'anthropic') {
      return this.callAnthropic({ provider, body, decision });
    }
    return this.callOpenAICompatible({ provider, body, decision });
  }

  async benchmark({ prompt, runs, controller, policy }) {
    const samples = [];
    for (let index = 0; index < runs; index += 1) {
      const startedAt = performance.now();
      const decision = controller.route({ prompt, policy });
      const controllerLatencyMs = Math.max(0.01, performance.now() - startedAt);
      samples.push({
        decision,
        controllerLatencyMs,
        simulatedEndToEndMs: decision.performance.estimatedLatencyMs + controllerLatencyMs
      });
      await microYield();
    }
    const latest = samples[samples.length - 1].decision;
    const controllerLatencies = samples.map((sample) => sample.controllerLatencyMs);
    const savedUsd = samples.reduce((total, sample) => total + sample.decision.economics.savingsUsd, 0);
    return {
      prompt,
      runs,
      decision: latest,
      controller: {
        p50Ms: percentile(controllerLatencies, 0.5),
        p95Ms: percentile(controllerLatencies, 0.95),
        maxMs: Math.max(...controllerLatencies)
      },
      aggregate: {
        savedUsd,
        averageSpeedup: average(samples.map((sample) => sample.decision.performance.speedup)),
        totalEstimatedMs: samples.reduce((total, sample) => total + sample.simulatedEndToEndMs, 0)
      },
      samples
    };
  }

  async calibrate({ samples, controller, policy }) {
    const startedAt = performance.now();
    const rows = [];
    for (const sample of samples) {
      const rowStartedAt = performance.now();
      const decision = controller.route({ prompt: sample.prompt, tokens: sample.tokens, policy });
      rows.push({
        id: sample.id,
        expectedIntent: sample.intent,
        prompt: sample.prompt,
        actualIntent: decision.intent.name,
        matched: sample.intent ? sample.intent === decision.intent.name : undefined,
        model: decision.model.id,
        provider: decision.model.provider,
        confidence: decision.confidence,
        savingsUsd: decision.economics.savingsUsd,
        speedup: decision.performance.speedup,
        latencyMs: Math.max(0.01, performance.now() - rowStartedAt)
      });
      await microYield();
    }
    const latencies = rows.map((row) => row.latencyMs);
    const labeled = rows.filter((row) => typeof row.matched === 'boolean');
    return {
      elapsedMs: Math.max(0.01, performance.now() - startedAt),
      samples: rows,
      aggregate: {
        count: rows.length,
        labeled: labeled.length,
        accuracy: labeled.length ? labeled.filter((row) => row.matched).length / labeled.length : undefined,
        savingsUsd: rows.reduce((total, row) => total + row.savingsUsd, 0),
        averageSpeedup: average(rows.map((row) => row.speedup)),
        p95RouterMs: percentile(latencies, 0.95),
        intents: countBy(rows.map((row) => row.actualIntent)),
        models: countBy(rows.map((row) => row.model))
      }
    };
  }

  async planAgents({ prompt, controller, policy }) {
    const agents = splitAgentWork(prompt);
    const startedAt = performance.now();
    const assignments = await Promise.all(agents.map(async (agent) => {
      await microYield();
      const decision = controller.route({ prompt: `${agent.brief}\n\n${prompt}`, policy });
      return {
        ...agent,
        model: decision.model.id,
        provider: decision.model.provider,
        intent: decision.intent.name,
        confidence: decision.confidence,
        estimatedCostUsd: decision.economics.estimatedCostUsd,
        savingsUsd: decision.economics.savingsUsd,
        estimatedLatencyMs: decision.performance.estimatedLatencyMs
      };
    }));
    return {
      prompt,
      elapsedMs: Math.max(0.01, performance.now() - startedAt),
      assignments,
      aggregate: {
        estimatedCostUsd: assignments.reduce((total, assignment) => total + assignment.estimatedCostUsd, 0),
        savingsUsd: assignments.reduce((total, assignment) => total + assignment.savingsUsd, 0),
        criticalPathMs: Math.max(...assignments.map((assignment) => assignment.estimatedLatencyMs))
      }
    };
  }

  modelList({ controller }) {
    const created = Math.floor(Date.now() / 1000);
    return {
      object: 'list',
      data: controller.executableModels().map((model) => ({
        id: model.id,
        object: 'model',
        created,
        owned_by: model.provider,
        llm_router: {
          provider: model.provider,
          local: Boolean(model.local),
          context_window: model.contextWindow,
          input_usd_per_1m: model.inputUsdPer1M,
          output_usd_per_1m: model.outputUsdPer1M,
          median_latency_ms: model.medianLatencyMs
        }
      }))
    };
  }

  readiness({ controller }) {
    const executable = controller.executableModels();
    const providers = [...new Set(executable.map((model) => model.provider))].sort();
    return {
      ok: executable.length > 0,
      name: 'llm-router',
      executable_models: executable.length,
      providers,
      local_models: executable.filter((model) => model.local).length,
      cloud_models: executable.filter((model) => !model.local).length
    };
  }

  async callOpenAICompatible({ provider, body, decision }) {
    if (!provider.apiKey) throw new Error(`Provider "${decision.model.provider}" needs an apiKey.`);
    const upstreamBody = JSON.stringify({ ...body, model: decision.model.id });
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}${decision.model.endpoint}`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${provider.apiKey}`,
        'content-type': 'application/json'
      },
      body: upstreamBody
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer())
    };
  }

  async callAnthropic({ provider, body, decision }) {
    if (!provider.apiKey) throw new Error(`Provider "${decision.model.provider}" needs an apiKey.`);
    const messages = Array.isArray(body.messages) ? body.messages : [{ role: 'user', content: String(body.prompt ?? '') }];
    const system = messages.filter((message) => message.role === 'system').map((message) => String(message.content ?? '')).join('\n\n');
    const anthropicMessages = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: String(message.content ?? '') }));
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}${decision.model.endpoint}`, {
      method: 'POST',
      headers: {
        'x-api-key': provider.apiKey,
        'anthropic-version': provider.version ?? '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: decision.model.id,
        max_tokens: body.max_tokens ?? decision.outputTokens,
        system: system || undefined,
        messages: anthropicMessages
      })
    });
    const raw = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: raw };
    }
    const payload = JSON.parse(raw.toString('utf8'));
    const content = Array.isArray(payload.content) ? payload.content.map((part) => part.text ?? '').join('') : '';
    return {
      status: response.status,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(toOpenAIResponse({ message: { content }, done: true }, decision))
    };
  }

  async callOllama({ provider, body, decision }) {
    const messages = Array.isArray(body.messages) ? body.messages : [{ role: 'user', content: String(body.prompt ?? '') }];
    const response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}${decision.model.endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: decision.model.id,
        messages,
        stream: Boolean(body.stream)
      })
    });
    const raw = Buffer.from(await response.arrayBuffer());
    if (body.stream) {
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body: raw };
    }
    return {
      status: response.status,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(toOpenAIResponse(JSON.parse(raw.toString('utf8')), decision))
    };
  }
}

function toOpenAIResponse(payload, decision) {
  const content = payload.message?.content ?? payload.response ?? '';
  return JSON.stringify({
    id: `llm-router-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: decision.model.id,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: payload.done ? 'stop' : 'length'
      }
    ],
    usage: {
      prompt_tokens: decision.inputTokens,
      completion_tokens: decision.outputTokens,
      total_tokens: decision.inputTokens + decision.outputTokens
    }
  });
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? 0;
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function microYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function splitAgentWork(prompt) {
  const lower = prompt.toLowerCase();
  const agents = [
    {
      id: 'architect',
      brief: 'Analyze architecture, constraints, hidden coupling, and the safest implementation path.'
    },
    {
      id: 'builder',
      brief: 'Implement the requested change with code-aware precision and pragmatic defaults.'
    },
    {
      id: 'reviewer',
      brief: 'Review the result for bugs, regressions, missing tests, and operational risk.'
    }
  ];
  if (/readme|launch|copy|docs|documentation|brand/.test(lower)) {
    agents.push({
      id: 'growth-writer',
      brief: 'Shape the public narrative, README language, launch framing, and shareable proof.'
    });
  }
  if (/json|csv|extract|parse|schema|dataset/.test(lower)) {
    agents.push({
      id: 'extractor',
      brief: 'Extract structured facts, schemas, and machine-readable outputs without losing fidelity.'
    });
  }
  return agents;
}
