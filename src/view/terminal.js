const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';

export function renderHelp() {
  return [
    `${BOLD}proofroute${RESET} ${DIM}CLI-first model routing for people who would rather ship than stare at model menus.${RESET}`,
    '',
    `${BOLD}Usage${RESET}`,
    '  proofroute route --prompt "fix this flaky test"',
    '  proofroute route --tokens 8000 --output-tokens 1200 --prompt "audit this plan"',
    '  proofroute route --max-cost-usd 0.001 --prompt "keep this cheap"',
    '  proofroute route --max-latency-ms 1500 --prompt "keep this fast"',
    '  proofroute route --trace --prompt "why this model?"',
    '  proofroute route --policy save --prompt "summarize these logs"',
    '  proofroute demo',
    '  proofroute share',
    '  proofroute share --markdown',
    '  proofroute share --ledger --markdown',
    '  proofroute prove --max-p95-ms 5 --min-accuracy 0.8',
    '  proofroute prove --ledger --min-requests 20 --max-p95-ms 5',
    '  proofroute connect --port 8787',
    '  proofroute connect --shell sh',
    '  proofroute models',
    '  proofroute smoke',
    '  proofroute smoke --proxy',
    '  proofroute bench --prompt "refactor this webhook" --runs 9',
    '  proofroute calibrate --file examples/samples.json',
    '  proofroute plan --prompt "ship this feature and review the risk"',
    '  proofroute fanout --prompt "ship this feature and review the risk"',
    '  proofroute stats',
    '  proofroute classifier',
    '  proofroute doctor',
    '  proofroute tune',
    '  proofroute proxy --port 8787 --config router.json',
    '  proofroute init > router.json',
    '  proofroute init --preset local-openai > router.json',
    '',
    `${BOLD}Commands${RESET}`,
    '  route   Classify one prompt and print the selected model with cost, speed, and trace evidence.',
    '  demo    Render a zero-network proof card with savings, speedup, p95 latency, and route mix.',
    '  share   Render a copy-ready zero-network routing receipt for launch screenshots or Markdown posts.',
    '  prove   Fail CI when launch proof or ledger proof misses latency, savings, speed, volume, or accuracy gates.',
    '  connect Print the drop-in OpenAI-compatible base URL, env exports, and proxy smoke commands.',
    '  models  Render the configured catalog as a terminal map of executability, economics, context, and intent leaders.',
    '  smoke   Run a local fake-provider execution loop through the Agent runtime or the transparent proxy.',
    '  bench   Run a zero-network local benchmark that makes routing value visible immediately.',
    '  calibrate Run a local prompt suite and show intent accuracy, savings, and p95 routing latency.',
    '  plan    Split one complex request into an asynchronous multi-agent routing plan.',
    '  fanout  Execute the asynchronous multi-agent plan through configured providers.',
    '  stats   Render local privacy-preserving routing telemetry as terminal proof.',
    '  classifier Render classifier sidecar lane, device, error, and latency proof.',
    '  doctor  Check local runtime, providers, telemetry, classifier, and policy readiness.',
    '  tune    Recommend a routing policy patch from the local telemetry ledger.',
    '  proxy   Start an OpenAI-compatible transparent proxy for chat, completions, and responses.',
    '  init    Print the default or local OpenAI-compatible model catalog as editable JSON.'
  ].join('\n');
}

export function renderRouteTrace(decision) {
  const rows = decision.ranked.slice(0, 6).map((candidate, index) => {
    const marker = index === 0 ? `${GREEN}winner ${RESET}` : `${DIM}ranked ${RESET}`;
    const components = candidate.components ?? {};
    return `${marker}${pad(candidate.model, 20)} ${pct(candidate.probability)} ${signed(candidate.logit)} ${signed(components.quality)} ${signed(components.cost)} ${signed(components.latency)} ${signed(components.context)} ${signed(components.local)} ${signed(components.requested)}`;
  });
  const rejected = (decision.rejected ?? []).slice(0, 6).map((candidate) => {
    const detail = candidate.reason === 'cost_budget' ? `cost ${money(candidate.estimatedCostUsd)} over ${money(candidate.maxCostUsd)}` : candidate.reason === 'latency_budget' ? `latency ${ms(candidate.estimatedLatencyMs)} over ${ms(candidate.maxLatencyMs)}` : `needs ${candidate.requiredTokens}/${candidate.contextWindow} tokens`;
    return `${DIM}${pad(candidate.model, 20)} ${pad(candidate.reason, 15)} ${detail}, executable ${candidate.executable ? 'yes' : 'no'}${RESET}`;
  });
  const chosen = decision.ranked[0];
  const components = chosen.components ?? {};
  const output = [
    title('routing trace'),
    `${BOLD}${decision.model.id}${RESET} wins for ${CYAN}${decision.intent.name}${RESET} because quality ${signed(components.quality)}, context ${signed(components.context)}, local ${signed(components.local)}, requested ${signed(components.requested)}, cost ${signed(components.cost)}, and latency ${signed(components.latency)} settle at ${pct(decision.confidence)} probability.`,
    `${DIM}${decision.inputTokens} input tokens, ${decision.outputTokens} planned output tokens, ${money(decision.economics.savingsUsd)} estimated savings, ${decision.performance.speedup.toFixed(2)}x speedup, cache ${decision.cache?.hit ? 'hit' : 'miss'}.${RESET}`,
    '',
    `${pad('model', 27)} probability logit   quality cost    latency context local requested`,
    ...rows,
    ''
  ];
  if (rejected.length > 0) {
    output.push(`${pad('filtered model', 20)} reason          context fit`);
    output.push(...rejected);
    output.push('');
  }
  output.push(
    `${DIM}Positive terms push a model up; negative terms push it down before stable Softmax turns scores into probabilities.${RESET}`
  );
  return output.join('\n');
}

export function renderLaunchDemo(report) {
  const summary = report.aggregate;
  const accuracy = typeof summary.accuracy === 'number' ? pct(summary.accuracy) : 'unlabeled';
  const rows = report.routes.map((row) => {
    return `${pad(row.actualIntent, 13)} ${pad(row.model, 20)} ${pct(row.confidence)} ${money(row.savingsUsd)} ${row.speedup.toFixed(2)}x ${ms(row.latencyMs)}`;
  });
  const costRatio = Math.min(1, Math.max(0, summary.savingsPct));
  const speedRatio = Math.min(1, Math.max(0, summary.averageSpeedup / 4));
  const accuracyRatio = typeof summary.accuracy === 'number' ? summary.accuracy : 0;
  const hitCount = typeof summary.accuracy === 'number' ? Math.round(summary.accuracy * summary.labeled) : 0;
  const costWidth = Math.min(40, Math.max(3, Math.round(costRatio * 40)));
  const speedWidth = Math.min(40, Math.max(3, Math.round(speedRatio * 40)));
  return [
    title('route proof'),
    `${BOLD}${summary.count} prompts${RESET} routed before any provider call, with p95 decision ${YELLOW}${ms(summary.p95RouterMs)}${RESET} and total runtime ${CYAN}${ms(report.elapsedMs)}${RESET}.`,
    `${GREEN}${money(summary.savingsUsd)} saved${RESET} against the priciest viable routes, with ${MAGENTA}${summary.averageSpeedup.toFixed(2)}x${RESET} average estimated speedup and ${CYAN}${accuracy}${RESET} labeled intent accuracy.`,
    '',
    `${pad('money delta', 16)} ${GREEN}${'█'.repeat(costWidth)}${DIM}${'░'.repeat(40 - costWidth)}${RESET} ${pct(costRatio)}`,
    `${pad('speed lift', 16)} ${MAGENTA}${'█'.repeat(speedWidth)}${DIM}${'░'.repeat(40 - speedWidth)}${RESET} ${summary.averageSpeedup.toFixed(2)}x`,
    `${pad('intent hits', 16)} ${bar(accuracyRatio, 40)} ${hitCount}/${summary.labeled}`,
    '',
    `${pad('intent', 13)} ${pad('model', 20)} confidence savings    speed router`,
    ...rows,
    '',
    `intent mix ${compactCounts(summary.intents)}   model mix ${compactCounts(summary.models)}`
  ].join('\n');
}

export function renderShare(report) {
  const summary = report.aggregate;
  const accuracy = shareAccuracy(summary);
  const localRatio = summary.count ? summary.localRoutes / summary.count : 0;
  const cloudRatio = summary.count ? summary.cloudRoutes / summary.count : 0;
  const moneyWidth = Math.min(40, Math.max(3, Math.round(summary.savingsPct * 40)));
  const speedWidth = Math.min(40, Math.max(3, Math.round(Math.min(summary.averageSpeedup, 4) / 4 * 40)));
  const ledger = report.source === 'ledger';
  const copy = shareCopyLine(summary, report.source);
  return [
    title('shareable proof'),
    `${BOLD}${ledger ? 'LOCAL TELEMETRY ROUTING RECEIPT' : 'ZERO-NETWORK ROUTING RECEIPT'}${RESET} ${DIM}for a model menu that finally disappears.${RESET}`,
    `${GREEN}${money(summary.savingsUsd)} saved${RESET}, ${MAGENTA}${summary.averageSpeedup.toFixed(2)}x${RESET} estimated speedup, ${YELLOW}${ms(summary.p95RouterMs)}${RESET} p95 decision, ${CYAN}${accuracy}${RESET}.`,
    '',
    `${pad('local routes', 16)} ${bar(localRatio, 40)} ${summary.localRoutes}/${summary.count}`,
    `${pad('cloud routes', 16)} ${bar(cloudRatio, 40)} ${summary.cloudRoutes}/${summary.count}`,
    `${pad('money saved', 16)} ${GREEN}${'█'.repeat(moneyWidth)}${DIM}${'░'.repeat(40 - moneyWidth)}${RESET} ${pct(summary.savingsPct)}`,
    `${pad('speed lift', 16)} ${MAGENTA}${'█'.repeat(speedWidth)}${DIM}${'░'.repeat(40 - speedWidth)}${RESET} ${summary.averageSpeedup.toFixed(2)}x`,
    '',
    `${BOLD}copy line${RESET}`,
    copy
  ].join('\n');
}

export function renderShareMarkdown(report) {
  const summary = report.aggregate;
  const accuracy = shareAccuracy(summary);
  const source = report.source === 'ledger' ? 'from the local telemetry ledger' : 'before any provider call';
  return [
    `proofroute routed ${summary.count} prompts ${source}, with ${ms(summary.p95RouterMs)} p95 decision time, ${money(summary.savingsUsd)} estimated savings, ${summary.averageSpeedup.toFixed(2)}x estimated speedup, and ${accuracy}.`,
    '',
    `The proof split ${summary.localRoutes}/${summary.count} routes to local models and ${summary.cloudRoutes}/${summary.count} routes to cloud models, which makes the model menu disappear without hiding the economics. Intent mix was ${compactCounts(summary.intents)}, and model mix was ${compactCounts(summary.models)}.`,
    '',
    `Copy line: ${shareCopyLine(summary, report.source)}`
  ].join('\n');
}

export function renderProofGate(report) {
  const passed = report.status === 'pass';
  const mark = passed ? 'PASS' : 'FAIL';
  const markColor = passed ? GREEN : MAGENTA;
  const source = report.source === 'ledger' ? `local telemetry proof${report.path ? ` from ${report.path}` : ''}` : 'zero-network launch proof for CI, screenshots, and first-run trust';
  const accuracy = typeof report.aggregate.accuracy === 'number' ? report.aggregate.accuracy : undefined;
  const savingsPct = Number.isFinite(report.aggregate.savingsPct) ? report.aggregate.savingsPct : 0;
  const metricRows = [
    `${pad('money saved', 16)} ${bar(Math.min(1, savingsPct), 40)} ${pct(savingsPct)}`,
    `${pad('speed lift', 16)} ${bar(Math.min(1, report.aggregate.averageSpeedup / 4), 40)} ${report.aggregate.averageSpeedup.toFixed(2)}x`
  ];
  if (accuracy !== undefined) metricRows.push(`${pad('intent hits', 16)} ${bar(accuracy, 40)} ${pct(accuracy)}`);
  const rows = report.checks.map((check) => {
    const status = check.pass ? `${GREEN}pass${RESET}` : `${MAGENTA}fail${RESET}`;
    const comparator = check.direction === 'max' ? '<=' : '>=';
    return `${status} ${pad(check.label, 16)} ${pad(proofValue(check.value, check.unit), 12)} ${comparator} ${proofValue(check.target, check.unit)}`;
  });
  return [
    title('proof gate'),
    `${BOLD}${markColor}${mark}${RESET} ${DIM}${source}.${RESET}`,
    `${GREEN}${money(report.aggregate.savingsUsd)} saved${RESET}, ${MAGENTA}${report.aggregate.averageSpeedup.toFixed(2)}x${RESET} speedup, ${YELLOW}${ms(report.aggregate.p95RouterMs)}${RESET} p95 decision, ${CYAN}${report.aggregate.count} requests${RESET}${accuracy === undefined ? '.' : `, ${CYAN}${pct(accuracy)}${RESET} intent accuracy.`}`,
    '',
    ...metricRows,
    '',
    `${pad('check', 21)} observed     gate`,
    ...rows
  ].join('\n');
}

export function renderConnect(report) {
  return [
    title('drop-in proxy'),
    `${BOLD}${report.baseUrl}${RESET} is the OpenAI-compatible base URL for SDKs, coding agents, editor extensions, and CLI tools.`,
    `${DIM}Start the proxy once, export these variables in the tool session, and existing clients can keep using their OpenAI-shaped calls while proofroute chooses the model.${RESET}`,
    '',
    `${pad('start proxy', 16)} ${report.commands.startProxy}`,
    `${pad('OPENAI_BASE_URL', 16)} ${GREEN}${report.env.OPENAI_BASE_URL}${RESET}`,
    `${pad('OPENAI_API_KEY', 16)} ${report.env.OPENAI_API_KEY}`,
    `${pad('OPENAI_API_BASE', 16)} ${report.env.OPENAI_API_BASE}`,
    '',
    `${pad('ready check', 16)} ${report.commands.ready}`,
    `${pad('models check', 16)} ${report.commands.models}`,
    `${pad('browser proof', 16)} ${report.commands.browserProof}`,
    `${pad('proof gate', 16)} ${report.commands.proof}`
  ].join('\n');
}

export function renderConnectShell(report, shell = 'sh') {
  const entries = Object.entries(report.env);
  if (shell === 'fish') {
    return entries.map(([key, value]) => `set -gx ${key} ${shellQuote(value)}`).join('\n');
  }
  if (shell === 'powershell' || shell === 'pwsh') {
    return entries.map(([key, value]) => `$env:${key} = ${powerShellQuote(value)}`).join('\n');
  }
  return entries.map(([key, value]) => `export ${key}=${shellQuote(value)}`).join('\n');
}

export function renderModelCatalog(report) {
  const rows = report.models.map((model) => {
    const state = model.executable ? `${GREEN}ready${RESET}` : `${YELLOW}needs key${RESET}`;
    const place = model.local ? 'local' : 'cloud';
    return `${pad(state, 18)} ${pad(model.id, 20)} ${pad(model.provider, 10)} ${pad(place, 6)} ${pad(compactTokens(model.contextWindow), 8)} ${pad(moneyPair(model), 14)} ${pad(ms(model.medianLatencyMs), 10)} ${pad(model.bestIntent, 13)} ${pct(model.bestQuality)}`;
  });
  const leaders = report.intentLeaders.map((leader) => {
    const executable = leader.executable ? 'ready' : 'needs key';
    return `${leader.intent}:${leader.model} ${pct(leader.quality)} ${executable}`;
  }).join('   ');
  const cheapest = report.leaders.cheapestExecutable;
  const fastest = report.leaders.fastestExecutable;
  const largest = report.leaders.largestContext;
  return [
    title('model map'),
    `${BOLD}${report.summary.count} models${RESET} mapped with ${GREEN}${report.summary.executable}${RESET} executable, ${CYAN}${report.summary.local}${RESET} local, ${MAGENTA}${report.summary.cloud}${RESET} cloud, and ${YELLOW}${report.summary.free}${RESET} zero-price local routes.`,
    `${DIM}Cheapest ready route ${cheapest?.id ?? 'none'}, fastest ready route ${fastest?.id ?? 'none'}, largest context ${largest?.id ?? 'none'} at ${largest ? compactTokens(largest.contextWindow) : 'n/a'}.${RESET}`,
    '',
    `${pad('state', 18)} ${pad('model', 20)} ${pad('provider', 10)} ${pad('place', 6)} ${pad('context', 8)} ${pad('$/1m in/out', 14)} ${pad('latency', 10)} ${pad('best intent', 13)} quality`,
    ...rows,
    '',
    `intent leaders ${leaders}`
  ].join('\n');
}

export function renderSmoke(report) {
  const passed = report.status === 'pass';
  const mark = passed ? 'PASS' : 'FAIL';
  const markColor = passed ? GREEN : MAGENTA;
  const request = report.upstream.requests[0] ?? {};
  const mode = report.mode === 'proxy' ? 'transparent /v1/chat/completions proxy loop' : 'local Agent runtime loop';
  const rows = [
    `${pad('router', 16)} ${ms(report.routerDecisionMs)}`,
    `${pad('execution', 16)} ${ms(report.executionMs)}`,
    `${pad('savings', 16)} ${money(report.decision.economics.savingsUsd)}`,
    `${pad('speedup', 16)} ${report.decision.performance.speedup.toFixed(2)}x`,
    `${pad('upstream', 16)} ${report.upstream.url}`,
    `${pad('auth header', 16)} ${request.authorization ? 'present' : 'missing'}`,
    `${pad('response', 16)} ${report.response.content}`
  ];
  if (report.proxy) rows.splice(5, 0, `${pad('proxy', 16)} ${report.proxy.origin}`);
  if (report.cors?.exposeHeaders) rows.splice(6, 0, `${pad('browser proof', 16)} ${report.cors.exposeHeaders.includes('x-proofroute-model') ? 'readable' : 'hidden'}`);
  if (report.response.headers?.cache) rows.splice(6, 0, `${pad('proxy cache', 16)} ${report.response.headers.cache}`);
  if (report.response.headers?.actualTokens) rows.splice(7, 0, `${pad('actual tokens', 16)} ${report.response.headers.actualTokens}`);
  const proofSurface = report.cors?.exposeHeaders ? 'authorization, browser-readable proof headers, and response parsing' : 'authorization, headers, and response parsing';
  return [
    title('proxy smoke'),
    `${BOLD}${markColor}${mark}${RESET} ${DIM}${mode} proved routing, OpenAI-compatible forwarding, ${proofSurface} without external network.${RESET}`,
    `${BOLD}${report.decision.model.id}${RESET} won for ${CYAN}${report.decision.intent.name}${RESET}, hit upstream model ${CYAN}${request.model ?? 'none'}${RESET}, and returned ${YELLOW}${report.response.status}${RESET}.`,
    '',
    ...rows
  ].join('\n');
}

export function renderDecision(decision) {
  const rows = decision.ranked.slice(0, 5).map((candidate, index) => {
    const marker = index === 0 ? `${GREEN}selected${RESET}` : `${DIM}option${RESET}`;
    return `${marker} ${pad(candidate.model, 20)} ${bar(candidate.probability, 24)} ${pct(candidate.probability)} ${money(candidate.estimatedCostUsd)} ${ms(candidate.estimatedLatencyMs)}`;
  });
  return [
    title('route decision'),
    `${BOLD}${decision.model.id}${RESET} via ${decision.model.provider} for ${CYAN}${decision.intent.name}${RESET} at ${pct(decision.confidence)} confidence`,
    `${DIM}${decision.inputTokens} input tokens, ${decision.outputTokens} planned output tokens, fallback ${decision.fallback.model}, cache ${decision.cache?.hit ? 'hit' : 'miss'}${RESET}`,
    '',
    `${pad('model', 28)} probability                 cost       latency`,
    ...rows,
    '',
    `${GREEN}${money(decision.economics.savingsUsd)} saved${RESET} against the priciest viable model, with ${YELLOW}${decision.performance.speedup.toFixed(2)}x${RESET} estimated speedup.`
  ].join('\n');
}

export function renderCalibration(report) {
  const accuracy = typeof report.aggregate.accuracy === 'number' ? pct(report.aggregate.accuracy) : 'unlabeled';
  const rows = report.samples.map((sample) => {
    const mark = sample.matched === undefined ? DIM + 'seen' + RESET : sample.matched ? GREEN + 'hit ' + RESET : YELLOW + 'miss' + RESET;
    return `${mark} ${pad(sample.id, 14)} ${pad(sample.actualIntent, 13)} ${pad(sample.model, 20)} ${pct(sample.confidence)} ${money(sample.savingsUsd)} ${ms(sample.latencyMs)}`;
  });
  return [
    title('calibration proof'),
    `${BOLD}${report.aggregate.count} prompts${RESET} routed in ${CYAN}${ms(report.elapsedMs)}${RESET}, with ${accuracy} labeled intent accuracy and p95 ${YELLOW}${ms(report.aggregate.p95RouterMs)}${RESET}.`,
    `${GREEN}${money(report.aggregate.savingsUsd)} saved${RESET} across the suite, with ${MAGENTA}${report.aggregate.averageSpeedup.toFixed(2)}x${RESET} average estimated speedup.`,
    '',
    `${pad('status', 5)} ${pad('sample', 14)} ${pad('intent', 13)} ${pad('model', 20)} confidence savings    router`,
    ...rows,
    '',
    `intent mix ${compactCounts(report.aggregate.intents)}   model mix ${compactCounts(report.aggregate.models)}`
  ].join('\n');
}

export function renderDashboard(report) {
  const decision = report.decision;
  const savingsWidth = Math.min(40, Math.max(3, Math.round(decision.economics.savingsPct * 40)));
  const speedWidth = Math.min(40, Math.max(3, Math.round(Math.min(4, decision.performance.speedup) / 4 * 40)));
  return [
    title('instant proof'),
    `${BOLD}${decision.model.id}${RESET} wins for ${CYAN}${decision.intent.name}${RESET}, chosen in p95 ${ms(report.controller.p95Ms)} before any network call.`,
    '',
    `${pad('money saved', 16)} ${GREEN}${'█'.repeat(savingsWidth)}${DIM}${'░'.repeat(40 - savingsWidth)}${RESET} ${money(report.aggregate.savedUsd)} across ${report.runs} runs`,
    `${pad('speed lift', 16)} ${MAGENTA}${'█'.repeat(speedWidth)}${DIM}${'░'.repeat(40 - speedWidth)}${RESET} ${report.aggregate.averageSpeedup.toFixed(2)}x average`,
    `${pad('router p50', 16)} ${bar(normalizeLatency(report.controller.p50Ms), 40)} ${ms(report.controller.p50Ms)}`,
    `${pad('router p95', 16)} ${bar(normalizeLatency(report.controller.p95Ms), 40)} ${ms(report.controller.p95Ms)}`,
    '',
    renderDecision(decision)
  ].join('\n');
}

export function renderAgentPlan(plan) {
  const rows = plan.assignments.map((assignment) => {
    return `${pad(assignment.id, 15)} ${pad(assignment.model, 20)} ${pad(assignment.intent, 13)} ${pct(assignment.confidence)} ${money(assignment.estimatedCostUsd)} ${ms(assignment.estimatedLatencyMs)}`;
  });
  return [
    title('agent fanout'),
    `${BOLD}${plan.assignments.length} agents${RESET} routed in ${CYAN}${ms(plan.elapsedMs)}${RESET}, with an estimated parallel critical path of ${YELLOW}${ms(plan.aggregate.criticalPathMs)}${RESET}.`,
    `${GREEN}${money(plan.aggregate.savingsUsd)} saved${RESET} across the fanout plan before any provider call is made.`,
    '',
    `${pad('agent', 15)} ${pad('model', 20)} ${pad('intent', 13)} confidence cost       latency`,
    ...rows
  ].join('\n');
}

export function renderAgentExecution(report) {
  const mark = report.status === 'pass' ? `${GREEN}PASS${RESET}` : report.status === 'warn' ? `${YELLOW}WARN${RESET}` : `${MAGENTA}FAIL${RESET}`;
  const rows = report.assignments.map((assignment) => {
    const status = assignment.status >= 200 && assignment.status < 300 ? `${GREEN}${assignment.status}${RESET}` : `${MAGENTA}${assignment.status}${RESET}`;
    const preview = compactText(assignment.outputText || assignment.error || 'no response', 46);
    return `${pad(assignment.id, 15)} ${pad(assignment.model, 20)} ${status} ${pad(ms(assignment.executionMs), 10)} ${pad(String(assignment.actualTokens), 6)} ${preview}`;
  });
  return [
    title('agent execution'),
    `${BOLD}${mark}${RESET} ${report.aggregate.ok}/${report.aggregate.count} agents completed in ${CYAN}${ms(report.elapsedMs)}${RESET}, with parallel critical path ${YELLOW}${ms(report.aggregate.criticalPathMs)}${RESET}.`,
    `${GREEN}${money(report.aggregate.savingsUsd)} saved${RESET} across routed roles, ${MAGENTA}${money(report.aggregate.estimatedCostUsd)}${RESET} estimated cost, and ${CYAN}${report.aggregate.actualTokens}${RESET} actual tokens reported.`,
    '',
    `${pad('agent', 15)} ${pad('model', 20)} status exec       tokens output`,
    ...rows
  ].join('\n');
}

export function renderStats(report) {
  const summary = report.summary;
  const localRatio = summary.count ? summary.local / summary.count : 0;
  const streamRatio = summary.count ? summary.streaming / summary.count : 0;
  const cacheRatio = summary.count ? summary.cacheHits / summary.count : 0;
  const fallbackRatio = summary.count ? summary.fallbacks / summary.count : 0;
  const costRows = summary.meteredRequests > 0 ? [
    `${pad('actual cost', 16)} ${money(summary.actualCostUsd)} from ${summary.meteredRequests}/${summary.count} metered responses`,
    `${pad('actual tokens', 16)} ${summary.actualTotalTokens} total, ${summary.actualInputTokens} in, ${summary.actualOutputTokens} out`,
    `${pad('est cost', 16)} ${money(summary.estimatedCostUsd)}`
  ] : [
    `${pad('cost routed', 16)} ${money(summary.estimatedCostUsd)}`
  ];
  return [
    title('routing ledger'),
    `${BOLD}${summary.count} requests${RESET} recorded at ${DIM}${report.path}${RESET}.`,
    `${GREEN}${money(summary.savingsUsd)} saved${RESET} with ${MAGENTA}${summary.averageSpeedup.toFixed(2)}x${RESET} average estimated speedup and p95 decision ${YELLOW}${ms(summary.p95RouterMs)}${RESET}.`,
    '',
    `${pad('local mix', 16)} ${bar(localRatio, 40)} ${summary.local}/${summary.count}`,
    `${pad('streaming', 16)} ${bar(streamRatio, 40)} ${summary.streaming}/${summary.count}`,
    `${pad('cache hits', 16)} ${bar(cacheRatio, 40)} ${summary.cacheHits}/${summary.count}`,
    `${pad('fallbacks', 16)} ${bar(fallbackRatio, 40)} ${summary.fallbacks}/${summary.count}`,
    ...costRows,
    `${pad('p95 end to end', 16)} ${ms(summary.p95EndToEndMs)}`,
    `${pad('p95 upstream', 16)} ${ms(summary.p95EstimatedLatencyMs)}`,
    '',
    `intent mix ${compactCounts(summary.intents) || 'none'}`,
    `model mix ${compactCounts(summary.models) || 'none'}`,
    `provider mix ${compactCounts(summary.providers) || 'none'}`,
    `status mix ${compactCounts(summary.statuses) || 'none'}`
  ].join('\n');
}

export function renderDoctor(report) {
  const rows = report.checks.map((check) => {
    const mark = check.status === 'pass' ? GREEN + 'pass' + RESET : check.status === 'warn' ? YELLOW + 'warn' + RESET : MAGENTA + 'fail' + RESET;
    return `${mark} ${pad(check.id, 12)} ${pad(check.label, 30)} ${DIM}${check.detail}${RESET}`;
  });
  const upstream = report.summary.providerHealth ? `, ${report.summary.providerHealth.healthy}/${report.summary.providerHealth.total} upstream healthy` : '';
  return [
    title('doctor'),
    `${BOLD}${report.status.toUpperCase()}${RESET} with ${report.summary.executableModels}/${report.summary.models} executable models${upstream}, ${report.summary.classifier} classifier, and telemetry at ${DIM}${report.summary.telemetry}${RESET}.`,
    '',
    ...rows
  ].join('\n');
}

export function renderClassifierMetrics(report) {
  if (report.status !== 'pass') {
    const mark = report.status === 'fail' ? `${MAGENTA}FAIL${RESET}` : `${YELLOW}WARN${RESET}`;
    return [
      title('classifier accelerator'),
      `${mark} ${DIM}${report.message}${RESET}`
    ].join('\n');
  }
  const metrics = report.metrics;
  const maxRequests = Math.max(1, ...metrics.laneMetrics.map((lane) => lane.requests));
  const rows = metrics.laneMetrics.map((lane) => {
    const device = lane.device === undefined ? 'none' : lane.device;
    const errorText = lane.errors > 0 ? `${MAGENTA}${lane.errors}${RESET}` : `${GREEN}${lane.errors}${RESET}`;
    return `${pad(`lane ${lane.lane}`, 8)} ${pad(`gpu ${device}`, 8)} ${bar(lane.requests / maxRequests, 26)} ${pad(`${lane.requests} req`, 8)} ${pad(`${errorText} err`, 15)} avg ${ms(lane.averageDecisionMs)} max ${ms(lane.maxDecisionMs)} peak ${lane.peakInflight}`;
  });
  return [
    title('classifier accelerator'),
    `${BOLD}${metrics.backend}${RESET} sidecar at ${DIM}${report.url}${RESET} answered in ${YELLOW}${ms(report.elapsedMs)}${RESET}.`,
    `${GREEN}${metrics.requests} classifications${RESET}, ${metrics.errors > 0 ? MAGENTA : GREEN}${metrics.errors} errors${RESET}, ${CYAN}${metrics.lanes} lanes${RESET}, devices ${metrics.devices.length ? metrics.devices.join(',') : 'none'}, inflight ${metrics.inflight}, uptime ${ms(metrics.uptimeMs)}.`,
    '',
    ...rows
  ].join('\n');
}

export function renderTune(report) {
  const summary = report.summary;
  const changed = report.currentPolicy !== report.recommendedPolicy;
  const patch = JSON.stringify(report.routerPatch);
  return [
    title('tuning signal'),
    `${BOLD}${summary.count} events${RESET} from ${DIM}${report.path}${RESET} produce ${pct(report.confidence)} recommendation confidence.`,
    `${changed ? YELLOW : GREEN}${report.currentPolicy} -> ${report.recommendedPolicy}${RESET} with ${GREEN}${money(summary.savingsUsd)} saved${RESET}, ${MAGENTA}${summary.averageSpeedup.toFixed(2)}x${RESET} speedup, and p95 decision ${YELLOW}${ms(summary.p95RouterMs)}${RESET}.`,
    '',
    `${pad('router patch', 16)} ${patch}`,
    report.exported ? `${pad('exported', 16)} ${report.exported}` : `${pad('exported', 16)} not written`,
    '',
    ...report.reasons.map((reason) => `${DIM}${reason}${RESET}`)
  ].join('\n');
}

export function renderJson(value) {
  return JSON.stringify(value, null, 2);
}

function title(text) {
  return `${BOLD}${CYAN}${text.toUpperCase()}${RESET}`;
}

function bar(value, width) {
  const filled = Math.min(width, Math.max(0, Math.round(value * width)));
  return `${CYAN}${'█'.repeat(filled)}${DIM}${'░'.repeat(width - filled)}${RESET}`;
}

function normalizeLatency(value) {
  return Math.max(0.03, 1 - Math.min(1, value / 4));
}

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value) {
  if (value === 0) return '$0.000000';
  return `$${value.toFixed(6)}`;
}

function moneyPair(model) {
  return `$${model.inputUsdPer1M.toFixed(2)}/$${model.outputUsdPer1M.toFixed(2)}`;
}

function ms(value) {
  return `${value.toFixed(2)}ms`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function powerShellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function proofValue(value, unit) {
  if (unit === 'ms') return ms(value);
  if (unit === 'usd') return money(value);
  if (unit === 'x') return `${value.toFixed(2)}x`;
  if (unit === 'ratio') return pct(value);
  if (unit === 'count') return String(value);
  return String(value);
}

function shareCopyLine(summary, source) {
  const suffix = source === 'ledger' ? 'from my private local routing ledger' : 'before any provider call';
  return `I routed ${summary.count} prompts with proofroute in ${ms(summary.p95RouterMs)} p95 decision time, saved ${money(summary.savingsUsd)}, and got ${summary.averageSpeedup.toFixed(2)}x estimated speedup ${suffix}.`;
}

function shareAccuracy(summary) {
  return typeof summary.accuracy === 'number' ? `${pct(summary.accuracy)} labeled intent accuracy` : 'unlabeled intent mix';
}

function signed(value = 0) {
  const number = Number.isFinite(value) ? value : 0;
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
}

function compactCounts(counts) {
  return Object.entries(counts).map(([key, value]) => `${key}:${value}`).join(', ');
}

function compactTokens(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function compactText(value, width) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}
