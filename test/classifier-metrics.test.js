import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifierBenchmarkReport } from '../src/agent/classifier-proof.js';
import { classifierMetricsReport } from '../src/agent/doctor.js';
import { createClassifierSidecar } from '../src/controller/sidecar-server.js';
import { renderClassifierBenchmark, renderClassifierMetrics, renderClassifierSvg, renderHelp } from '../src/view/terminal.js';

test('classifier metrics command renders sidecar accelerator proof', async () => {
  const sidecar = await startSidecar({
    backend: 'mock-gpu',
    devices: '0,1',
    deviceProfiles: JSON.stringify({
      0: { name: 'RTX 4090', memoryMb: 24576, runtime: 'CUDA 12.4', driver: '550.54', source: 'nvidia-smi' },
      1: { name: 'RTX A6000', memoryMb: 49152, runtime: 'CUDA 12.4', driver: '550.54', source: 'nvidia-smi' }
    }),
    lanes: 2
  });
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-classifier-'));
  try {
    await postJson(`${sidecar.origin}/classify`, { prompt: 'Refactor this webhook and add a regression test.' });
    await postJson(`${sidecar.origin}/classify`, { prompt: 'Extract customer ids into JSON.' });
    const report = await classifierMetricsReport({
      classifier: { url: `${sidecar.origin}/classify`, timeoutMs: 200 }
    });
    assert.equal(report.status, 'pass');
    assert.equal(report.metrics.backend, 'mock-gpu');
    assert.equal(report.metrics.scheduler, 'least-inflight');
    assert.equal(report.metrics.microBatches, 0);
    assert.equal(report.metrics.maxBatchSize, 16);
    assert.equal(report.metrics.warmed, false);
    assert.equal(report.metrics.requests, 2);
    assert.deepEqual(report.metrics.devices, ['0', '1']);
    assert.equal(report.metrics.deviceProfiles[0].name, 'RTX 4090');
    assert.equal(report.metrics.deviceProfiles[1].memoryMb, 49152);
    assert.deepEqual(report.metrics.laneMetrics.map((lane) => lane.requests), [1, 1]);
    const output = renderClassifierMetrics(report);
    assert.match(output, /CLASSIFIER ACCELERATOR/);
    assert.match(output, /mock-gpu/);
    assert.match(output, /least-inflight/);
    assert.match(output, /microbatches/);
    assert.match(output, /device profiles/);
    assert.match(output, /RTX 4090/);
    assert.match(output, /lane 0/);
    assert.match(output, /gpu 0/);
    const metricsSvg = renderClassifierSvg(report);
    assert.match(metricsSvg, /^<svg/);
    assert.match(metricsSvg, /ProofRoute Classifier/);
    assert.match(metricsSvg, /RTX 4090/);
    assert.doesNotMatch(metricsSvg, /\x1b\[/);
    assert.match(renderHelp(), /proofroute classifier/);
    assert.match(renderHelp(), /classifier --warmup --svg/);
    const cli = await runCli(['./bin/proofroute.js', 'classifier'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /CLASSIFIER ACCELERATOR/);
    assert.match(cli.stdout, /2 classifications/);
    assert.match(cli.stdout, /RTX A6000/);
    const svgPath = join(directory, 'classifier.svg');
    const cliSvg = await runCli(['./bin/proofroute.js', 'classifier', '--svg', '--out', svgPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(cliSvg.status, 0, cliSvg.stderr);
    assert.equal(cliSvg.stdout, '');
    const svgText = await readFile(svgPath, 'utf8');
    assert.match(svgText, /^<svg/);
    assert.match(svgText, /prompt-free accelerator receipt/);
    assert.match(svgText, /RTX A6000/);
    const coldProxy = await runCli(['./bin/proofroute.js', 'proxy', '--require-classifier-warmup', '--port', '0'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(coldProxy.status, 1);
    assert.match(coldProxy.stderr, /Classifier sidecar is not ready/);
    const warmed = await runCli(['./bin/proofroute.js', 'classifier', '--warmup'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(warmed.status, 0, warmed.stderr);
    assert.match(warmed.stdout, /warmup pass/);
    assert.match(warmed.stdout, /warmed/);
    const bench = await runCli(['./bin/proofroute.js', 'classifier', '--bench', '--json', '--runs', '1'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(bench.status, 0, bench.stderr);
    const benchReport = JSON.parse(bench.stdout);
    assert.equal(benchReport.status, 'pass');
    assert.equal(benchReport.mode, 'sidecar');
    assert.equal(benchReport.count, 5);
    assert.match(JSON.stringify(benchReport.aggregate.backends), /external-url/);
    assert.match(JSON.stringify(benchReport.aggregate.batchModes), /single/);
    assert.equal(benchReport.aggregate.deviceCount, 2);
    assert.equal(benchReport.aggregate.laneCount, 2);
    assert.equal(benchReport.aggregate.deviceProfileCount, 2);
    assert.equal(benchReport.aggregate.hardwareProbeProfileCount, 2);
    const proofPath = join(directory, 'classifier-proof.json');
    const benchOut = await runCli(['./bin/proofroute.js', 'classifier', '--bench', '--json', '--runs', '1', '--out', proofPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(benchOut.status, 0, benchOut.stderr);
    assert.equal(benchOut.stdout, '');
    const proofArtifact = JSON.parse(await readFile(proofPath, 'utf8'));
    assert.equal(proofArtifact.status, 'pass');
    assert.equal(proofArtifact.count, 5);
    assert.equal(proofArtifact.mode, 'sidecar');
    const evidencePath = join(directory, 'classifier-evidence.json');
    const evidenceOut = await runCli(['./bin/proofroute.js', 'classifier', '--bench', '--warmup', '--json', '--runs', '1', '--min-devices', '2', '--min-lanes', '2', '--require-device-profiles', '--require-hardware-probe', '--evidence', '--out', evidencePath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200',
        PROOFROUTE_ACCELERATOR_MODEL: 'examples/linear-intent-model.json'
      },
      timeout: 1000
    });
    assert.equal(evidenceOut.status, 0, evidenceOut.stderr);
    assert.equal(evidenceOut.stdout, '');
    const evidenceArtifact = JSON.parse(await readFile(evidencePath, 'utf8'));
    assert.equal(evidenceArtifact.evidence.kind, 'proofroute-classifier-evidence-v1');
    assert.equal(evidenceArtifact.evidence.benchmark.deviceCount, 2);
    assert.equal(evidenceArtifact.evidence.benchmark.laneCount, 2);
    assert.equal(evidenceArtifact.evidence.benchmark.hardwareProbeProfileCount, 2);
    assert.equal(evidenceArtifact.evidence.deviceProfiles.length, 2);
    assert.equal(evidenceArtifact.evidence.artifacts[0].env, 'PROOFROUTE_ACCELERATOR_MODEL');
    assert.equal(evidenceArtifact.evidence.artifacts[0].status, 'hashed');
    assert.match(evidenceArtifact.evidence.artifacts[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(evidenceArtifact.evidence.configuration.PROOFROUTE_ACCELERATOR_MODEL, 'examples/linear-intent-model.json');
    assert.match(renderClassifierBenchmark(evidenceArtifact), /evidence/);
    assert.match(renderClassifierBenchmark(evidenceArtifact), /artifacts hashed/);
    assert.match(renderClassifierSvg(evidenceArtifact), /artifacts 1/);
    assert.doesNotMatch(JSON.stringify(evidenceArtifact), /Refactor this function/);
    const verifyEvidence = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', evidencePath], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(verifyEvidence.status, 0, verifyEvidence.stderr);
    assert.match(verifyEvidence.stdout, /CLASSIFIER EVIDENCE VERIFY/);
    assert.match(verifyEvidence.stdout, /PASS/);
    assert.match(verifyEvidence.stdout, /artifact_hash/);
    assert.match(verifyEvidence.stdout, /hardware_probe/);
    const verifyJson = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', evidencePath, '--json'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(verifyJson.status, 0, verifyJson.stderr);
    const verifyReport = JSON.parse(verifyJson.stdout);
    assert.equal(verifyReport.status, 'pass');
    assert.ok(verifyReport.checks.every((check) => check.pass));
    const missingEvidencePath = join(directory, 'missing-classifier-evidence.json');
    const missingVerifyJson = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', missingEvidencePath, '--require-hardware-probe', '--json'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(missingVerifyJson.status, 1);
    assert.equal(missingVerifyJson.stderr, '');
    const missingReport = JSON.parse(missingVerifyJson.stdout);
    assert.equal(missingReport.kind, 'proofroute-classifier-evidence-verify-v1');
    assert.equal(missingReport.status, 'fail');
    assert.match(missingReport.path, /missing-classifier-evidence\.json$/);
    assert.deepEqual(missingReport.checks.map((check) => check.id), ['evidence_file']);
    assert.equal(missingReport.checks[0].pass, false);
    assert.match(missingReport.checks[0].message, /was not found/);
    assert.doesNotMatch(JSON.stringify(missingReport), /Refactor this webhook|Extract customer ids|secret production prompt|sk-secret/i);
    const missingVerifyText = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', missingEvidencePath, '--require-hardware-probe'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(missingVerifyText.status, 1);
    assert.equal(missingVerifyText.stderr, '');
    assert.match(missingVerifyText.stdout, /CLASSIFIER EVIDENCE VERIFY/);
    assert.match(missingVerifyText.stdout, /evidence_file/);
    const invalidEvidencePath = join(directory, 'invalid-classifier-evidence.json');
    await writeFile(invalidEvidencePath, '{', 'utf8');
    const invalidVerifyJson = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', invalidEvidencePath, '--json'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(invalidVerifyJson.status, 1);
    assert.equal(invalidVerifyJson.stderr, '');
    const invalidReport = JSON.parse(invalidVerifyJson.stdout);
    assert.equal(invalidReport.kind, 'proofroute-classifier-evidence-verify-v1');
    assert.equal(invalidReport.status, 'fail');
    assert.equal(invalidReport.checks[0].id, 'evidence_file');
    assert.match(invalidReport.checks[0].message, /not valid classifier evidence JSON/);
    const missingOutPath = join(directory, 'missing-verify-report.json');
    const missingVerifyOut = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', missingEvidencePath, '--json', '--out', missingOutPath], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(missingVerifyOut.status, 1);
    assert.equal(missingVerifyOut.stdout, '');
    assert.equal(missingVerifyOut.stderr, '');
    const missingOutReport = JSON.parse(await readFile(missingOutPath, 'utf8'));
    assert.equal(missingOutReport.kind, 'proofroute-classifier-evidence-verify-v1');
    assert.equal(missingOutReport.status, 'fail');
    assert.equal(missingOutReport.failedChecks[0].id, 'evidence_file');
    const withoutHardwareGatePath = join(directory, 'classifier-evidence-without-hardware-gate.json');
    const withoutHardwareGate = structuredClone(evidenceArtifact);
    withoutHardwareGate.evidence.gates = withoutHardwareGate.evidence.gates.filter((gate) => gate.id !== 'hardware_probe');
    await writeFile(withoutHardwareGatePath, `${JSON.stringify(withoutHardwareGate, null, 2)}\n`, 'utf8');
    const strictWithoutHardwareGate = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', withoutHardwareGatePath, '--require-hardware-probe', '--json'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(strictWithoutHardwareGate.status, 1);
    const strictWithoutHardwareGateReport = JSON.parse(strictWithoutHardwareGate.stdout);
    assert.equal(strictWithoutHardwareGateReport.status, 'fail');
    assert.equal(strictWithoutHardwareGateReport.checks.find((check) => check.id === 'hardware_probe').pass, false);
    const tamperedPath = join(directory, 'classifier-evidence-tampered.json');
    const tamperedArtifact = structuredClone(evidenceArtifact);
    tamperedArtifact.evidence.artifacts[0].sha256 = '0'.repeat(64);
    await writeFile(tamperedPath, `${JSON.stringify(tamperedArtifact, null, 2)}\n`, 'utf8');
    const tampered = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', tamperedPath, '--json'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(tampered.status, 1);
    const tamperedReport = JSON.parse(tampered.stdout);
    assert.equal(tamperedReport.status, 'fail');
    assert.equal(tamperedReport.checks.find((check) => check.id === 'artifact_hash').pass, false);
    const multiGate = await runCli(['./bin/proofroute.js', 'classifier', '--bench', '--json', '--runs', '1', '--min-devices', '2', '--min-lanes', '2', '--require-device-profiles', '--require-hardware-probe'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(multiGate.status, 0, multiGate.stderr);
    const multiGateReport = JSON.parse(multiGate.stdout);
    assert.equal(multiGateReport.status, 'pass');
    assert.deepEqual(multiGateReport.checks.map((check) => check.id), ['devices', 'lanes', 'device_profiles', 'hardware_probe']);
    const missingDeviceGate = await runCli(['./bin/proofroute.js', 'classifier', '--bench', '--json', '--runs', '1', '--min-devices', '3', '--require-device-profiles'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(missingDeviceGate.status, 1);
    const missingDeviceReport = JSON.parse(missingDeviceGate.stdout);
    assert.equal(missingDeviceReport.status, 'fail');
    assert.equal(missingDeviceReport.checks.find((check) => check.id === 'devices').pass, false);
    const benchSvgPath = join(directory, 'classifier-bench.svg');
    const benchSvg = await runCli(['./bin/proofroute.js', 'classifier', '--bench', '--svg', '--runs', '1', '--out', benchSvgPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(benchSvg.status, 0, benchSvg.stderr);
    assert.equal(benchSvg.stdout, '');
    const benchSvgText = await readFile(benchSvgPath, 'utf8');
    assert.match(benchSvgText, /^<svg/);
    assert.match(benchSvgText, /benchmark receipt/);
    assert.doesNotMatch(benchSvgText, /Refactor this function/);
    const warmBench = await runCli(['./bin/proofroute.js', 'classifier', '--bench', '--warmup', '--json', '--runs', '1'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(warmBench.status, 0, warmBench.stderr);
    const warmBenchReport = JSON.parse(warmBench.stdout);
    assert.equal(warmBenchReport.status, 'pass');
    assert.equal(warmBenchReport.warmup.status, 'pass');
    assert.equal(warmBenchReport.warmup.count, 3);
    assert.equal(warmBenchReport.count, 5);
    assert.match(renderClassifierBenchmark(warmBenchReport), /warmup pass/);
    assert.doesNotMatch(JSON.stringify(warmBenchReport), /Refactor this function/);
    const gated = await runCli(['./bin/proofroute.js', 'classifier', '--bench', '--json', '--runs', '1', '--min-throughput', '999999999'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER_URL: `${sidecar.origin}/classify`,
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '200'
      },
      timeout: 1000
    });
    assert.equal(gated.status, 1);
    const gatedReport = JSON.parse(gated.stdout);
    assert.equal(gatedReport.status, 'fail');
    assert.equal(gatedReport.checks[0].id, 'throughput');
  } finally {
    await sidecar.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('classifier benchmark renders prompt-free accelerator proof', async () => {
  const report = await classifierBenchmarkReport({
    runs: 2,
    thresholds: {
      maxP95Ms: 1,
      minAccuracy: 0.9,
      minThroughput: 1,
      minDevices: 2,
      minLanes: 2,
      requireDeviceProfiles: true,
      requireHardwareProbe: true
    },
    samples: [
      { id: 'copy', intent: 'writing', prompt: 'Rewrite this launch note for GitHub.' },
      { id: 'json', intent: 'extraction', prompt: 'Extract ids and totals into strict JSON.' }
    ],
    classifier: {
      async classifyMany(prompts) {
        return prompts.map((prompt, index) => ({
          name: prompt.includes('JSON') ? 'extraction' : 'writing',
          confidence: 0.99,
          ranked: [],
          features: {
            backend: 'bench-test',
            lane: index % 2,
            device: String(index % 2),
            deviceProfile: {
              id: String(index % 2),
              name: `GPU ${index % 2}`,
              source: 'nvidia-smi'
            },
            decisionMs: 0.2 + index / 100
          }
        }));
      }
    }
  });
  assert.equal(report.status, 'pass');
  assert.equal(report.count, 4);
  assert.equal(report.aggregate.accuracy, 1);
  assert.equal(report.aggregate.backends['bench-test'], 4);
  assert.equal(report.aggregate.batchModes.single, 4);
  assert.equal(report.aggregate.averageBatchSize, 1);
  assert.equal(report.aggregate.deviceCount, 2);
  assert.equal(report.aggregate.laneCount, 2);
  assert.equal(report.aggregate.deviceProfileCount, 2);
  assert.equal(report.aggregate.hardwareProbeProfileCount, 2);
  assert.equal(report.checks.length, 7);
  assert.ok(report.checks.every((check) => check.pass));
  const output = renderClassifierBenchmark(report);
  assert.match(output, /CLASSIFIER PROOF/);
  assert.match(output, /PASS/);
  assert.match(output, /intent accuracy/);
  assert.match(output, /prompts\/s/);
  assert.match(output, /average batch size/);
  assert.match(output, /nvidia-smi profiles/);
  assert.match(output, /batch mix/);
  assert.match(output, /bench-test/);
  const svg = renderClassifierSvg(report);
  assert.match(svg, /^<svg/);
  assert.match(svg, /PASS/);
  assert.match(svg, /prompts\/s/);
  assert.match(svg, /2 lanes/);
  assert.match(svg, /declared profiles 2/);
  assert.match(svg, /hardware claim none/);
  assert.doesNotMatch(svg, /local hardware proof|nvidia-smi 2|2 devices|2 device profiles/);
  assert.doesNotMatch(JSON.stringify(report), /Rewrite this launch note/);
});

test('classifier benchmark hardware probe gate rejects manually declared profiles', async () => {
  const report = await classifierBenchmarkReport({
    runs: 1,
    thresholds: {
      minDevices: 2,
      minLanes: 2,
      requireDeviceProfiles: true,
      requireHardwareProbe: true
    },
    samples: [
      { id: 'copy', intent: 'writing', prompt: 'Rewrite this launch note for GitHub.' },
      { id: 'json', intent: 'extraction', prompt: 'Extract ids and totals into strict JSON.' }
    ],
    classifier: {
      async classifyMany(prompts) {
        return prompts.map((prompt, index) => ({
          name: prompt.includes('JSON') ? 'extraction' : 'writing',
          confidence: 0.99,
          ranked: [],
          features: {
            backend: 'manual-profile-test',
            lane: index % 2,
            device: String(index % 2),
            deviceProfile: {
              id: String(index % 2),
              name: `Manual GPU ${index % 2}`
            },
            decisionMs: 0.2 + index / 100
          }
        }));
      }
    }
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.aggregate.deviceProfileCount, 2);
  assert.equal(report.aggregate.hardwareProbeProfileCount, 0);
  const hardwareCheck = report.checks.find((check) => check.id === 'hardware_probe');
  assert.equal(hardwareCheck.pass, false);
  assert.equal(hardwareCheck.value, 0);
  assert.equal(hardwareCheck.target, 2);
  assert.match(renderClassifierBenchmark(report), /hardware probe/);
});

test('classifier evidence can verify a local linear artifact without hardware claims', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'proofroute-artifact-evidence-'));
  const evidencePath = join(directory, 'classifier-evidence.json');
  try {
    const evidenceOut = await runCli(['./bin/proofroute.js', 'classifier', '--bench', '--json', '--runs', '1', '--max-p95-ms', '200', '--min-accuracy', '0.8', '--evidence', '--out', evidencePath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROOFROUTE_CLASSIFIER: 'node ./examples/linear-classifier-command.js',
        PROOFROUTE_CLASSIFIER_TIMEOUT_MS: '1000',
        PROOFROUTE_ACCELERATOR_MODEL: 'examples/linear-intent-model.json'
      },
      timeout: 3000
    });
    assert.equal(evidenceOut.status, 0, evidenceOut.stderr);
    const evidenceArtifact = JSON.parse(await readFile(evidencePath, 'utf8'));
    assert.equal(evidenceArtifact.status, 'pass');
    assert.equal(evidenceArtifact.mode, 'command');
    assert.equal(evidenceArtifact.evidence.benchmark.deviceProfileCount, 0);
    assert.equal(evidenceArtifact.evidence.artifacts[0].env, 'PROOFROUTE_ACCELERATOR_MODEL');
    assert.equal(evidenceArtifact.evidence.artifacts[0].status, 'hashed');
    assert.equal(evidenceArtifact.evidence.configuration.PROOFROUTE_ACCELERATOR_MODEL, 'examples/linear-intent-model.json');
    const strictDefault = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', evidencePath, '--json'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(strictDefault.status, 1);
    const strictDefaultReport = JSON.parse(strictDefault.stdout);
    assert.equal(strictDefaultReport.checks.find((check) => check.id === 'device_profiles').pass, false);
    const verifyArtifact = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', evidencePath, '--allow-artifact-only', '--json'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(verifyArtifact.status, 0, verifyArtifact.stderr);
    const verifyReport = JSON.parse(verifyArtifact.stdout);
    assert.equal(verifyReport.status, 'pass');
    assert.equal(verifyReport.checks.find((check) => check.id === 'artifact_presence').pass, true);
    assert.equal(verifyReport.checks.some((check) => check.id === 'device_profiles'), false);
    const requireProfiles = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', evidencePath, '--require-device-profiles', '--json'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(requireProfiles.status, 1);
    const requireProfilesReport = JSON.parse(requireProfiles.stdout);
    assert.equal(requireProfilesReport.checks.find((check) => check.id === 'device_profiles').pass, false);
    const requireHardware = await runCli(['./bin/proofroute.js', 'classifier', '--verify-evidence', evidencePath, '--require-hardware-probe', '--json'], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 1000
    });
    assert.equal(requireHardware.status, 1);
    const requireHardwareReport = JSON.parse(requireHardware.stdout);
    assert.equal(requireHardwareReport.checks.find((check) => check.id === 'hardware_probe').pass, false);
    assert.doesNotMatch(JSON.stringify(evidenceArtifact), /Refactor this function/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('classifier metrics report explains builtin mode without sidecar', async () => {
  const report = await classifierMetricsReport({ classifier: {} });
  assert.equal(report.status, 'warn');
  assert.equal(report.mode, 'builtin');
  assert.match(renderClassifierMetrics(report), /Built-in classifier/);
});

function startSidecar(options) {
  const server = createClassifierSidecar(options);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200);
  return response.json();
}

function runCli(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Command timed out: ${args.join(' ')}`));
    }, options.timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}
