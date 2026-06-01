import { summarizeRouteEvents } from './telemetry.js';

export function tuneFromEvents(events, config = {}) {
  const summary = summarizeRouteEvents(events);
  const currentPolicy = config.router?.policy ?? 'balanced';
  const localRatio = summary.count ? summary.local / summary.count : 0;
  const streamRatio = summary.count ? summary.streaming / summary.count : 0;
  const savingsPerRequest = summary.count ? summary.savingsUsd / summary.count : 0;
  const cloudRatio = summary.count ? summary.cloud / summary.count : 0;
  const recommendedPolicy = recommendPolicy({ summary, currentPolicy, localRatio, savingsPerRequest, cloudRatio });
  const routerPatch = recommendRouterPatch({ summary, recommendedPolicy, localRatio, streamRatio, savingsPerRequest, config });
  const classifierPatch = recommendClassifierPatch({ summary, config });
  return {
    currentPolicy,
    recommendedPolicy,
    confidence: confidence(summary),
    summary,
    routerPatch,
    classifierPatch,
    reasons: reasons({ summary, currentPolicy, recommendedPolicy, localRatio, streamRatio, savingsPerRequest, cloudRatio })
  };
}

export function exportTunedConfig(config, tune) {
  const classifierPatch = tune.classifierPatch ?? {};
  const classifier = Object.keys(classifierPatch).length > 0 ? {
    ...(config.classifier ?? {}),
    ...classifierPatch
  } : config.classifier;
  return {
    ...config,
    router: {
      ...(config.router ?? {}),
      ...withoutMeta(tune.routerPatch ?? {})
    },
    ...(classifier ? { classifier } : {})
  };
}

function recommendPolicy({ summary, currentPolicy, localRatio, savingsPerRequest, cloudRatio }) {
  if (summary.count === 0) return currentPolicy;
  if (summary.p95RouterMs > 5) return 'fast';
  if (cloudRatio > 0.7 && savingsPerRequest < 0.0002) return 'save';
  if (localRatio > 0.8 && summary.averageSpeedup < 1.15) return 'fast';
  if (summary.averageSpeedup > 1.8 && savingsPerRequest > 0.0005) return 'balanced';
  return currentPolicy;
}

function recommendRouterPatch({ summary, recommendedPolicy, localRatio, streamRatio, savingsPerRequest, config }) {
  const current = config.router ?? {};
  const patch = { policy: recommendedPolicy };
  if (summary.count === 0) return patch;
  if (summary.p95RouterMs > 5) {
    patch.latencyPenaltyMs = Math.max(250, Math.round((current.latencyPenaltyMs ?? 900) * 0.85));
  }
  if (savingsPerRequest < 0.0002 && summary.cloud > summary.local) {
    patch.costPenaltyUsd = Number(((current.costPenaltyUsd ?? 0.00035) * 0.82).toFixed(8));
  }
  if (localRatio < 0.25 && summary.local > 0) {
    patch.localBias = Number(((current.localBias ?? 0.18) * 1.2).toFixed(4));
  }
  if (streamRatio > 0.5) {
    patch.streamingObserved = true;
  }
  return patch;
}

function recommendClassifierPatch({ summary, config }) {
  if (!summary.classifierCircuitOpen) return {};
  const current = config.classifier ?? {};
  return {
    timeoutMs: Math.max(4, Math.round((current.timeoutMs ?? 12) * 0.75)),
    cooldownMs: Math.max(2000, Math.round((current.cooldownMs ?? 1000) * 1.5)),
    failureThreshold: Math.max(1, Math.floor(current.failureThreshold ?? 3))
  };
}

function confidence(summary) {
  if (summary.count >= 100) return 0.92;
  if (summary.count >= 25) return 0.78;
  if (summary.count >= 5) return 0.58;
  if (summary.count > 0) return 0.35;
  return 0.1;
}

function reasons({ summary, currentPolicy, recommendedPolicy, localRatio, streamRatio, savingsPerRequest, cloudRatio }) {
  if (summary.count === 0) {
    return ['No routing events are available yet, so the safest recommendation is to keep the current policy and collect a real ledger.'];
  }
  const output = [
    `${summary.count} local routing events show ${formatMoney(summary.savingsUsd)} estimated savings and ${summary.averageSpeedup.toFixed(2)}x average speedup.`,
    `The workload is ${(localRatio * 100).toFixed(1)}% local, ${(cloudRatio * 100).toFixed(1)}% cloud, and ${(streamRatio * 100).toFixed(1)}% streaming.`
  ];
  if (recommendedPolicy !== currentPolicy) {
    output.push(`The policy should move from ${currentPolicy} to ${recommendedPolicy} because the ledger indicates a stronger optimization target than the current default.`);
  } else {
    output.push(`The current ${currentPolicy} policy is still consistent with the observed routing ledger.`);
  }
  if (savingsPerRequest < 0.0002) output.push('Savings per request are low, so cost pressure can be increased without hiding the decision behind a hard rule.');
  if (summary.p95RouterMs > 5) output.push('Decision latency is above the intended near-zero path, so latency pressure should rise before adding heavier classifier work.');
  if (summary.classifierCircuitOpen > 0) output.push(`${summary.classifierCircuitOpen} routes used the protected classifier fallback circuit, so the accelerator timeout should shrink and the cooldown should lengthen before its throughput claim is trusted.`);
  return output;
}

function formatMoney(value) {
  return `$${value.toFixed(6)}`;
}

function withoutMeta(patch) {
  const output = { ...patch };
  delete output.streamingObserved;
  return output;
}
