const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';

export function renderHelp() {
  return [
    `${BOLD}llm-router${RESET} ${DIM}CLI-first model routing for people who would rather ship than stare at model menus.${RESET}`,
    '',
    `${BOLD}Usage${RESET}`,
    '  llm-router route --prompt "fix this flaky test"',
    '  llm-router route --policy save --prompt "summarize these logs"',
    '  llm-router bench --prompt "refactor this webhook" --runs 9',
    '  llm-router calibrate --file examples/samples.json',
    '  llm-router plan --prompt "ship this feature and review the risk"',
    '  llm-router proxy --port 8787 --config router.json',
    '  llm-router init > router.json',
    '',
    `${BOLD}Commands${RESET}`,
    '  route   Classify one prompt and print the selected model with cost and speed evidence.',
    '  bench   Run a zero-network local benchmark that makes routing value visible immediately.',
    '  calibrate Run a local prompt suite and show intent accuracy, savings, and p95 routing latency.',
    '  plan    Split one complex request into an asynchronous multi-agent routing plan.',
    '  proxy   Start an OpenAI-compatible transparent proxy at /v1/chat/completions.',
    '  init    Print the default model catalog as editable JSON.'
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
    `${DIM}${decision.inputTokens} input tokens, ${decision.outputTokens} planned output tokens, fallback ${decision.fallback.model}${RESET}`,
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

function ms(value) {
  return `${value.toFixed(2)}ms`;
}

function compactCounts(counts) {
  return Object.entries(counts).map(([key, value]) => `${key}:${value}`).join(', ');
}
