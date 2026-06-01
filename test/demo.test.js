import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRuntime } from '../src/agent/runtime.js';
import { demoCatalog } from '../src/config.js';
import { RouteController } from '../src/controller/route-controller.js';
import { renderHelp, renderLaunchDemo, renderProofGate, renderShare, renderShareMarkdown, renderShareSvg } from '../src/view/terminal.js';

test('launch demo renders a zero-network proof card', async () => {
  const config = demoCatalog();
  const runtime = new AgentRuntime(config);
  const controller = new RouteController(config);
  const report = await runtime.launchDemo({ controller });
  assert.equal(report.aggregate.count, 5);
  assert.ok(report.aggregate.p95RouterMs > 0);
  assert.ok(report.aggregate.savingsUsd >= 0);
  assert.ok(report.aggregate.averageSpeedup > 0);
  assert.ok(report.aggregate.p95RouterOverheadPct >= 0);
  assert.ok(report.aggregate.accuracy >= 0.8);
  assert.equal(report.aggregate.classifierBackends.builtin, 5);
  assert.ok(report.routes.every((row) => row.model && row.actualIntent));
  const output = renderLaunchDemo(report);
  assert.match(output, /ROUTE PROOF/);
  assert.match(output, /money delta/);
  assert.match(output, /route overhead/);
  assert.match(output, /intent mix/);
  assert.match(output, /policy mix/);
  assert.match(output, /classifier mix/);
  const share = renderShare(report);
  assert.match(share, /SHAREABLE PROOF/);
  assert.match(share, /ZERO-NETWORK ROUTING RECEIPT/);
  assert.match(share, /router overhead/);
  assert.match(share, /policy mix/);
  assert.match(share, /classifier mix/);
  assert.match(share, /copy line/);
  const markdown = renderShareMarkdown(report);
  assert.match(markdown, /proofroute routed 5 prompts/);
  assert.match(markdown, /p95 router overhead/);
  assert.match(markdown, /Policy mix was/);
  assert.match(markdown, /Classifier mix was builtin:5/);
  assert.match(markdown, /Copy line:/);
  assert.doesNotMatch(markdown, /\x1b\[/);
  const svg = renderShareSvg(report);
  assert.match(svg, /^<svg/);
  assert.match(svg, /ProofRoute/);
  assert.match(svg, /routing proof/);
  assert.match(svg, /overhead/);
  assert.match(svg, /classifier mix/);
  assert.doesNotMatch(svg, /\x1b\[/);
  const proof = await runtime.prove({
    controller,
    thresholds: {
      maxP95Ms: 100,
      minSavingsUsd: 0,
      minSpeedup: 1,
      minAccuracy: 0.5
    }
  });
  assert.equal(proof.status, 'pass');
  assert.equal(proof.checks.length, 5);
  const failedProof = await runtime.prove({
    controller,
    thresholds: {
      maxP95Ms: 0
    }
  });
  assert.equal(failedProof.status, 'fail');
  const overheadProof = await runtime.prove({
    controller,
    thresholds: {
      maxRouterOverheadPct: 100
    }
  });
  assert.equal(overheadProof.status, 'pass');
  assert.ok(overheadProof.checks.find((check) => check.id === 'router_overhead'));
  const proofOutput = renderProofGate(proof);
  assert.match(proofOutput, /PROOF GATE/);
  assert.match(proofOutput, /PASS/);
  const ledgerProof = await runtime.prove({
    source: 'ledger',
    path: '.proofroute/events.jsonl',
    summary: {
      count: 12,
      p95RouterMs: 0.9,
      savingsUsd: 0.05,
      estimatedCostUsd: 0.01,
      averageSpeedup: 1.8
    },
    thresholds: {
      minRequests: 10,
      maxP95Ms: 2,
      minSavingsUsd: 0.01,
      minSpeedup: 1.5
    }
  });
  assert.equal(ledgerProof.status, 'pass');
  assert.equal(ledgerProof.source, 'ledger');
  assert.equal(ledgerProof.checks.length, 4);
  const ledgerOutput = renderProofGate(ledgerProof);
  assert.match(ledgerOutput, /local telemetry proof/);
  assert.doesNotMatch(ledgerOutput, /intent accuracy/);
  assert.match(renderHelp(), /proofroute share/);
  assert.match(renderHelp(), /proofroute share --markdown/);
  assert.match(renderHelp(), /proofroute share --svg/);
  assert.match(renderHelp(), /proofroute stats --watch/);
  assert.match(renderHelp(), /proofroute prove/);
});
