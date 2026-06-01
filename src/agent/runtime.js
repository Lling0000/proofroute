import { ROUTING_POLICIES } from '../controller/route-controller.js';

export class AgentRuntime {
  constructor(config) {
    this.config = config;
  }

  async executeChatCompletion({ body, decision }) {
    const provider = this.config.providers?.[decision.model.provider];
    if (!provider) throw new Error(`Provider "${decision.model.provider}" is not configured.`);
    if (provider.kind === 'ollama') {
      return this.callOllama({ provider, body, decision });
    }
    if (provider.kind === 'anthropic' || decision.model.provider === 'anthropic') {
      return this.callAnthropic({ provider, body, decision });
    }
    return this.callOpenAICompatible({ provider, body, decision });
  }

  async executeRoutedChatCompletion({ body, decision }) {
    const primary = await this.tryExecution({ body, decision });
    if (!shouldRetryFallback(primary.status) || !decision.fallback || decision.fallback.model === decision.model.id) {
      return { ...primary, decision };
    }
    const fallbackDecision = this.fallbackDecision(decision);
    if (!fallbackDecision) return { ...primary, decision };
    const fallback = await this.tryExecution({ body, decision: fallbackDecision });
    return {
      ...fallback,
      decision: fallbackDecision,
      fallback: {
        from: decision.model.id,
        to: fallbackDecision.model.id,
        status: primary.status
      }
    };
  }

  async tryExecution({ body, decision }) {
    try {
      return await this.executeChatCompletion({ body, decision });
    } catch (error) {
      return {
        status: 599,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ error: { message: error.message } }))
      };
    }
  }

  fallbackDecision(decision) {
    const model = this.config.models?.find((entry) => entry.id === decision.fallback.model);
    if (!model) return undefined;
    return {
      ...decision,
      model,
      confidence: decision.fallback.probability,
      economics: {
        ...decision.economics,
        estimatedCostUsd: decision.fallback.estimatedCostUsd
      },
      performance: {
        ...decision.performance,
        estimatedLatencyMs: decision.fallback.estimatedLatencyMs
      }
    };
  }

  async fetchProvider(url, options, provider) {
    const timeoutMs = normalizeTimeoutMs(provider.timeoutMs ?? this.config.router?.upstreamTimeoutMs ?? 120000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async executeResponse({ body, decision }) {
    const upstream = await this.executeRoutedChatCompletion({
      body: responsesBodyToChatBody(body, decision),
      decision
    });
    const routedDecision = upstream.decision ?? decision;
    if (body.stream) {
      return {
        status: upstream.status,
        headers: {
          ...upstream.headers,
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache'
        },
        body: chatSseToResponseSse(upstream.body, routedDecision),
        decision: routedDecision,
        fallback: upstream.fallback
      };
    }
    if (upstream.status < 200 || upstream.status >= 300) return upstream;
    try {
      const payload = JSON.parse(Buffer.from(upstream.body).toString('utf8'));
      return {
        status: upstream.status,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(toResponseObject(payload, routedDecision))),
        decision: routedDecision,
        fallback: upstream.fallback
      };
    } catch {
      return upstream;
    }
  }

  async executeCompletion({ body, decision }) {
    const upstream = await this.executeRoutedChatCompletion({
      body: completionBodyToChatBody(body, decision),
      decision
    });
    const routedDecision = upstream.decision ?? decision;
    if (body.stream) {
      return {
        status: upstream.status,
        headers: {
          ...upstream.headers,
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache'
        },
        body: chatSseToCompletionSse(upstream.body, routedDecision),
        decision: routedDecision,
        fallback: upstream.fallback
      };
    }
    if (upstream.status < 200 || upstream.status >= 300) return upstream;
    try {
      const payload = JSON.parse(Buffer.from(upstream.body).toString('utf8'));
      return {
        status: upstream.status,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(toCompletionObject(payload, routedDecision))),
        decision: routedDecision,
        fallback: upstream.fallback
      };
    } catch {
      return upstream;
    }
  }

  async benchmark({ prompt, runs, controller, policy }) {
    const samples = [];
    for (let index = 0; index < runs; index += 1) {
      const startedAt = performance.now();
      const decision = await route(controller, { prompt, policy });
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
    const routeStartedAt = performance.now();
    const decisions = await routeMany(controller, samples.map((sample) => ({ prompt: sample.prompt, tokens: sample.tokens, outputTokens: sample.outputTokens, policy })));
    const routeLatencyMs = Math.max(0.01, (performance.now() - routeStartedAt) / Math.max(1, samples.length));
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const decision = decisions[index];
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
        estimatedLatencyMs: decision.performance.estimatedLatencyMs,
        routerOverheadPct: routerOverheadPercent(routeLatencyMs, decision.performance.estimatedLatencyMs),
        latencyMs: routeLatencyMs
      });
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
        p95RouterOverheadPct: percentile(rows.map((row) => row.routerOverheadPct), 0.95),
        intents: countBy(rows.map((row) => row.actualIntent)),
        models: countBy(rows.map((row) => row.model))
      }
    };
  }

  async launchDemo({ controller, policy, samples = launchDemoSamples() }) {
    const startedAt = performance.now();
    const routes = [];
    const routeStartedAt = performance.now();
    const decisions = await routeMany(controller, samples.map((sample) => ({ prompt: sample.prompt, policy })));
    const routeLatencyMs = Math.max(0.01, (performance.now() - routeStartedAt) / Math.max(1, samples.length));
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const decision = decisions[index];
      const classifierFeatures = decision.intent.features ?? {};
      routes.push({
        id: sample.id,
        prompt: sample.prompt,
        expectedIntent: sample.intent,
        actualIntent: decision.intent.name,
        matched: sample.intent ? sample.intent === decision.intent.name : undefined,
        model: decision.model.id,
        provider: decision.model.provider,
        local: Boolean(decision.model.local),
        policy: decision.policy,
        classifierBackend: classifierFeatures.backend ?? 'unknown',
        classifierCircuitOpen: Boolean(classifierFeatures.classifierCircuitOpen),
        confidence: decision.confidence,
        inputTokens: decision.inputTokens,
        outputTokens: decision.outputTokens,
        estimatedCostUsd: decision.economics.estimatedCostUsd,
        baselineCostUsd: decision.economics.baselineCostUsd,
        savingsUsd: decision.economics.savingsUsd,
        savingsPct: decision.economics.savingsPct,
        speedup: decision.performance.speedup,
        estimatedLatencyMs: decision.performance.estimatedLatencyMs,
        routerOverheadPct: routerOverheadPercent(routeLatencyMs, decision.performance.estimatedLatencyMs),
        latencyMs: routeLatencyMs
      });
    }
    const latencies = routes.map((row) => row.latencyMs);
    const totalBaselineCostUsd = routes.reduce((total, row) => total + row.baselineCostUsd, 0);
    const totalSavingsUsd = routes.reduce((total, row) => total + row.savingsUsd, 0);
    const labeled = routes.filter((row) => typeof row.matched === 'boolean');
    return {
      elapsedMs: Math.max(0.01, performance.now() - startedAt),
      routes,
      aggregate: {
        count: routes.length,
        labeled: labeled.length,
        accuracy: labeled.length ? labeled.filter((row) => row.matched).length / labeled.length : undefined,
        p95RouterMs: percentile(latencies, 0.95),
        savingsUsd: totalSavingsUsd,
        savingsPct: totalBaselineCostUsd > 0 ? totalSavingsUsd / totalBaselineCostUsd : 0,
        estimatedCostUsd: routes.reduce((total, row) => total + row.estimatedCostUsd, 0),
        baselineCostUsd: totalBaselineCostUsd,
        averageSpeedup: average(routes.map((row) => row.speedup)),
        p95RouterOverheadPct: percentile(routes.map((row) => row.routerOverheadPct), 0.95),
        localRoutes: routes.filter((row) => row.local).length,
        cloudRoutes: routes.filter((row) => !row.local).length,
        intents: countBy(routes.map((row) => row.actualIntent)),
        policies: countBy(routes.map((row) => row.policy)),
        classifierBackends: countBy(routes.map((row) => row.classifierBackend ?? 'unknown')),
        classifierCircuitOpen: routes.filter((row) => row.classifierCircuitOpen).length,
        models: countBy(routes.map((row) => row.model)),
        providers: countBy(routes.map((row) => row.provider))
      }
    };
  }

  async prove({ controller, policy, thresholds = {}, samples = launchDemoSamples(), summary, source = 'demo', path } = {}) {
    const demo = summary ? undefined : await this.launchDemo({ controller, policy, samples });
    const aggregate = normalizeProofAggregate(summary ?? demo.aggregate);
    const resolved = {
      maxP95Ms: normalizeThreshold(thresholds.maxP95Ms, 5),
      minSavingsUsd: normalizeThreshold(thresholds.minSavingsUsd, 0.001),
      minSpeedup: normalizeThreshold(thresholds.minSpeedup, 1.1),
      minRequests: normalizeThreshold(thresholds.minRequests, 1)
    };
    const wantsAccuracy = source === 'demo' || thresholds.minAccuracy !== undefined;
    if (wantsAccuracy) resolved.minAccuracy = normalizeThreshold(thresholds.minAccuracy, 0.8);
    if (thresholds.maxClassifierCircuitOpen !== undefined) {
      resolved.maxClassifierCircuitOpen = normalizeThreshold(thresholds.maxClassifierCircuitOpen, 0);
    }
    if (thresholds.maxRouterOverheadPct !== undefined) {
      resolved.maxRouterOverheadPct = normalizeThreshold(thresholds.maxRouterOverheadPct, 1);
    }
    const checks = [
      proofCheck({ id: 'requests', label: 'requests', value: aggregate.count, target: resolved.minRequests, direction: 'min', unit: 'count' }),
      proofCheck({ id: 'router_p95', label: 'router p95', value: aggregate.p95RouterMs, target: resolved.maxP95Ms, direction: 'max', unit: 'ms' }),
      proofCheck({ id: 'savings', label: 'money saved', value: aggregate.savingsUsd, target: resolved.minSavingsUsd, direction: 'min', unit: 'usd' }),
      proofCheck({ id: 'speedup', label: 'speed lift', value: aggregate.averageSpeedup, target: resolved.minSpeedup, direction: 'min', unit: 'x' })
    ];
    if (wantsAccuracy) checks.push(proofCheck({ id: 'accuracy', label: 'intent accuracy', value: aggregate.accuracy ?? 0, target: resolved.minAccuracy, direction: 'min', unit: 'ratio' }));
    if (resolved.maxClassifierCircuitOpen !== undefined) {
      checks.push(proofCheck({ id: 'classifier_circuit', label: 'classifier guard', value: aggregate.classifierCircuitOpen, target: resolved.maxClassifierCircuitOpen, direction: 'max', unit: 'count' }));
    }
    if (resolved.maxRouterOverheadPct !== undefined) {
      checks.push(proofCheck({ id: 'router_overhead', label: 'router overhead', value: aggregate.p95RouterOverheadPct, target: resolved.maxRouterOverheadPct, direction: 'max', unit: 'percent' }));
    }
    return {
      status: checks.every((check) => check.pass) ? 'pass' : 'fail',
      source: summary ? source : 'demo',
      path,
      thresholds: resolved,
      aggregate,
      checks,
      demo
    };
  }

  async planAgents({ prompt, controller, policy }) {
    const agents = splitAgentWork(prompt);
    const startedAt = performance.now();
    const decisions = await routeMany(controller, agents.map((agent) => ({ prompt: `${agent.brief}\n\n${prompt}`, policy })));
    const assignments = agents.map((agent, index) => {
      const decision = decisions[index];
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
    });
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

  async executeAgentPlan({ prompt, controller, policy, maxTokens = 160 }) {
    const agents = splitAgentWork(prompt);
    const startedAt = performance.now();
    const routeStartedAt = performance.now();
    const decisions = await routeMany(controller, agents.map((agent) => ({
      prompt: `${agent.brief}\n\n${prompt}`,
      executableOnly: true,
      policy,
      outputTokens: maxTokens
    })));
    const routerDecisionMs = Math.max(0.01, (performance.now() - routeStartedAt) / Math.max(1, agents.length));
    const assignments = await Promise.all(agents.map((agent, index) => this.executeAgentDecision({
      agent,
      prompt,
      decision: decisions[index],
      routerDecisionMs,
      maxTokens
    })));
    const elapsedMs = Math.max(0.01, performance.now() - startedAt);
    const ok = assignments.filter((assignment) => assignment.status >= 200 && assignment.status < 300).length;
    return {
      status: ok === assignments.length ? 'pass' : ok > 0 ? 'warn' : 'fail',
      prompt,
      elapsedMs,
      assignments,
      aggregate: {
        count: assignments.length,
        ok,
        failed: assignments.length - ok,
        estimatedCostUsd: assignments.reduce((total, assignment) => total + assignment.estimatedCostUsd, 0),
        savingsUsd: assignments.reduce((total, assignment) => total + assignment.savingsUsd, 0),
        actualTokens: assignments.reduce((total, assignment) => total + assignment.actualTokens, 0),
        criticalPathMs: Math.max(...assignments.map((assignment) => assignment.executionMs)),
        routerMs: assignments.reduce((total, assignment) => total + assignment.routerDecisionMs, 0)
      }
    };
  }

  async executeAgentRole({ agent, prompt, controller, policy, maxTokens }) {
    const routeStartedAt = performance.now();
    const routedPrompt = `${agent.brief}\n\n${prompt}`;
    const decision = await route(controller, { prompt: routedPrompt, executableOnly: true, policy, outputTokens: maxTokens });
    const routerDecisionMs = Math.max(0.01, performance.now() - routeStartedAt);
    return this.executeAgentDecision({ agent, prompt, decision, routerDecisionMs, maxTokens });
  }

  async executeAgentDecision({ agent, prompt, decision, routerDecisionMs, maxTokens }) {
    const executeStartedAt = performance.now();
    const upstream = await this.executeRoutedChatCompletion({
      decision,
      body: {
        messages: [
          { role: 'system', content: agent.brief },
          { role: 'user', content: prompt }
        ],
        max_tokens: maxTokens
      }
    });
    const executionMs = Math.max(0.01, performance.now() - executeStartedAt);
    const payload = parseJsonBody(upstream.body);
    const outputText = payload ? chatPayloadText(payload) : '';
    const usage = normalizeChatUsage(payload?.usage);
    const finalDecision = upstream.decision ?? decision;
    return {
      ...agent,
      model: finalDecision.model.id,
      provider: finalDecision.model.provider,
      intent: finalDecision.intent.name,
      confidence: finalDecision.confidence,
      status: upstream.status,
      routerDecisionMs,
      executionMs,
      estimatedCostUsd: finalDecision.economics.estimatedCostUsd,
      savingsUsd: finalDecision.economics.savingsUsd,
      estimatedLatencyMs: finalDecision.performance.estimatedLatencyMs,
      actualTokens: usage?.totalTokens ?? 0,
      outputText,
      error: payload?.error?.message,
      fallback: upstream.fallback
    };
  }

  modelList({ controller }) {
    const created = Math.floor(Date.now() / 1000);
    const policyAliases = ['auto', ...ROUTING_POLICIES].map((policy) => ({
      id: `proofroute/${policy}`,
      object: 'model',
      created,
      owned_by: 'proofroute',
      proofroute: {
        virtual: true,
        policy: policy === 'auto' ? 'balanced' : policy,
        description: policyDescription(policy),
        controls: {
          model_alias: `proofroute/${policy}`,
          header: 'x-proofroute-policy',
          metadata: 'proofroute_policy',
          max_cost_header: 'x-proofroute-max-cost-usd',
          max_latency_header: 'x-proofroute-max-latency-ms'
        },
        transparent_proxy: true
      }
    }));
    return {
      object: 'list',
      data: [
        ...policyAliases,
        ...controller.executableModels().map((model) => ({
          id: model.id,
          object: 'model',
          created,
          owned_by: model.provider,
          proofroute: {
            virtual: false,
            executable: true,
            provider: model.provider,
            local: Boolean(model.local),
            context_window: model.contextWindow,
            input_usd_per_1m: model.inputUsdPer1M,
            output_usd_per_1m: model.outputUsdPer1M,
            median_latency_ms: model.medianLatencyMs,
            throughput_tokens_per_second: model.throughputTokensPerSecond,
            best_intent: bestModelIntent(model)
          }
        }))
      ]
    };
  }

  catalog({ controller, intents = defaultIntents() }) {
    const executableIds = new Set(controller.executableModels().map((model) => model.id));
    const models = (this.config.models ?? []).map((model) => {
      const quality = Object.fromEntries(intents.map((intent) => [intent, model.quality?.[intent] ?? model.quality?.chat ?? 0]));
      const bestIntent = bestEntry(Object.entries(quality), ([, value]) => value);
      return {
        id: model.id,
        provider: model.provider,
        local: Boolean(model.local),
        executable: executableIds.has(model.id),
        contextWindow: model.contextWindow,
        inputUsdPer1M: model.inputUsdPer1M,
        outputUsdPer1M: model.outputUsdPer1M,
        medianLatencyMs: model.medianLatencyMs,
        throughputTokensPerSecond: model.throughputTokensPerSecond,
        bestIntent: bestIntent?.[0] ?? 'chat',
        bestQuality: bestIntent?.[1] ?? 0,
        quality
      };
    });
    const executable = models.filter((model) => model.executable);
    const comparisonPool = executable.length ? executable : models;
    return {
      summary: {
        count: models.length,
        executable: executable.length,
        local: models.filter((model) => model.local).length,
        cloud: models.filter((model) => !model.local).length,
        free: models.filter((model) => model.inputUsdPer1M === 0 && model.outputUsdPer1M === 0).length,
        intents: intents.length
      },
      leaders: {
        cheapestExecutable: pickModel(comparisonPool, (model) => model.inputUsdPer1M + model.outputUsdPer1M, 'min'),
        fastestExecutable: pickModel(comparisonPool, (model) => model.medianLatencyMs, 'min'),
        largestContext: pickModel(models, (model) => model.contextWindow, 'max')
      },
      intentLeaders: intents.map((intent) => {
        const leader = pickModel(models, (model) => model.quality[intent], 'max');
        return {
          intent,
          model: leader?.id,
          provider: leader?.provider,
          quality: leader?.quality[intent] ?? 0,
          executable: Boolean(leader?.executable)
        };
      }),
      models
    };
  }

  readiness({ controller }) {
    const executable = controller.executableModels();
    const providers = [...new Set(executable.map((model) => model.provider))].sort();
    return {
      ok: executable.length > 0,
      name: 'proofroute',
      executable_models: executable.length,
      providers,
      local_models: executable.filter((model) => model.local).length,
      cloud_models: executable.filter((model) => !model.local).length
    };
  }

  async callOpenAICompatible({ provider, body, decision }) {
    if (!provider.apiKey && !decision.model.local && provider.requiresApiKey !== false) {
      throw new Error(`Provider "${decision.model.provider}" needs an apiKey.`);
    }
    const headers = {
      'content-type': 'application/json'
    };
    if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
    const upstreamBody = JSON.stringify({ ...body, model: decision.model.id });
    const response = await this.fetchProvider(`${provider.baseUrl.replace(/\/$/, '')}${decision.model.endpoint}`, {
      method: 'POST',
      headers,
      body: upstreamBody
    }, provider);
    if (body.stream) {
      return {
        status: response.status,
        headers: {
          ...Object.fromEntries(response.headers.entries()),
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache'
        },
        body: response.body
      };
    }
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
    const response = await this.fetchProvider(`${provider.baseUrl.replace(/\/$/, '')}${decision.model.endpoint}`, {
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
        messages: anthropicMessages,
        stream: Boolean(body.stream)
      })
    }, provider);
    if (body.stream) {
      return {
        status: response.status,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache'
        },
        body: anthropicSseToOpenAIStream(response.body, decision)
      };
    }
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
    const response = await this.fetchProvider(`${provider.baseUrl.replace(/\/$/, '')}${decision.model.endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: decision.model.id,
        messages,
        stream: Boolean(body.stream)
      })
    }, provider);
    if (body.stream) {
      return {
        status: response.status,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache'
        },
        body: ollamaNdjsonToOpenAIStream(response.body, decision)
      };
    }
    const raw = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(toOpenAIResponse(JSON.parse(raw.toString('utf8')), decision))
    };
  }
}

function shouldRetryFallback(status) {
  return status === 429 || status >= 500;
}

function normalizeTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120000;
}

export async function* ollamaNdjsonToOpenAIStream(stream, decision) {
  const decoder = new TextDecoder();
  let buffer = '';
  let completionTokens = 0;
  let sentDone = false;
  yield sseData(toOpenAIChunk({ content: '', decision, role: 'assistant', finishReason: null }));
  for await (const chunk of stream) {
    buffer += decodeStreamChunk(decoder, chunk);
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const event = parseOllamaLine(line);
      if (!event) continue;
      if (event.error) {
        yield sseData({ error: { message: event.error } });
        continue;
      }
      const content = event.message?.content ?? event.response ?? '';
      if (content) {
        completionTokens += Math.max(1, Math.ceil(content.length / 4));
        yield sseData(toOpenAIChunk({ content, decision, finishReason: null }));
      }
      if (event.done) {
        yield sseData(toOpenAIChunk({ content: '', decision, finishReason: 'stop', completionTokens }));
        yield 'data: [DONE]\n\n';
        sentDone = true;
      }
    }
  }
  const tail = parseOllamaLine(buffer);
  if (tail && !sentDone) {
    if (tail.error) {
      yield sseData({ error: { message: tail.error } });
    }
    const content = tail.message?.content ?? tail.response ?? '';
    if (content) {
      completionTokens += Math.max(1, Math.ceil(content.length / 4));
      yield sseData(toOpenAIChunk({ content, decision, finishReason: null }));
    }
  }
  if (tail?.done && !sentDone) {
    yield sseData(toOpenAIChunk({ content: '', decision, finishReason: 'stop', completionTokens }));
    yield 'data: [DONE]\n\n';
  }
}

export async function* anthropicSseToOpenAIStream(stream, decision) {
  const decoder = new TextDecoder();
  let buffer = '';
  let completionTokens = 0;
  let sentDone = false;
  yield sseData(toOpenAIChunk({ content: '', decision, role: 'assistant', finishReason: null }));
  for await (const chunk of stream) {
    buffer += decodeStreamChunk(decoder, chunk);
    const events = buffer.split(/\n\n+/);
    buffer = events.pop() ?? '';
    for (const event of events) {
      const payload = parseAnthropicEvent(event);
      if (!payload) continue;
      if (payload.type === 'content_block_delta') {
        const content = payload.delta?.text ?? '';
        if (content) {
          completionTokens += Math.max(1, Math.ceil(content.length / 4));
          yield sseData(toOpenAIChunk({ content, decision, finishReason: null }));
        }
      }
      if (payload.type === 'message_delta' && payload.delta?.stop_reason) {
        yield sseData(toOpenAIChunk({ content: '', decision, finishReason: normalizeFinishReason(payload.delta.stop_reason), completionTokens }));
      }
      if (payload.type === 'message_stop') {
        yield 'data: [DONE]\n\n';
        sentDone = true;
      }
      if (payload.type === 'error') {
        yield sseData({ error: { message: payload.error?.message ?? 'Anthropic stream error' } });
      }
    }
  }
  const tail = parseAnthropicEvent(buffer);
  if (tail?.type === 'message_stop' && !sentDone) yield 'data: [DONE]\n\n';
}

export async function* chatSseToResponseSse(stream, decision) {
  const decoder = new TextDecoder();
  const responseId = `resp_${Date.now()}`;
  const messageId = `msg_${Date.now()}`;
  let buffer = '';
  let text = '';
  yield sseEvent('response.created', {
    type: 'response.created',
    response: toResponseObject({ choices: [{ message: { content: '' } }] }, decision, { responseId, messageId, status: 'in_progress' })
  });
  for await (const chunk of stream) {
    buffer += decodeStreamChunk(decoder, chunk);
    const frames = buffer.split(/\n\n+/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = parseSseData(frame);
      if (!data || data === '[DONE]') continue;
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        yield sseEvent('response.error', {
          type: 'response.error',
          error: {
            message: `Invalid chat stream frame: ${data.slice(0, 80)}`
          }
        });
        continue;
      }
      const delta = payload.choices?.map((choice) => choice.delta?.content ?? '').join('') ?? '';
      if (delta) {
        text += delta;
        yield sseEvent('response.output_text.delta', {
          type: 'response.output_text.delta',
          response_id: responseId,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          delta
        });
      }
    }
  }
  const tail = parseSseData(buffer);
  if (tail && tail !== '[DONE]') {
    try {
      const payload = JSON.parse(tail);
      const delta = payload.choices?.map((choice) => choice.delta?.content ?? '').join('') ?? '';
      if (delta) {
        text += delta;
        yield sseEvent('response.output_text.delta', {
          type: 'response.output_text.delta',
          response_id: responseId,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          delta
        });
      }
    } catch {
      yield sseEvent('response.error', {
        type: 'response.error',
        error: {
          message: `Invalid chat stream frame: ${tail.slice(0, 80)}`
        }
      });
    }
  }
  yield sseEvent('response.output_text.done', {
    type: 'response.output_text.done',
    response_id: responseId,
    item_id: messageId,
    output_index: 0,
    content_index: 0,
    text
  });
  yield sseEvent('response.completed', {
    type: 'response.completed',
    response: toResponseObject({ choices: [{ message: { content: text } }] }, decision, { responseId, messageId })
  });
}

export async function* chatSseToCompletionSse(stream, decision) {
  const decoder = new TextDecoder();
  const id = `cmpl_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decodeStreamChunk(decoder, chunk);
    const frames = buffer.split(/\n\n+/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = parseSseData(frame);
      if (!data) continue;
      if (data === '[DONE]') {
        yield 'data: [DONE]\n\n';
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        yield sseData({ error: { message: `Invalid chat stream frame: ${data.slice(0, 80)}` } });
        continue;
      }
      const choices = payload.choices ?? [];
      for (const choice of choices) {
        const text = choice.delta?.content ?? choice.message?.content ?? '';
        if (text || choice.finish_reason) {
          yield sseData({
            id,
            object: 'text_completion.chunk',
            created,
            model: decision.model.id,
            choices: [
              {
                text,
                index: choice.index ?? 0,
                logprobs: null,
                finish_reason: choice.finish_reason ?? null
              }
            ]
          });
        }
      }
    }
  }
  const tail = parseSseData(buffer);
  if (tail && tail !== '[DONE]') {
    try {
      const payload = JSON.parse(tail);
      for (const choice of payload.choices ?? []) {
        const text = choice.delta?.content ?? choice.message?.content ?? '';
        if (text || choice.finish_reason) {
          yield sseData({
            id,
            object: 'text_completion.chunk',
            created,
            model: decision.model.id,
            choices: [
              {
                text,
                index: choice.index ?? 0,
                logprobs: null,
                finish_reason: choice.finish_reason ?? null
              }
            ]
          });
        }
      }
    } catch {
      yield sseData({ error: { message: `Invalid chat stream frame: ${tail.slice(0, 80)}` } });
    }
  }
}

export function responsesInputToText(input) {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return input.map(responsesInputToText).filter(Boolean).join('\n');
  if (!input || typeof input !== 'object') return '';
  if (typeof input.text === 'string') return input.text;
  if (typeof input.content === 'string') return input.content;
  if (Array.isArray(input.content)) return input.content.map(responsesInputToText).filter(Boolean).join('\n');
  return '';
}

function responsesBodyToChatBody(body, decision) {
  const messages = [];
  if (body.instructions) messages.push({ role: 'system', content: String(body.instructions) });
  const inputMessages = responsesInputToMessages(body.input);
  messages.push(...inputMessages);
  if (messages.length === 0) messages.push({ role: 'user', content: String(body.prompt ?? '') });
  return {
    model: decision.model.id,
    messages,
    stream: Boolean(body.stream),
    max_tokens: body.max_output_tokens ?? body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    metadata: body.metadata
  };
}

function completionBodyToChatBody(body, decision) {
  const prompt = Array.isArray(body.prompt) ? body.prompt.join('\n') : String(body.prompt ?? '');
  return {
    model: decision.model.id,
    messages: [{ role: 'user', content: prompt }],
    stream: Boolean(body.stream),
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stop: body.stop,
    metadata: body.metadata
  };
}

function responsesInputToMessages(input) {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (!Array.isArray(input)) {
    const text = responsesInputToText(input);
    return text ? [{ role: 'user', content: text }] : [];
  }
  return input.flatMap((item) => {
    if (typeof item === 'string') return [{ role: 'user', content: item }];
    if (!item || typeof item !== 'object') return [];
    const text = responsesInputToText(item);
    if (!text) return [];
    const role = item.role === 'assistant' || item.role === 'system' ? item.role : 'user';
    return [{ role, content: text }];
  });
}

function toOpenAIResponse(payload, decision) {
  const content = payload.message?.content ?? payload.response ?? '';
  return JSON.stringify({
    id: `proofroute-${Date.now()}`,
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

function toResponseObject(payload, decision, override = {}) {
  const content = chatPayloadText(payload);
  const responseId = override.responseId ?? `resp_${Date.now()}`;
  const messageId = override.messageId ?? `msg_${Date.now()}`;
  const usage = payload.usage ?? {
    input_tokens: decision.inputTokens,
    output_tokens: decision.outputTokens,
    total_tokens: decision.inputTokens + decision.outputTokens
  };
  return {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: override.status ?? 'completed',
    model: decision.model.id,
    output: [
      {
        id: messageId,
        type: 'message',
        status: override.status ?? 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: content,
            annotations: []
          }
        ]
      }
    ],
    output_text: content,
    usage,
    proofroute: {
      model: decision.model.id,
      provider: decision.model.provider,
      intent: decision.intent.name,
      confidence: decision.confidence,
      savings_usd: decision.economics.savingsUsd,
      speedup: decision.performance.speedup
    }
  };
}

function toCompletionObject(payload, decision) {
  const text = chatPayloadText(payload);
  const finishReason = payload.choices?.find((choice) => choice.finish_reason)?.finish_reason ?? 'stop';
  return {
    id: `cmpl_${Date.now()}`,
    object: 'text_completion',
    created: Math.floor(Date.now() / 1000),
    model: decision.model.id,
    choices: [
      {
        text,
        index: 0,
        logprobs: null,
        finish_reason: finishReason
      }
    ],
    usage: payload.usage ?? {
      prompt_tokens: decision.inputTokens,
      completion_tokens: decision.outputTokens,
      total_tokens: decision.inputTokens + decision.outputTokens
    }
  };
}

function chatPayloadText(payload) {
  return payload.choices?.map((choice) => choice.message?.content ?? choice.delta?.content ?? '').join('') ?? '';
}

function parseJsonBody(body) {
  if (!Buffer.isBuffer(body)) return undefined;
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
}

function normalizeChatUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens = usageNumber(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = usageNumber(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = usageNumber(usage.total_tokens ?? (inputTokens ?? 0) + (outputTokens ?? 0));
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0)
  };
}

function usageNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function toOpenAIChunk({ content, decision, role, finishReason, completionTokens = undefined }) {
  const chunk = {
    id: `proofroute-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: decision.model.id,
    choices: [
      {
        index: 0,
        delta: chunkDelta({ role, content }),
        finish_reason: finishReason
      }
    ]
  };
  if (completionTokens !== undefined) {
    chunk.usage = {
      prompt_tokens: decision.inputTokens,
      completion_tokens: completionTokens,
      total_tokens: decision.inputTokens + completionTokens
    };
  }
  return chunk;
}

function chunkDelta({ role, content }) {
  const delta = {};
  if (role) delta.role = role;
  if (content) delta.content = content;
  return delta;
}

function decodeStreamChunk(decoder, chunk) {
  if (typeof chunk === 'string') return chunk;
  return decoder.decode(chunk, { stream: true });
}

function sseData(value) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function sseEvent(event, value) {
  return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
}

function parseSseData(event) {
  return event.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
}

function parseOllamaLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return { error: `Invalid Ollama stream frame: ${trimmed.slice(0, 80)}` };
  }
}

function parseAnthropicEvent(event) {
  const data = event.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (!data || data === '[DONE]') return data === '[DONE]' ? { type: 'message_stop' } : undefined;
  try {
    return JSON.parse(data);
  } catch {
    return { type: 'error', error: { message: `Invalid Anthropic stream frame: ${data.slice(0, 80)}` } };
  }
}

function normalizeFinishReason(reason) {
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop';
  if (reason === 'max_tokens') return 'length';
  return reason ?? 'stop';
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? 0;
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function proofCheck({ id, label, value, target, direction, unit }) {
  return {
    id,
    label,
    value,
    target,
    direction,
    unit,
    pass: direction === 'max' ? value <= target : value >= target
  };
}

function normalizeThreshold(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeProofAggregate(aggregate) {
  const savingsUsd = proofNumber(aggregate.savingsUsd);
  const estimatedCostUsd = proofNumber(aggregate.estimatedCostUsd);
  const actualCostUsd = proofNumber(aggregate.actualCostUsd);
  const costBasis = actualCostUsd > 0 ? actualCostUsd : estimatedCostUsd;
  const derivedSavingsPct = savingsUsd + costBasis > 0 ? savingsUsd / (savingsUsd + costBasis) : 0;
  return {
    ...aggregate,
    count: proofNumber(aggregate.count),
    p95RouterMs: proofNumber(aggregate.p95RouterMs),
    p95RouterOverheadPct: proofNumber(aggregate.p95RouterOverheadPct),
    savingsUsd,
    savingsPct: Number.isFinite(Number(aggregate.savingsPct)) ? Number(aggregate.savingsPct) : derivedSavingsPct,
    estimatedCostUsd,
    actualCostUsd,
    averageSpeedup: proofNumber(aggregate.averageSpeedup),
    accuracy: Number.isFinite(Number(aggregate.accuracy)) ? Number(aggregate.accuracy) : undefined,
    classifierCircuitOpen: proofNumber(aggregate.classifierCircuitOpen)
  };
}

function proofNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function routerOverheadPercent(routerDecisionMs, estimatedLatencyMs) {
  const latency = Number(estimatedLatencyMs);
  return Number.isFinite(latency) && latency > 0 ? routerDecisionMs / latency * 100 : 0;
}

function policyDescription(policy) {
  const normalized = policy === 'auto' ? 'balanced' : policy;
  const descriptions = {
    balanced: 'Route to the best blend of quality, latency, and cost.',
    save: 'Increase cost pressure so cheaper fast-enough models win more often.',
    fast: 'Increase latency pressure so low-latency models win more often.',
    quality: 'Increase quality pressure so stronger models win when the task deserves them.',
    local: 'Prefer executable local models whenever they are a safe fit.'
  };
  return descriptions[normalized] ?? descriptions.balanced;
}

function bestModelIntent(model) {
  const best = bestEntry(defaultIntents().map((intent) => [intent, model.quality?.[intent] ?? model.quality?.chat ?? 0]), ([, value]) => value);
  return best?.[0] ?? 'chat';
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function defaultIntents() {
  return ['code', 'reasoning', 'writing', 'extraction', 'long_context', 'chat'];
}

function bestEntry(entries, score) {
  return entries.reduce((best, entry) => {
    if (!best || score(entry) > score(best)) return entry;
    return best;
  }, undefined);
}

function pickModel(models, score, direction) {
  return models.reduce((best, model) => {
    if (!best) return model;
    if (direction === 'max') return score(model) > score(best) ? model : best;
    return score(model) < score(best) ? model : best;
  }, undefined);
}

function microYield() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function launchDemoSamples() {
  return [
    {
      id: 'code-rescue',
      intent: 'code',
      prompt: 'Refactor this TypeScript webhook, explain the stacktrace, and add a focused regression test.'
    },
    {
      id: 'json-harvest',
      intent: 'extraction',
      prompt: 'Extract customer ids, invoice totals, and renewal dates into strict JSON with a stable schema.'
    },
    {
      id: 'launch-copy',
      intent: 'writing',
      prompt: 'Rewrite this README introduction so the launch feels credible, sharp, and easy to share.'
    },
    {
      id: 'deep-audit',
      intent: 'long_context',
      prompt: 'Audit this repository migration plan, compare every cross-file risk, and summarize the action items.'
    },
    {
      id: 'tradeoff-map',
      intent: 'reasoning',
      prompt: 'Compare these routing algorithms and explain the cost, latency, and quality tradeoffs.'
    }
  ];
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

function route(controller, input) {
  return typeof controller.routeAsync === 'function' ? controller.routeAsync(input) : controller.route(input);
}

function routeMany(controller, inputs) {
  if (typeof controller.routeBatchAsync === 'function') return controller.routeBatchAsync(inputs);
  return Promise.all(inputs.map((input) => route(controller, input)));
}
