import { redactSupportText } from '../redaction.js';

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
    `${BOLD}First proof${RESET}`,
    '  node ./bin/proofroute.js demo',
    '  node ./bin/proofroute.js route --trace --prompt "why this model?"',
    '  node ./bin/proofroute.js connect --port 8787',
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
    '  proofroute share --svg --out docs/proofroute-terminal.svg',
    '  proofroute share --ledger --markdown',
    '  proofroute share --ledger --since 1h --markdown',
    '  proofroute prove --max-p95-ms 5 --min-accuracy 0.8',
    '  proofroute prove --ledger --min-requests 20 --max-p95-ms 5 --max-router-overhead-pct 1 --max-classifier-circuit-open 0',
    '  proofroute connect --port 8787',
    '  proofroute connect --local-openai http://127.0.0.1:1234/v1 --local-openai-model qwen3',
    '  proofroute connect --shell sh',
    '  proofroute models',
    '  proofroute profile',
    '  proofroute profile --check-public',
    '  proofroute profile --check-github',
    '  proofroute profile --sync-github',
    '  proofroute launch',
    '  proofroute launch --core',
    '  proofroute launch --check-github',
    '  proofroute launch --check-public',
    '  proofroute launch --json --telemetry .proofroute/events.jsonl',
    '  proofroute launch --require-artifact-evidence --artifact-evidence classifier-linear-evidence.json --max-evidence-age-hours 24',
    '  proofroute launch --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24',
    '  proofroute release --core --out proofroute-release-pack',
    '  proofroute release --core --require-artifact-evidence --artifact-evidence classifier-linear-evidence.json --max-evidence-age-hours 24 --out proofroute-release-pack',
    '  proofroute release --preflight --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24',
    '  proofroute release --preflight --smoke --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24',
    '  proofroute release --out proofroute-release-pack --check-github',
    '  proofroute release --preflight --core --check-public',
    '  proofroute release --out proofroute-release-pack --check-github --check-public --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24',
    '  proofroute publish --check-public --check-actions',
    '  proofroute publish --check-public --check-actions --probe-actions-dispatch',
    '  proofroute publish --check-public --check-actions --probe-actions-dispatch --support-note',
    '  proofroute publish --check-public --check-actions --probe-actions-dispatch --support-pack proofroute-publish-support-pack',
    '  proofroute publish --npm /path/to/npm-cli.js --check-public',
    '  proofroute smoke',
    '  proofroute smoke --proxy',
    '  proofroute smoke --proxy --matrix',
    '  proofroute bench --prompt "refactor this webhook" --runs 9',
    '  proofroute calibrate --file examples/samples.json',
    '  proofroute calibrate --file examples/samples.json --json --out calibration.json',
    '  proofroute learn --samples examples/samples.json --out examples/linear-intent-model.trained.json --onnx-out examples/linear-intent-model.trained.onnx',
    '  proofroute plan --prompt "ship this feature and review the risk"',
    '  proofroute fanout --prompt "ship this feature and review the risk"',
    '  proofroute stats',
    '  proofroute stats --since 1h',
    '  proofroute stats --watch --since 1h',
    '  proofroute privacy',
    '  proofroute privacy --file .proofroute/events.jsonl --json',
    '  proofroute classifier',
    '  proofroute classifier --warmup',
    '  proofroute classifier --bench --runs 5',
    '  proofroute classifier --bench --warmup --runs 5',
    '  proofroute classifier --bench --warmup --min-devices 2 --min-lanes 2 --require-device-profiles',
    '  proofroute classifier --bench --warmup --min-devices 2 --min-lanes 2 --require-device-profiles --require-hardware-probe',
    '  proofroute classifier --bench --json --out classifier-proof.json',
    '  proofroute classifier --bench --warmup --evidence --json --out classifier-evidence.json',
    '  proofroute classifier --bench --evidence --json --out classifier-evidence.json',
    '  proofroute classifier --verify-evidence classifier-evidence.json --allow-artifact-only --max-evidence-age-hours 24',
    '  proofroute classifier --verify-evidence classifier-evidence.json --require-device-profiles',
    '  proofroute classifier --warmup --svg --out docs/proofroute-classifier.svg',
    '  proofroute classifier --bench --warmup --min-devices 2 --min-lanes 2 --require-device-profiles --svg --out docs/proofroute-classifier-benchmark.svg',
    '  proofroute doctor',
    '  proofroute doctor --require-warmup',
    '  proofroute doctor --strict-hardware',
    '  proofroute doctor --require-warmup --min-classifier-devices 2 --min-classifier-lanes 2 --require-classifier-hardware-probe',
    '  proofroute tune',
    '  proofroute proxy --port 8787 --config router.json',
    '  proofroute proxy --require-classifier-warmup --port 8787 --config router.json',
    '  proofroute init > router.json',
    '  proofroute init --preset local-openai > router.json',
    '',
    `${BOLD}Commands${RESET}`,
    '  route   Classify one prompt and print the selected model with cost, speed, and trace evidence.',
    '  demo    Render a zero-network proof card with savings, speedup, p95 latency, and route mix.',
    '  share   Render a copy-ready routing receipt for terminal screenshots, Markdown posts, or SVG launch cards.',
    '  prove   Fail CI when launch proof or ledger proof misses latency, savings, speed, volume, or accuracy gates.',
    '  connect Print the drop-in OpenAI-compatible base URL, env exports, and proxy smoke commands.',
    '  models  Render the configured catalog as a terminal map of executability, economics, context, and intent leaders.',
    '  profile Print repository About copy, GitHub topics, README badges, npm metadata, launch pitch, proof commands, and optional GitHub drift checks.',
    '  launch  Run the local launch readiness proof across repository face, demo proof, proxy smoke, proxy matrix, privacy, assets, and classifier evidence.',
    '  release Write a prompt-free release proof pack with readiness JSON, repository metadata, git provenance, launch copy, and SVG proof assets.',
    '  publish Check npm, package, public face, GitHub Actions evidence, plain support notes, and redacted support packs while --json keeps JSON priority.',
    '  smoke   Run a local fake-provider execution loop through the Agent runtime, the transparent proxy, or a proxy routing matrix.',
    '  bench   Run a zero-network local benchmark that makes routing value visible immediately.',
    '  calibrate Run a local prompt suite and show intent accuracy, savings, and p95 routing latency.',
    '  learn   Train a local intent artifact from labeled samples or calibration reports and optionally export ONNX.',
    '  plan    Split one complex request into an asynchronous multi-agent routing plan.',
    '  fanout  Execute the asynchronous multi-agent plan through configured providers.',
    '  stats   Render or live-watch local privacy-preserving routing telemetry as terminal proof.',
    '  privacy Audit the local telemetry ledger for prompt, completion, request, response, or credential fields.',
    '  classifier Render classifier sidecar lane metrics or run a local classifier benchmark proof.',
  '  doctor  Check local runtime, providers, telemetry, classifier, and policy readiness.',
    '  tune    Recommend a routing policy patch from the local telemetry ledger.',
    '  proxy   Start an OpenAI-compatible transparent proxy for chat, completions, and responses.',
    '  init    Print the default or local OpenAI-compatible model catalog as editable JSON.'
  ].join('\n');
}

export function renderRepositoryProfile(report) {
  return [
    title('repository face'),
    `${BOLD}${report.github.description}${RESET}`,
    `${pad('topics', 16)} ${CYAN}${report.github.topicLine}${RESET}`,
    '',
    `${pad('npm', 16)} ${report.npm.name}@${report.npm.version}`,
    `${pad('description', 16)} ${report.npm.description}`,
    `${pad('keywords', 16)} ${compactText(report.npm.keywordLine, 132)}`,
    '',
    `${pad('social preview', 16)} ${report.social.preview}`,
    `${pad('accelerator', 16)} ${report.social.acceleratorPreview}`,
    `${pad('badges', 16)} ${(report.social.badges ?? []).map((badge) => badge.id).join(', ')}`,
    `${pad('short pitch', 16)} ${compactText(report.social.shortPitch, 132)}`,
    `${pad('vibe pitch', 16)} ${compactText(report.social.vibePitch, 132)}`,
    '',
    `${pad('first proof', 16)} ${report.commands.firstProof}`,
    `${pad('public face', 16)} ${report.commands.publicFace}`,
    `${pad('npm dry run', 16)} ${report.commands.npmDryRun}`,
    `${pad('publish gate', 16)} ${report.commands.publishPreflight}`,
    `${pad('support note', 16)} ${report.commands.publishSupportNote}`,
    `${pad('support pack', 16)} ${report.commands.publishSupportPack}`,
    `${pad('core launch', 16)} ${report.commands.coreLaunch}`,
    `${pad('public launch', 16)} ${report.commands.publicLaunch}`,
    `${pad('core pack', 16)} ${report.commands.coreReleasePack}`,
    `${pad('artifact pack', 16)} ${report.commands.artifactReleasePack}`,
    `${pad('strict preflight', 16)} ${report.commands.releaseStrictPreflight}`,
    `${pad('public preflight', 16)} ${report.commands.publicReleasePreflight}`,
    `${pad('launch ready', 16)} ${report.commands.launchReadiness}`,
    `${pad('strict launch', 16)} ${report.commands.launchEvidenceGate}`,
    `${pad('share card', 16)} ${report.commands.shareSvg}`,
    `${pad('privacy proof', 16)} ${report.commands.privacyProof}`,
    `${pad('hardware doctor', 16)} ${report.commands.hardwareDoctor}`,
    `${pad('classifier card', 16)} ${report.commands.acceleratorSvg}`,
    `${pad('artifact gate', 16)} ${report.commands.artifactEvidenceGate}`,
    `${pad('linear gate', 16)} ${report.commands.linearEvidenceGate}`,
    `${pad('hardware gate', 16)} ${report.commands.hardwareProbeGate}`,
    `${pad('hardware verify', 16)} ${report.commands.hardwareEvidenceVerify}`,
    `${pad('proof gate', 16)} ${report.commands.proofGate}`,
    '',
    `${DIM}${report.privacy}${RESET}`
  ].join('\n');
}

export function renderGithubRepositoryState(report) {
  const mark = report.status === 'pass' ? `${GREEN}PASS${RESET}` : `${MAGENTA}FAIL${RESET}`;
  const rows = report.comparison.checks.map((check) => {
    const state = check.pass ? `${GREEN}pass${RESET}` : `${MAGENTA}fail${RESET}`;
    if (check.id === 'topics') {
      return `${state} ${pad(check.label, 14)} ${DIM}${check.current.length}/${check.desired.length} topics, missing ${check.missing.length}, extra ${check.extra.length}${RESET}`;
    }
    const drift = check.pass ? check.current : `${check.current || 'empty'} -> ${check.desired || 'empty'}`;
    return `${state} ${pad(check.label, 14)} ${DIM}${compactText(drift, 120)}${RESET}`;
  });
  const operations = report.operations?.length ? report.operations.join(', ') : 'none';
  return [
    title('github repository face'),
    `${BOLD}${mark}${RESET} ${DIM}${report.mode} ${report.repository} against local ProofRoute repository profile.${RESET}`,
    `${pad('url', 16)} ${report.url ?? 'unknown'}`,
    `${pad('changed', 16)} ${report.changed ? 'yes' : 'no'}`,
    `${pad('operations', 16)} ${operations}`,
    '',
    ...rows
  ].join('\n');
}

export function renderPublicRepositoryFace(report) {
  const mark = report.status === 'pass' ? `${GREEN}PASS${RESET}` : `${MAGENTA}FAIL${RESET}`;
  const rows = (report.checks ?? []).map((check) => {
    const state = check.pass ? `${GREEN}pass${RESET}` : `${MAGENTA}fail${RESET}`;
    return `${state} ${pad(check.label, 24)} ${DIM}${compactText(check.detail, 112)}${RESET}`;
  });
  return [
    title('public repository face'),
    `${BOLD}${mark}${RESET} ${DIM}${report.repository} and npm package ${report.npmPackage} checked without credentials.${RESET}`,
    `${pad('owner', 16)} ${report.github?.owner?.url ?? 'unknown'} status ${report.github?.owner?.status ?? 'error'}`,
    `${pad('github', 16)} ${report.github?.url ?? 'unknown'} status ${report.github?.status ?? 'error'}`,
    `${pad('npm', 16)} ${report.npm?.url ?? 'unknown'} status ${report.npm?.status ?? 'error'}${report.npm?.latest ? ` latest ${report.npm.latest}` : ''}`,
    '',
    ...rows
  ].join('\n');
}

export function renderReleaseProofPack(report) {
  const mark = report.status === 'pass' ? `${GREEN}PASS${RESET}` : report.status === 'warn' ? `${YELLOW}WARN${RESET}` : `${MAGENTA}FAIL${RESET}`;
  const github = report.launch?.github ? `${report.launch.github.status} ${report.launch.github.repository ?? ''}`.trim() : 'not checked';
  const publicFace = report.launch?.public ? `${report.launch.public.status} owner ${report.launch.public.github?.owner?.status ?? 'unknown'} github ${report.launch.public.github?.status ?? 'unknown'} npm ${report.launch.public.npm?.status ?? 'unknown'}` : 'not checked';
  const evidence = releaseEvidenceDisplay(report.launch?.evidence);
  const evidenceLabel = releaseEvidenceLabel(report.launch?.evidence);
  const artifactEvidence = report.launch?.artifactEvidence ? `${report.launch.artifactEvidence.status ?? 'unknown'} claim ${report.launch.artifactEvidence.claim ?? 'local_artifact'} ${report.launch.artifactEvidence.path ?? 'classifier-linear-evidence.json'}` : undefined;
  const source = releaseSourceLine(report.git);
  const age = report.launch?.evidence?.status === 'not_claimed' ? 'not claimed' : report.launch?.evidence?.evidenceAgeMs === undefined ? 'untracked' : `${(Number(report.launch.evidence.evidenceAgeMs) / 3600000).toFixed(2)}h`;
  const artifactAge = report.launch?.artifactEvidence?.evidenceAgeMs === undefined ? undefined : `${(Number(report.launch.artifactEvidence.evidenceAgeMs) / 3600000).toFixed(2)}h`;
  const blockers = evidenceFailureRows(report.launch?.evidence, 'evidence').concat(evidenceFailureRows(report.launch?.artifactEvidence, 'artifact'));
  const copiedAssets = (report.assetCopies ?? []).filter((asset) => asset.status === 'copied').length;
  const files = (report.files ?? []).slice(0, 8).map((file) => `${DIM}${file}${RESET}`);
  return [
    title('release proof pack'),
    `${BOLD}${mark}${RESET} ${DIM}${report.outDir}${RESET} now contains a prompt-free release evidence pack.`,
    `${pad('github face', 16)} ${github}`,
    `${pad('public face', 16)} ${publicFace}`,
    `${pad('source', 16)} ${source}`,
    `${pad(evidenceLabel, 16)} ${evidence}`,
    `${pad('evidence age', 16)} ${age}`,
    ...(artifactEvidence ? [`${pad('artifact', 16)} ${artifactEvidence}`, `${pad('artifact age', 16)} ${artifactAge ?? 'untracked'}`] : []),
    ...blockers,
    `${pad('svg assets', 16)} ${copiedAssets}/${(report.assetCopies ?? []).length} copied`,
    `${pad('files', 16)} ${(report.files ?? []).length}`,
    '',
    ...files
  ].join('\n');
}

export function renderReleasePreflight(report) {
  const mark = report.status === 'pass' ? `${GREEN}PASS${RESET}` : report.status === 'warn' ? `${YELLOW}WARN${RESET}` : `${MAGENTA}FAIL${RESET}`;
  const github = report.launch?.github ? `${report.launch.github.status} ${report.launch.github.repository ?? ''}`.trim() : 'not checked';
  const publicFace = report.launch?.public ? `${report.launch.public.status} owner ${report.launch.public.github?.owner?.status ?? 'unknown'} github ${report.launch.public.github?.status ?? 'unknown'} npm ${report.launch.public.npm?.status ?? 'unknown'}` : 'not checked';
  const source = releaseSourceLine(report.git);
  const evidence = releaseEvidenceDisplay(report.launch?.evidence);
  const evidenceLabel = releaseEvidenceLabel(report.launch?.evidence);
  const artifact = report.launch?.artifactEvidence ? `${report.launch.artifactEvidence.status ?? 'unknown'} claim ${report.launch.artifactEvidence.claim ?? 'local_artifact'} ${report.launch.artifactEvidence.path ?? 'classifier-linear-evidence.json'}` : undefined;
  const blockers = evidenceFailureRows(report.launch?.evidence, 'evidence').concat(evidenceFailureRows(report.launch?.artifactEvidence, 'artifact'));
  const files = (report.wouldWrite ?? []).map((file) => `${DIM}${file}${RESET}`);
  return [
    title('release preflight'),
    `${BOLD}${mark}${RESET} ${DIM}${report.outDir}${RESET} was checked without writing a release proof pack.`,
    `${pad('github face', 16)} ${github}`,
    `${pad('public face', 16)} ${publicFace}`,
    `${pad('source', 16)} ${source}`,
    `${pad(evidenceLabel, 16)} ${evidence}`,
    ...(artifact ? [`${pad('artifact', 16)} ${artifact}`] : []),
    ...blockers,
    `${pad('would write', 16)} ${(report.wouldWrite ?? []).length} release pack entries`,
    '',
    ...files
  ].join('\n');
}

export function renderPublishReadiness(report) {
  const mark = report.status === 'pass' ? `${GREEN}PASS${RESET}` : `${MAGENTA}FAIL${RESET}`;
  const rows = (report.checks ?? []).map((check) => {
    const state = check.pass ? `${GREEN}pass${RESET}` : check.skipped ? `${YELLOW}skip${RESET}` : `${MAGENTA}fail${RESET}`;
    return `${state} ${pad(check.label, 24)} ${DIM}${compactText(check.detail, 112)}${RESET}`;
  });
  const publicFace = report.public ? `${report.public.status} owner ${report.public.github?.owner?.status ?? 'unknown'} github ${report.public.github?.status ?? 'unknown'} npm ${report.public.npm?.status ?? 'unknown'}` : 'not checked';
  const github = report.github ? `${report.github.summary?.pass ? 'pass' : 'fail'} ${report.github.repository?.visibility ?? 'unknown'} private ${report.github.repository?.isPrivate === false ? 'no' : report.github.repository?.isPrivate === true ? 'yes' : 'unknown'}` : 'not checked';
  const account = report.account ? `${report.account.summary?.pass ? 'pass' : 'fail'}${report.account.blocker ? ` ${report.account.blocker}` : ''}` : 'not checked';
  const actions = report.actions ? `${report.actions.summary?.pass ? 'pass' : 'fail'} enabled ${report.actions.permissions?.enabled === true ? 'yes' : 'unknown'} runs ${(report.actions.runs ?? []).length}${report.actions.dispatch ? ` dispatch ${report.actions.dispatch.ok ? 'ok' : 'fail'}` : ''}` : 'not checked';
  const npmEvidence = renderNpmPublishEvidence(report.npm?.evidence);
  const localEvidence = renderPublishLocalEvidence(report.summary);
  const supportPack = report.supportPack ? `${report.supportPack.status ?? report.status ?? 'unknown'} ${report.supportPack.outDir ?? 'proofroute-publish-support-pack'} files ${(report.supportPack.files ?? []).length}` : undefined;
  const blockers = (report.blockers ?? []).map((blocker) => `${MAGENTA}${blocker.id}${RESET} ${DIM}${compactText(blocker.nextAction, 112)}${RESET}`);
  return [
    title('publish readiness'),
    `${BOLD}${mark}${RESET} ${DIM}${report.package?.name}@${report.package?.version} publish preflight for package surface, npm registry auth, public visibility, and launch evidence.${RESET}`,
    `${pad('npm command', 16)} ${report.npm?.command ?? 'npm'}`,
    `${pad('npm evidence', 16)} ${npmEvidence}`,
    `${pad('local evidence', 16)} ${localEvidence}`,
    `${pad('registry', 16)} ${report.npm?.registry ?? 'https://registry.npmjs.org/'}`,
    `${pad('github auth', 16)} ${github}`,
    `${pad('account', 16)} ${account}`,
    `${pad('public face', 16)} ${publicFace}`,
    `${pad('actions', 16)} ${actions}`,
    ...(supportPack ? [`${pad('support pack', 16)} ${supportPack}`] : []),
    '',
    ...rows,
    ...(blockers.length > 0 ? ['', `${BOLD}next actions${RESET}`, ...blockers] : [])
  ].join('\n');
}

export function renderPublishSupportNote(report) {
  const blockers = report.blockers ?? [];
  const nextActions = report.nextActions ?? [];
  const supportMessages = blockers.map((blocker) => redactSupportText(blocker.supportMessage)).filter(Boolean);
  const evidence = blockers.map((blocker) => `${redactSupportText(blocker.id)}: ${redactSupportText(blocker.detail)}`);
  const npmEvidence = supportNoteNpmEvidence(report.npm?.evidence);
  const localEvidence = supportNoteLocalEvidence(report.summary);
  const actionLines = nextActions.map((action) => {
    const command = action.command ? ` Command: ${redactSupportText(action.command)}` : '';
    return `${redactSupportText(action.forBlocker)}: ${redactSupportText(action.summary)}${command}`;
  });
  return [
    'ProofRoute publish support note',
    `Generated at ${redactSupportText(report.generatedAt ?? 'unknown time')}.`,
    `Package ${redactSupportText(report.package?.name ?? 'unknown')}@${redactSupportText(report.package?.version ?? 'unknown')} for repository ${redactSupportText(report.package?.repository ?? 'unknown repository')}.`,
    `Publish preflight status is ${redactSupportText(report.status ?? 'unknown')}.`,
    `Authenticated GitHub repository state is ${report.github?.summary?.pass ? 'public' : 'not proven public'}.`,
    `Anonymous public face state is ${redactSupportText(report.public?.status ?? 'not checked')}.`,
    `GitHub account visibility blocker is ${redactSupportText(report.account?.blocker ?? 'not detected')}.`,
    `GitHub Actions state is ${report.actions?.summary?.pass ? 'passing' : report.actions ? 'not ready' : 'not checked'}.`,
    `Npm evidence is ${npmEvidence}.`,
    `Local publish evidence is ${localEvidence}.`,
    '',
    'Blockers',
    ...(evidence.length > 0 ? evidence : ['No publish blockers were detected by this run.']),
    '',
    'Next actions',
    ...(actionLines.length > 0 ? actionLines : ['No next actions are required by this run.']),
    ...(supportMessages.length > 0 ? ['', 'Support message', ...supportMessages] : [])
  ].join('\n');
}

function renderNpmPublishEvidence(evidence) {
  if (!evidence) return 'not attached';
  const version = evidence.version ? `npm ${evidence.version}` : `cli ${evidence.cli ?? 'unknown'}`;
  const pack = evidence.package ? `${evidence.package.filename ?? 'package'} files ${evidence.package.entryCount ?? 'unknown'} size ${compactBytes(evidence.package.size)} unpacked ${compactBytes(evidence.package.unpackedSize)}` : 'package unknown';
  const missing = evidence.requiredFilesMissing === 0 ? 'required ok' : `required missing ${evidence.requiredFilesMissing ?? 'unknown'}`;
  return compactText(`${version}, pack ${evidence.pack ?? 'unknown'}, ${pack}, ${missing}, dry-run ${evidence.publishDryRun ?? 'unknown'}, auth ${evidence.auth ?? 'unknown'}`, 132);
}

function renderPublishLocalEvidence(summary) {
  if (!summary) return 'not summarized';
  const remaining = summary.blockerIds?.length ? summary.blockerIds.join(', ') : 'none';
  return compactText(`${summary.localEvidence ?? 'unknown'}; remaining scope ${summary.remainingBlockerScope ?? 'unknown'}; blockers ${remaining}`, 132);
}

function supportNoteNpmEvidence(evidence) {
  if (!evidence) return 'not attached';
  const pack = evidence.package;
  return redactSupportText(`command ${evidence.command ?? 'unknown'}, version ${evidence.version ?? 'unknown'}, pack ${evidence.pack ?? 'unknown'}, package ${pack?.filename ?? 'unknown'} with ${pack?.entryCount ?? 'unknown'} files, required missing ${evidence.requiredFilesMissing ?? 'unknown'} of ${evidence.requiredFilesChecked ?? 'unknown'}, dry-run ${evidence.publishDryRun ?? 'unknown'}, auth ${evidence.auth ?? 'unknown'}`);
}

function supportNoteLocalEvidence(summary) {
  if (!summary) return 'not summarized';
  return redactSupportText(`${summary.localEvidence ?? 'unknown'} with remaining scope ${summary.remainingBlockerScope ?? 'unknown'}, operator blockers ${(summary.operatorBlockerIds ?? []).join(', ') || 'none'}, external blockers ${(summary.externalBlockerIds ?? []).join(', ') || 'none'}, and local blockers ${(summary.localFixableBlockerIds ?? []).join(', ') || 'none'}`);
}

function compactBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'unknown';
  if (number >= 1024 * 1024) return `${(number / 1024 / 1024).toFixed(2)}mb`;
  if (number >= 1024) return `${(number / 1024).toFixed(1)}kb`;
  return `${number}b`;
}

function releaseSourceLine(git) {
  if (!git) return 'unknown';
  if (git.available) return `${git.branch ?? 'unknown'}@${git.shortCommit ?? 'unknown'} ${git.dirty ? `dirty ${git.changedFileCount ?? 0}` : 'clean'}`;
  return git.skipped ? 'skipped' : 'unavailable';
}

function releaseEvidenceLabel(evidence) {
  if (evidence?.claim === 'hardware') return 'hardware proof';
  if (evidence?.claim === 'none' || evidence?.status === 'not_claimed') return 'core claim';
  return 'classifier proof';
}

function releaseEvidenceDisplay(evidence) {
  if (evidence?.status === 'not_claimed') return 'none, accelerator claim not made';
  const claim = evidence?.claim ?? 'classifier';
  const probe = evidence?.requireHardwareProbe ? 'hardware_probe required' : 'hardware_probe not required';
  return `${evidence?.status ?? 'unknown'} claim ${claim}, ${probe}`;
}

export function renderLaunchReadiness(report) {
  const mark = report.status === 'pass' ? `${GREEN}PASS${RESET}` : report.status === 'warn' ? `${YELLOW}WARN${RESET}` : `${MAGENTA}FAIL${RESET}`;
  const rows = report.checks.map((check) => {
    const state = check.status === 'pass' ? `${GREEN}pass${RESET}` : check.status === 'warn' ? `${YELLOW}warn${RESET}` : `${MAGENTA}fail${RESET}`;
    return `${state} ${pad(check.label, 20)} ${DIM}${check.detail}${RESET}`;
  });
  const proof = report.proof?.aggregate ?? {};
  const smoke = report.smoke ?? {};
  const smokeMatrix = report.smokeMatrix ?? {};
  const privacy = report.privacy ?? {};
  const evidence = report.evidence ?? {};
  const evidenceAge = evidence.evidenceAgeMs === undefined ? '' : ` age ${(Number(evidence.evidenceAgeMs) / 3600000).toFixed(2)}h`;
  const evidenceText = evidence.status === 'not_claimed' ? 'claim none, accelerator claim not made' : `${evidence.status ?? 'unknown'} claim ${evidence.claim ?? 'classifier'} ${evidence.path ?? 'classifier-evidence.json'}${evidenceAge}`;
  const artifactEvidence = report.artifactEvidence;
  const artifactEvidenceAge = artifactEvidence?.evidenceAgeMs === undefined ? '' : ` age ${(Number(artifactEvidence.evidenceAgeMs) / 3600000).toFixed(2)}h`;
  const artifactEvidenceText = artifactEvidence ? `${artifactEvidence.status ?? 'unknown'} claim ${artifactEvidence.claim ?? 'local_artifact'} ${artifactEvidence.path ?? 'classifier-linear-evidence.json'}${artifactEvidenceAge} no hardware claim` : undefined;
  const blockers = evidenceFailureRows(evidence, 'evidence').concat(evidenceFailureRows(artifactEvidence, 'artifact'));
  const github = report.github;
  const publicFace = report.public;
  return [
    title('launch readiness'),
    `${BOLD}${mark}${RESET} ${DIM}local zero-network launch proof for repository face, routing value, proxy compatibility, privacy boundary, share assets, and classifier evidence.${RESET}`,
    `${GREEN}${money(proof.savingsUsd ?? 0)} saved${RESET}, ${MAGENTA}${Number(proof.averageSpeedup ?? 0).toFixed(2)}x${RESET} speedup, ${YELLOW}${ms(Number(proof.p95RouterMs ?? 0))}${RESET} p95 router, ${YELLOW}${percent(proof.p95RouterOverheadPct ?? 0)}${RESET} overhead, ${CYAN}${report.profile?.topicCount ?? 0}${RESET} GitHub topics.`,
    `${pad('proxy smoke', 16)} ${smoke.status ?? 'unknown'} ${smoke.requestedModel ?? 'none'}->${smoke.model ?? 'none'} swap ${smoke.modelSwap ?? 'false'} browser ${smoke.browserProofHeaders ? 'readable' : 'unknown'}`,
    `${pad('proxy matrix', 16)} ${smokeMatrix.status ?? 'skipped'} ${smokeMatrix.passed ?? 0}/${smokeMatrix.count ?? 0} scenarios swaps ${smokeMatrix.modelSwaps ?? 0}/${smokeMatrix.count ?? 0} privacy ${smokeMatrix.privacyStatus ?? 'unknown'} ledger ${smokeMatrix.promptFreeLedger ? 'prompt-free' : 'unknown'} browser ${smokeMatrix.browserProofHeaders ? 'readable' : 'unknown'}`,
    ...(github ? [`${pad('github face', 16)} ${github.status ?? 'unknown'} ${github.repository ?? 'unresolved'}`] : []),
    ...(publicFace ? [`${pad('public face', 16)} ${publicFace.status ?? 'unknown'} owner ${publicFace.github?.owner?.status ?? 'unknown'} github ${publicFace.github?.status ?? 'unknown'} npm ${publicFace.npm?.status ?? 'unknown'}`] : []),
    `${pad('privacy', 16)} ${privacy.status ?? 'unknown'} ${privacy.events ?? 0} events, ${privacy.forbiddenMatchCount ?? 0} forbidden fields, ${privacy.parseErrorCount ?? 0} parse errors`,
    `${pad('evidence', 16)} ${evidenceText}`,
    ...(artifactEvidenceText ? [`${pad('artifact', 16)} ${artifactEvidenceText}`] : []),
    ...blockers,
    '',
    ...rows
  ].join('\n');
}

function evidenceFailureRows(report, label) {
  const failed = Array.isArray(report?.failedChecks) ? report.failedChecks : Array.isArray(report?.checks) ? report.checks.filter((check) => !check.pass) : [];
  return failed.slice(0, 3).map((check) => `${pad(`${label} blocker`, 16)} ${check.id}: ${compactText(check.message, 108)}`);
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
  const tradeoffs = renderCandidateTradeoffs(decision);
  const output = [
    title('routing trace'),
    `${BOLD}${decision.model.id}${RESET} wins for ${CYAN}${decision.intent.name}${RESET} under ${CYAN}${decision.policy ?? 'balanced'}${RESET} policy because quality ${signed(components.quality)}, context ${signed(components.context)}, local ${signed(components.local)}, requested ${signed(components.requested)}, cost ${signed(components.cost)}, and latency ${signed(components.latency)} settle at ${pct(decision.confidence)} probability.`,
    `${DIM}${decision.inputTokens} input tokens, ${decision.outputTokens} planned output tokens, ${money(decision.economics.savingsUsd)} estimated savings, ${decision.performance.speedup.toFixed(2)}x speedup, cache ${decision.cache?.hit ? 'hit' : 'miss'}.${RESET}`,
    '',
    routeReceipt(decision),
    '',
    ...tradeoffs,
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

function renderCandidateTradeoffs(decision, limit = 5) {
  const candidates = decision.ranked.slice(0, limit);
  const costs = candidates.map((candidate) => finite(candidate.estimatedCostUsd)).filter(Number.isFinite);
  const latencies = candidates.map((candidate) => finite(candidate.estimatedLatencyMs)).filter(Number.isFinite);
  const minCost = costs.length ? Math.min(...costs) : 0;
  const maxCost = costs.length ? Math.max(...costs) : 0;
  const minLatency = latencies.length ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length ? Math.max(...latencies) : 0;
  const requiredTokens = finite(decision.inputTokens) + finite(decision.outputTokens);
  const rows = candidates.map((candidate, index) => {
    const marker = index === 0 ? `${GREEN}winner ${RESET}` : `${DIM}option ${RESET}`;
    const costFit = inverseRange(candidate.estimatedCostUsd, minCost, maxCost);
    const latencyFit = inverseRange(candidate.estimatedLatencyMs, minLatency, maxLatency);
    return `${marker}${pad(candidate.model, 20)} ${bar(candidate.probability, 14)} ${pct(candidate.probability)} ${bar(costFit, 10)} ${pad(money(candidate.estimatedCostUsd), 10)} ${bar(latencyFit, 10)} ${pad(ms(candidate.estimatedLatencyMs), 11)} ${contextUse(candidate, requiredTokens)}`;
  });
  return [
    `${pad('candidate', 27)} probability     cost fit   cost       speed fit  latency    context use`,
    ...rows
  ];
}

function routeReceipt(decision) {
  const chosen = decision.ranked[0];
  const runnerUp = decision.ranked.find((candidate) => candidate.model !== chosen.model);
  if (!runnerUp) {
    return `${pad('decision receipt', 18)} ${chosen.model} is the only viable route at ${pct(chosen.probability)} probability with ${money(chosen.estimatedCostUsd)} cost, ${ms(chosen.estimatedLatencyMs)} latency, and ${contextUse(chosen, finite(decision.inputTokens) + finite(decision.outputTokens))}.`;
  }
  const qualityDelta = finite(chosen.components?.quality) - finite(runnerUp.components?.quality);
  const probabilityDelta = finite(chosen.probability) - finite(runnerUp.probability);
  return `${pad('decision receipt', 18)} ${chosen.model} over ${runnerUp.model}: probability edge ${signedPct(probabilityDelta)}, quality term ${signed(qualityDelta)}, ${moneyDelta(chosen.estimatedCostUsd, runnerUp.estimatedCostUsd)}, ${latencyDelta(chosen.estimatedLatencyMs, runnerUp.estimatedLatencyMs)}, ${contextUse(chosen, finite(decision.inputTokens) + finite(decision.outputTokens))}.`;
}

function moneyDelta(left, right) {
  const delta = finite(left) - finite(right);
  if (Math.abs(delta) < 1e-12) return 'cost equal';
  return delta < 0 ? `cost ${money(Math.abs(delta))} less` : `cost ${money(delta)} more`;
}

function latencyDelta(left, right) {
  const delta = finite(left) - finite(right);
  if (Math.abs(delta) < 1e-9) return 'latency equal';
  return delta < 0 ? `latency ${ms(Math.abs(delta))} faster` : `latency ${ms(delta)} slower`;
}

function contextUse(candidate, requiredTokens) {
  const window = finite(candidate.contextWindow);
  const required = finite(requiredTokens);
  if (!Number.isFinite(window) || window <= 0) return 'context use unknown';
  return `context ${compactTokens(required)}/${compactTokens(window)}`;
}

function inverseRange(value, min, max) {
  const number = finite(value);
  const bottom = finite(min);
  const top = finite(max);
  if (!Number.isFinite(number) || !Number.isFinite(bottom) || !Number.isFinite(top) || top <= bottom) return 1;
  return Math.max(0, Math.min(1, 1 - (number - bottom) / (top - bottom)));
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function renderLaunchDemo(report) {
  const summary = report.aggregate;
  const accuracy = typeof summary.accuracy === 'number' ? pct(summary.accuracy) : 'unlabeled';
  const rows = report.routes.map((row) => {
    return `${pad(row.actualIntent, 13)} ${pad(row.model, 20)} ${pct(row.confidence)} ${money(row.savingsUsd)} ${row.speedup.toFixed(2)}x ${ms(row.latencyMs)}`;
  });
  const costRatio = Math.min(1, Math.max(0, summary.savingsPct));
  const speedRatio = Math.min(1, Math.max(0, summary.averageSpeedup / 4));
  const overheadRatio = Math.min(1, Math.max(0, (summary.p95RouterOverheadPct ?? 0) / 1));
  const accuracyRatio = typeof summary.accuracy === 'number' ? summary.accuracy : 0;
  const hitCount = typeof summary.accuracy === 'number' ? Math.round(summary.accuracy * summary.labeled) : 0;
  const costWidth = Math.min(40, Math.max(3, Math.round(costRatio * 40)));
  const speedWidth = Math.min(40, Math.max(3, Math.round(speedRatio * 40)));
  return [
    title('route proof'),
    `${BOLD}${summary.count} prompts${RESET} routed before any provider call, with p95 decision ${YELLOW}${ms(summary.p95RouterMs)}${RESET}, p95 overhead ${YELLOW}${percent(summary.p95RouterOverheadPct ?? 0)}${RESET}, and total runtime ${CYAN}${ms(report.elapsedMs)}${RESET}.`,
    `${GREEN}${money(summary.savingsUsd)} saved${RESET} against the priciest viable routes, with ${MAGENTA}${summary.averageSpeedup.toFixed(2)}x${RESET} average estimated speedup and ${CYAN}${accuracy}${RESET} labeled intent accuracy.`,
    '',
    `${pad('money delta', 16)} ${GREEN}${'█'.repeat(costWidth)}${DIM}${'░'.repeat(40 - costWidth)}${RESET} ${pct(costRatio)}`,
    `${pad('speed lift', 16)} ${MAGENTA}${'█'.repeat(speedWidth)}${DIM}${'░'.repeat(40 - speedWidth)}${RESET} ${summary.averageSpeedup.toFixed(2)}x`,
    `${pad('route overhead', 16)} ${bar(overheadRatio, 40)} ${percent(summary.p95RouterOverheadPct ?? 0)}`,
    `${pad('intent hits', 16)} ${bar(accuracyRatio, 40)} ${hitCount}/${summary.labeled}`,
    '',
    `${pad('intent', 13)} ${pad('model', 20)} confidence savings    speed router`,
    ...rows,
    '',
    `intent mix ${compactCounts(summary.intents)}   policy mix ${compactCounts(summary.policies ?? {}) || 'none'}   classifier mix ${compactCounts(summary.classifierBackends ?? {}) || 'none'}   model mix ${compactCounts(summary.models)}`
  ].join('\n');
}

export function renderShare(report) {
  const summary = report.aggregate;
  const accuracy = shareAccuracy(summary);
  const localRatio = summary.count ? summary.localRoutes / summary.count : 0;
  const cloudRatio = summary.count ? summary.cloudRoutes / summary.count : 0;
  const swapCount = Number(summary.modelSwaps ?? 0);
  const swapRatio = summary.count ? swapCount / summary.count : 0;
  const moneyWidth = Math.min(40, Math.max(3, Math.round(summary.savingsPct * 40)));
  const speedWidth = Math.min(40, Math.max(3, Math.round(Math.min(summary.averageSpeedup, 4) / 4 * 40)));
  const ledger = report.source === 'ledger';
  const scope = ledger ? `from private local traffic${ledgerScope(report)}` : 'for a model menu that finally disappears';
  const copy = shareCopyLine(summary, report);
  const policyMix = compactCounts(summary.policies ?? {});
  const classifierMix = compactCounts(summary.classifierBackends ?? {});
  return [
    title('shareable proof'),
    `${BOLD}${ledger ? 'LOCAL TELEMETRY ROUTING RECEIPT' : 'ZERO-NETWORK ROUTING RECEIPT'}${RESET} ${DIM}${scope}.${RESET}`,
    `${GREEN}${money(summary.savingsUsd)} saved${RESET}, ${MAGENTA}${summary.averageSpeedup.toFixed(2)}x${RESET} estimated speedup, ${YELLOW}${ms(summary.p95RouterMs)}${RESET} p95 decision, ${YELLOW}${percent(summary.p95RouterOverheadPct ?? 0)}${RESET} router overhead, ${CYAN}${accuracy}${RESET}.`,
    '',
    `${pad('local routes', 16)} ${bar(localRatio, 40)} ${summary.localRoutes}/${summary.count}`,
    `${pad('cloud routes', 16)} ${bar(cloudRatio, 40)} ${summary.cloudRoutes}/${summary.count}`,
    ...(swapCount > 0 ? [`${pad('model swaps', 16)} ${bar(swapRatio, 40)} ${swapCount}/${summary.count}`] : []),
    `${pad('money saved', 16)} ${GREEN}${'█'.repeat(moneyWidth)}${DIM}${'░'.repeat(40 - moneyWidth)}${RESET} ${pct(summary.savingsPct)}`,
    `${pad('speed lift', 16)} ${MAGENTA}${'█'.repeat(speedWidth)}${DIM}${'░'.repeat(40 - speedWidth)}${RESET} ${summary.averageSpeedup.toFixed(2)}x`,
    ...(policyMix ? [`${pad('policy mix', 16)} ${policyMix}`] : []),
    ...(classifierMix ? [`${pad('classifier mix', 16)} ${classifierMix}`] : []),
    '',
    `${BOLD}copy line${RESET}`,
    copy
  ].join('\n');
}

export function renderShareMarkdown(report) {
  const summary = report.aggregate;
  const accuracy = shareAccuracy(summary);
  const source = report.source === 'ledger' ? `from the local telemetry ledger${ledgerScope(report)}` : 'before any provider call';
  const policyMix = compactCounts(summary.policies ?? {});
  const policyText = policyMix ? ` Policy mix was ${policyMix}.` : '';
  const classifierMix = compactCounts(summary.classifierBackends ?? {});
  const classifierText = classifierMix ? ` Classifier mix was ${classifierMix}.` : '';
  const swapText = Number(summary.modelSwaps ?? 0) > 0 ? ` Model swaps were ${summary.modelSwaps}/${summary.count}.` : '';
  return [
    `proofroute routed ${summary.count} prompts ${source}, with ${ms(summary.p95RouterMs)} p95 decision time, ${percent(summary.p95RouterOverheadPct ?? 0)} p95 router overhead, ${money(summary.savingsUsd)} estimated savings, ${summary.averageSpeedup.toFixed(2)}x estimated speedup, and ${accuracy}.`,
    '',
    `The proof split ${summary.localRoutes}/${summary.count} routes to local models and ${summary.cloudRoutes}/${summary.count} routes to cloud models, which makes the model menu disappear without hiding the economics. Intent mix was ${compactCounts(summary.intents)}, and model mix was ${compactCounts(summary.models)}.${policyText}${classifierText}${swapText}`,
    '',
    `Copy line: ${shareCopyLine(summary, report)}`
  ].join('\n');
}

export function renderShareSvg(report) {
  const summary = report.aggregate;
  const ledger = report.source === 'ledger';
  const accuracy = shareAccuracy(summary);
  const accuracyValue = typeof summary.accuracy === 'number' ? pct(summary.accuracy) : 'unlabeled';
  const localRatio = summary.count ? summary.localRoutes / summary.count : 0;
  const cloudRatio = summary.count ? summary.cloudRoutes / summary.count : 0;
  const savingsRatio = Math.min(1, Math.max(0, summary.savingsPct));
  const speedRatio = Math.min(1, Math.max(0, summary.averageSpeedup / 4));
  const source = ledger ? `local telemetry proof${ledgerScope(report)}` : 'zero-network launch proof';
  const policyMix = compactCounts(summary.policies ?? {}) || 'none';
  const overheadText = `   overhead ${percent(summary.p95RouterOverheadPct ?? 0)}`;
  const swapText = Number(summary.modelSwaps ?? 0) > 0 ? `   swaps ${summary.modelSwaps}/${summary.count}` : '';
  const classifierMix = compactSvgText(compactCounts(summary.classifierBackends ?? {}) || 'none', 58);
  const intentMix = compactSvgText(compactCounts(summary.intents) || 'none', 80);
  const modelMix = compactSvgText(compactCounts(summary.models) || 'none', 80);
  const copy = compactSvgText(shareCopyLine(summary, report), 118);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720" role="img" aria-labelledby="title desc">',
    '<title id="title">ProofRoute shareable routing proof</title>',
    `<desc id="desc">ProofRoute routed ${summary.count} prompts with ${ms(summary.p95RouterMs)} p95 decision time and ${money(summary.savingsUsd)} savings.</desc>`,
    '<rect width="1200" height="720" rx="32" fill="#070a12"/>',
    '<rect x="34" y="34" width="1132" height="652" rx="28" fill="#0e1422" stroke="#263244" stroke-width="2"/>',
    '<rect x="64" y="64" width="1072" height="96" rx="20" fill="#111827"/>',
    '<text x="94" y="112" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="44" font-weight="800" letter-spacing="0">ProofRoute</text>',
    `<text x="94" y="144" fill="#8bd3ff" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" letter-spacing="0">${svgEscape(source)}</text>`,
    '<text x="930" y="105" fill="#22c55e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" text-anchor="end" letter-spacing="0">OpenAI-compatible proxy</text>',
    '<text x="930" y="134" fill="#eab308" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" text-anchor="end" letter-spacing="0">prompt-free proof</text>',
    svgMetricCard(74, 200, 'saved', money(summary.savingsUsd), '#22c55e'),
    svgMetricCard(330, 200, 'speed lift', `${summary.averageSpeedup.toFixed(2)}x`, '#d946ef'),
    svgMetricCard(586, 200, 'p95 router', ms(summary.p95RouterMs), '#eab308'),
    svgMetricCard(842, 200, 'accuracy', accuracyValue, '#38bdf8'),
    svgProgress('local routes', localRatio, `${summary.localRoutes}/${summary.count}`, 352, '#38bdf8'),
    svgProgress('cloud routes', cloudRatio, `${summary.cloudRoutes}/${summary.count}`, 414, '#d946ef'),
    svgProgress('money saved', savingsRatio, pct(savingsRatio), 476, '#22c55e'),
    svgProgress('speed lift', speedRatio, `${summary.averageSpeedup.toFixed(2)}x`, 538, '#eab308'),
    '<rect x="74" y="594" width="1052" height="58" rx="16" fill="#0b1020" stroke="#263244" stroke-width="1"/>',
    `<text x="98" y="620" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" letter-spacing="0">policy mix ${svgEscape(policyMix)}${svgEscape(swapText)}${svgEscape(overheadText)}   intent mix ${svgEscape(intentMix)}</text>`,
    `<text x="98" y="644" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" letter-spacing="0">model mix ${svgEscape(modelMix)}   classifier mix ${svgEscape(classifierMix)}</text>`,
    `<text x="74" y="684" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="17" letter-spacing="0">${svgEscape(copy)}</text>`,
    '</svg>'
  ].join('\n');
}

export function renderProofGate(report) {
  const passed = report.status === 'pass';
  const mark = passed ? 'PASS' : 'FAIL';
  const markColor = passed ? GREEN : MAGENTA;
  const source = report.source === 'ledger' ? `local telemetry proof${report.path ? ` from ${report.path}` : ''}${ledgerScope(report)}` : 'zero-network launch proof for CI, screenshots, and first-run trust';
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
    `${GREEN}${money(report.aggregate.savingsUsd)} saved${RESET}, ${MAGENTA}${report.aggregate.averageSpeedup.toFixed(2)}x${RESET} speedup, ${YELLOW}${ms(report.aggregate.p95RouterMs)}${RESET} p95 decision, ${YELLOW}${percent(report.aggregate.p95RouterOverheadPct ?? 0)}${RESET} router overhead, ${CYAN}${report.aggregate.count} requests${RESET}${accuracy === undefined ? '.' : `, ${CYAN}${pct(accuracy)}${RESET} intent accuracy.`}`,
    '',
    ...metricRows,
    '',
    `${pad('check', 21)} observed     gate`,
    ...rows
  ].join('\n');
}

export function renderConnect(report) {
  const clientEnv = report.clientEnv ?? report.env;
  const proxyEnv = report.proxyEnv ?? {};
  const proxyRows = Object.entries(proxyEnv).map(([key, value]) => `${pad(key, 34)} ${YELLOW}${value}${RESET}`);
  const proxyBlock = proxyRows.length > 0 ? [
    '',
    `${DIM}Proxy process exports let proofroute route to a local OpenAI-compatible gateway without a JSON catalog.${RESET}`,
    ...proxyRows
  ] : [];
  return [
    title('drop-in proxy'),
    `${BOLD}${report.baseUrl}${RESET} is the OpenAI-compatible base URL for SDKs, coding agents, editor extensions, and CLI tools.`,
    `${DIM}Start the proxy once, export these variables in the tool session, and existing clients can keep using their OpenAI-shaped calls while proofroute chooses the model.${RESET}`,
    '',
    `${pad('start proxy', 16)} ${report.commands.startProxy}`,
    `${pad('OPENAI_BASE_URL', 16)} ${GREEN}${clientEnv.OPENAI_BASE_URL}${RESET}`,
    `${pad('OPENAI_API_KEY', 16)} ${clientEnv.OPENAI_API_KEY}`,
    `${pad('OPENAI_API_BASE', 16)} ${clientEnv.OPENAI_API_BASE}`,
    ...proxyBlock,
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
  if (report.mode === 'proxy_matrix') return renderSmokeMatrix(report);
  const passed = report.status === 'pass';
  const mark = passed ? 'PASS' : 'FAIL';
  const markColor = passed ? GREEN : MAGENTA;
  const request = report.upstream.requests[0] ?? {};
  const mode = report.mode === 'proxy' ? 'transparent /v1/chat/completions proxy loop' : 'local Agent runtime loop';
  const rows = [
    `${pad('router', 16)} ${ms(report.routerDecisionMs)}`,
    `${pad('policy', 16)} ${report.decision.policy ?? report.response.headers?.policy ?? 'unknown'}`,
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
  if (report.response.headers?.requestedModel) rows.splice(7, 0, `${pad('model swap', 16)} ${report.response.headers.requestedModel}->${report.response.headers.model} ${report.response.headers.modelSwap ?? 'false'}`);
  if (report.response.headers?.runnerUp) rows.splice(7, 0, `${pad('runner-up', 16)} ${report.response.headers.runnerUp}`);
  if (report.response.headers?.contextUsePct) rows.splice(7, 0, `${pad('context use', 16)} ${percent(Number(report.response.headers.contextUsePct))} of ${compactTokens(Number(report.response.headers.contextWindow ?? 0))}`);
  if (report.response.headers?.estimatedCostUsd) rows.splice(7, 0, `${pad('route cost', 16)} ${money(Number(report.response.headers.estimatedCostUsd))} of ${money(Number(report.response.headers.baselineCostUsd ?? 0))} baseline`);
  if (report.response.headers?.speedup) rows.splice(7, 0, `${pad('speed proof', 16)} ${Number(report.response.headers.speedup).toFixed(2)}x, saved ${percent(Number(report.response.headers.savingsPct ?? 0))}`);
  if (report.response.headers?.routerOverheadPct) rows.splice(7, 0, `${pad('route overhead', 16)} ${percent(report.response.headers.routerOverheadPct)}`);
  if (report.response.headers?.usageSource) rows.splice(7, 0, `${pad('usage proof', 16)} ${report.response.headers.usageSource} ${report.response.headers.stream === 'true' ? 'stream' : 'buffer'} est:${report.response.headers.estimatedTokens ?? '0'}`);
  if (report.response.headers?.serverTiming) rows.splice(7, 0, `${pad('devtools timing', 16)} ${report.response.headers.serverTiming}`);
  if (report.response.headers?.classifierBackend) rows.splice(7, 0, `${pad('classifier', 16)} ${report.response.headers.classifierBackend} ${report.response.headers.classifierCircuit ?? 'closed'} failures:${report.response.headers.classifierFailures ?? '0'}`);
  if (report.response.headers?.actualTokens) rows.splice(7, 0, `${pad('actual tokens', 16)} ${report.response.headers.actualTokens}`);
  const proofSurface = report.cors?.exposeHeaders ? 'authorization, browser-readable proof headers, and response parsing' : 'authorization, headers, and response parsing';
  return [
    title('proxy smoke'),
    `${BOLD}${markColor}${mark}${RESET} ${DIM}${mode} proved routing, OpenAI-compatible forwarding, ${proofSurface} without external network.${RESET}`,
    `${BOLD}${report.decision.model.id}${RESET} won for ${CYAN}${report.decision.intent.name}${RESET} under ${CYAN}${report.decision.policy ?? 'unknown'}${RESET} policy, hit upstream model ${CYAN}${request.model ?? 'none'}${RESET}, and returned ${YELLOW}${report.response.status}${RESET}.`,
    '',
    ...rows
  ].join('\n');
}

function renderSmokeMatrix(report) {
  const passed = report.status === 'pass';
  const mark = passed ? 'PASS' : 'FAIL';
  const markColor = passed ? GREEN : MAGENTA;
  const browserProof = report.cors?.exposeHeaders?.includes('x-proofroute-model') ? 'readable' : 'hidden';
  const ledgerProof = report.ledger?.promptFree ? 'prompt-free' : 'needs audit';
  const privacy = report.ledger?.privacy;
  const privacyProof = privacy ? `privacy ${privacy.status}, forbidden ${privacy.forbiddenMatchCount}, parse ${privacy.parseErrorCount}` : 'privacy unchecked';
  const rows = (report.scenarios ?? []).map((scenario) => {
    const state = scenario.passed ? `${GREEN}pass${RESET}` : `${MAGENTA}fail${RESET}`;
    const route = `${scenario.requestedModel}->${scenario.model}`;
    const rejected = scenario.rejectedReasons?.length ? scenario.rejectedReasons.join(',') : 'none';
    return `${state} ${pad(scenario.id, 16)} ${pad(scenario.proof, 8)} ${pad(route, 34)} ${pad(scenario.intent, 13)} ${pad(money(scenario.routeCostUsd), 10)} ${pad(`${scenario.speedup.toFixed(2)}x`, 7)} ${rejected}`;
  });
  return [
    title('proxy matrix'),
    `${BOLD}${markColor}${mark}${RESET} ${DIM}same OpenAI-compatible proxy origin proved intent, context, and cost routing without external network.${RESET}`,
    `${BOLD}${report.aggregate.passed}/${report.aggregate.count} scenarios${RESET} passed through ${CYAN}${report.proxy?.origin ?? 'unknown proxy'}${RESET}, with ${GREEN}${money(report.aggregate.savingsUsd)} saved${RESET}, ${MAGENTA}${report.aggregate.averageSpeedup.toFixed(2)}x${RESET} average speedup, and ${YELLOW}${ms(report.aggregate.p95RouterMs)}${RESET} p95 router.`,
    '',
    `${pad('browser proof', 16)} ${browserProof}`,
    `${pad('ledger proof', 16)} ${ledgerProof} ${report.ledger?.events ?? 0} events, ${privacyProof}`,
    `${pad('model swaps', 16)} ${report.aggregate.modelSwaps}/${report.aggregate.count}`,
    `proof mix ${compactCounts(report.aggregate.proofs) || 'none'}`,
    `intent mix ${compactCounts(report.aggregate.intents) || 'none'}`,
    `model mix ${compactCounts(report.aggregate.models) || 'none'}`,
    '',
    `${pad('state', 5)} ${pad('case', 16)} ${pad('proof', 8)} ${pad('route', 34)} ${pad('intent', 13)} ${pad('cost', 10)} speed   rejected`,
    ...rows
  ].join('\n');
}

export function renderDecision(decision) {
  const tradeoffs = renderCandidateTradeoffs(decision);
  return [
    title('route decision'),
    `${BOLD}${decision.model.id}${RESET} via ${decision.model.provider} for ${CYAN}${decision.intent.name}${RESET} under ${CYAN}${decision.policy ?? 'balanced'}${RESET} policy at ${pct(decision.confidence)} confidence`,
    `${DIM}${decision.inputTokens} input tokens, ${decision.outputTokens} planned output tokens, fallback ${decision.fallback.model}, cache ${decision.cache?.hit ? 'hit' : 'miss'}${RESET}`,
    '',
    routeReceipt(decision),
    '',
    ...tradeoffs,
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

export function renderIntentTraining(report) {
  const delta = report.after.accuracy - report.before.accuracy;
  const accuracyWidth = Math.min(40, Math.max(3, Math.round(Math.max(0, Math.min(1, report.after.accuracy)) * 40)));
  const onnx = report.onnxOut ? report.onnxOut : 'not requested';
  return [
    title('intent learning'),
    `${BOLD}${report.samples.count} labeled samples${RESET} trained for ${CYAN}${report.epochs} epochs${RESET} at learning rate ${YELLOW}${report.learningRate}${RESET}.`,
    `${GREEN}${pct(report.before.accuracy)} -> ${pct(report.after.accuracy)} accuracy${RESET}, delta ${signed(delta)}, correct ${report.training.correctBefore}/${report.samples.count} -> ${report.training.correctAfter}/${report.samples.count}.`,
    '',
    `${pad('accuracy', 16)} ${GREEN}${'█'.repeat(accuracyWidth)}${DIM}${'░'.repeat(40 - accuracyWidth)}${RESET} ${pct(report.after.accuracy)}`,
    `${pad('labels', 16)} ${compactCounts(report.samples.labels)}`,
    `${pad('json artifact', 16)} ${report.outPath}`,
    `${pad('onnx artifact', 16)} ${onnx}`,
    `${DIM}Source samples ${report.samplesPath} against base model ${report.modelPath}; accepted labels are intent, expectedIntent, or label.${RESET}`
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
  const live = report.watch ? `, live tick ${report.watch.tick} at ${compactTime(report.watch.generatedAt)} with ${report.watch.intervalMs}ms refresh` : '';
  const localRatio = summary.count ? summary.local / summary.count : 0;
  const streamRatio = summary.count ? summary.streaming / summary.count : 0;
  const cacheRatio = summary.count ? summary.cacheHits / summary.count : 0;
  const fallbackRatio = summary.count ? summary.fallbacks / summary.count : 0;
  const modelSwapRatio = summary.count ? (summary.modelSwaps ?? 0) / summary.count : 0;
  const classifierCircuitRatio = summary.count ? (summary.classifierCircuitOpen ?? 0) / summary.count : 0;
  const overheadRatio = Math.min(1, Math.max(0, (summary.p95RouterOverheadPct ?? 0) / 1));
  const recentRows = (report.recent ?? []).map((route) => {
    const place = route.local ? 'local' : 'cloud';
    const tokens = route.actualTotalTokens > 0 ? String(route.actualTotalTokens) : 'est';
    const routed = route.modelSwap && route.requestedModel ? `${compactText(route.requestedModel, 14)}->${compactText(route.model, 14)}` : route.model;
    const runnerUp = route.runnerUpModel ? `runner-up:${compactText(route.runnerUpModel, 14)}` : '';
    const rejected = route.rejectedCount > 0 ? `rejected:${route.rejectedReasons || route.rejectedCount}` : '';
    const flags = [route.modelSwap ? 'model-swap' : '', route.stream ? 'stream' : '', route.fallbackUsed ? 'fallback' : '', route.classifierCircuitOpen ? 'classifier-circuit' : '', runnerUp, rejected].filter(Boolean).join(',');
    const context = route.contextWindow > 0 ? percent(route.contextUsePct) : 'n/a';
    return `${pad(compactTime(route.ts), 10)} ${pad(routed, 29)} ${pad(route.policy, 8)} ${pad(route.intent, 13)} ${pad(place, 6)} ${pad(route.classifierBackend, 16)} ${pad(context, 8)} ${pad(money(route.savingsUsd), 10)} ${pad(tokens, 6)} ${pad(ms(route.routerLatencyMs), 10)} ${pad(String(route.status), 6)} ${flags}`;
  });
  const recentBlock = recentRows.length > 0 ? [
    '',
    `${BOLD}latest routes${RESET}`,
    `${pad('time', 10)} ${pad('route', 29)} ${pad('policy', 8)} ${pad('intent', 13)} ${pad('place', 6)} ${pad('classifier', 16)} ${pad('context', 8)} ${pad('saved', 10)} ${pad('tokens', 6)} ${pad('router', 10)} status flags`,
    ...recentRows
  ] : [];
  const costRows = summary.meteredRequests > 0 ? [
    `${pad('actual cost', 16)} ${money(summary.actualCostUsd)} from ${summary.meteredRequests}/${summary.count} metered responses`,
    `${pad('actual tokens', 16)} ${summary.actualTotalTokens} total, ${summary.actualInputTokens} in, ${summary.actualOutputTokens} out`,
    `${pad('est cost', 16)} ${money(summary.estimatedCostUsd)}`
  ] : [
    `${pad('cost routed', 16)} ${money(summary.estimatedCostUsd)}`
  ];
  const ledgerErrors = report.ledger?.errors ?? [];
  const ledgerGuard = report.ledger?.errorCount > 0 ? [
    '',
    `${YELLOW}ledger parse guard${RESET} skipped ${report.ledger.errorCount} malformed JSONL records from ${report.ledger.records} ledger records; run proofroute privacy --file ${report.path} before sharing or proving this ledger.`,
    ...ledgerErrors.map((error) => `${MAGENTA}jsonl${RESET} ${pad(`line ${error.line}`, 10)} ${error.message}`)
  ] : [];
  return [
    title('routing ledger'),
    `${BOLD}${summary.count} requests${RESET} recorded at ${DIM}${report.path}${RESET}${ledgerScope(report)}${live}.`,
    `${GREEN}${money(summary.savingsUsd)} saved${RESET} with ${MAGENTA}${summary.averageSpeedup.toFixed(2)}x${RESET} average estimated speedup, p95 decision ${YELLOW}${ms(summary.p95RouterMs)}${RESET}, and p95 overhead ${YELLOW}${percent(summary.p95RouterOverheadPct ?? 0)}${RESET}.`,
    '',
    `${pad('local mix', 16)} ${bar(localRatio, 40)} ${summary.local}/${summary.count}`,
    `${pad('streaming', 16)} ${bar(streamRatio, 40)} ${summary.streaming}/${summary.count}`,
    `${pad('cache hits', 16)} ${bar(cacheRatio, 40)} ${summary.cacheHits}/${summary.count}`,
    `${pad('fallbacks', 16)} ${bar(fallbackRatio, 40)} ${summary.fallbacks}/${summary.count}`,
    `${pad('model swaps', 16)} ${bar(modelSwapRatio, 40)} ${summary.modelSwaps ?? 0}/${summary.count}`,
    `${pad('router overhead', 16)} ${bar(overheadRatio, 40)} ${percent(summary.p95RouterOverheadPct ?? 0)}`,
    `${pad('classifier guard', 16)} ${bar(classifierCircuitRatio, 40)} ${summary.classifierCircuitOpen ?? 0}/${summary.count}`,
    ...costRows,
    `${pad('p95 end to end', 16)} ${ms(summary.p95EndToEndMs)}`,
    `${pad('p95 upstream', 16)} ${ms(summary.p95EstimatedLatencyMs)}`,
    '',
    `intent mix ${compactCounts(summary.intents) || 'none'}`,
    `policy mix ${compactCounts(summary.policies) || 'none'}`,
    `requested mix ${compactCounts(summary.requestedModels) || 'none'}`,
    `classifier mix ${compactCounts(summary.classifierBackends) || 'none'}`,
    `model mix ${compactCounts(summary.models) || 'none'}`,
    `provider mix ${compactCounts(summary.providers) || 'none'}`,
    `status mix ${compactCounts(summary.statuses) || 'none'}`,
    ...ledgerGuard,
    ...recentBlock
  ].join('\n');
}

export function renderPrivacy(report) {
  const passed = report.status === 'pass';
  const mark = passed ? 'PASS' : 'FAIL';
  const markColor = passed ? GREEN : MAGENTA;
  const fieldState = report.forbiddenMatchCount === 0 ? `${GREEN}clean${RESET}` : `${MAGENTA}blocked${RESET}`;
  const jsonState = report.parseErrorCount === 0 ? `${GREEN}clean${RESET}` : `${MAGENTA}blocked${RESET}`;
  const matchRows = (report.forbiddenMatches ?? []).slice(0, 8).map((match) => {
    return `${MAGENTA}field${RESET} ${pad(`line ${match.line}`, 10)} ${pad(match.key, 18)} ${match.path}`;
  });
  const parseRows = (report.parseErrors ?? []).slice(0, 8).map((error) => {
    return `${MAGENTA}jsonl${RESET} ${pad(`line ${error.line}`, 10)} ${error.message}`;
  });
  const issueBlock = matchRows.length || parseRows.length ? [
    '',
    `${BOLD}blocked evidence${RESET}`,
    ...matchRows,
    ...parseRows
  ] : [];
  const allowed = compactText((report.allowedEvidenceKeys ?? []).join(', '), 132);
  return [
    title('privacy proof'),
    `${BOLD}${markColor}${mark}${RESET} ${DIM}${report.message}${RESET}`,
    `${BOLD}${report.events} events${RESET} scanned at ${DIM}${report.path}${RESET}, ${report.bytes} bytes, ${report.scannedKeys} keys, and ${report.uniqueKeyCount} unique key names.`,
    '',
    `${pad('field audit', 16)} ${fieldState} ${report.forbiddenMatchCount} forbidden key matches`,
    `${pad('jsonl audit', 16)} ${jsonState} ${report.parseErrorCount} parse errors`,
    `${pad('ledger exists', 16)} ${report.exists ? 'yes' : 'no'}`,
    `${pad('allowed keys', 16)} ${allowed}`,
    ...issueBlock
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
  const warmupLine = report.warmup ? `${GREEN}warmup ${report.warmup.status}${RESET}, warmed ${metrics.warmed ? 'yes' : 'no'}, ${report.warmup.count} prompts through ${report.warmup.backend} in ${YELLOW}${ms(report.warmup.elapsedMs)}${RESET}.` : `warmed ${metrics.warmed ? 'yes' : 'no'}, warmups ${metrics.warmups ?? 0}, last warmup ${ms(metrics.lastWarmupMs ?? 0)}.`;
  const profileLine = deviceProfileLine(metrics.deviceProfiles);
  const maxRequests = Math.max(1, ...metrics.laneMetrics.map((lane) => lane.requests));
  const rows = metrics.laneMetrics.map((lane) => {
    const device = lane.device === undefined ? 'none' : lane.device;
    const errorText = lane.errors > 0 ? `${MAGENTA}${lane.errors}${RESET}` : `${GREEN}${lane.errors}${RESET}`;
    return `${pad(`lane ${lane.lane}`, 8)} ${pad(`gpu ${device}`, 8)} ${bar(lane.requests / maxRequests, 26)} ${pad(`${lane.requests} req`, 8)} ${pad(`${errorText} err`, 15)} avg ${ms(lane.averageDecisionMs)} max ${ms(lane.maxDecisionMs)} peak ${lane.peakInflight}`;
  });
  return [
    title('classifier accelerator'),
    `${BOLD}${metrics.backend}${RESET} sidecar at ${DIM}${report.url}${RESET} answered in ${YELLOW}${ms(report.elapsedMs)}${RESET}.`,
    `${GREEN}${metrics.requests} classifications${RESET}, ${metrics.errors > 0 ? MAGENTA : GREEN}${metrics.errors} errors${RESET}, ${CYAN}${metrics.lanes} lanes${RESET}, scheduler ${CYAN}${metrics.scheduler ?? 'unknown'}${RESET}, microbatches ${CYAN}${metrics.microBatches ?? 0}${RESET}, avg batch ${(metrics.averageBatchSize ?? 0).toFixed(2)}, max batch ${metrics.maxObservedBatchSize ?? 0}, devices ${metrics.devices.length ? metrics.devices.join(',') : 'none'}, inflight ${metrics.inflight}, uptime ${ms(metrics.uptimeMs)}.`,
    warmupLine,
    ...(profileLine ? [profileLine] : []),
    '',
    ...rows
  ].join('\n');
}

export function renderClassifierBenchmark(report) {
  const aggregate = report.aggregate;
  const passed = report.status !== 'fail';
  const mark = passed ? `${GREEN}PASS${RESET}` : `${MAGENTA}FAIL${RESET}`;
  const accuracy = typeof aggregate.accuracy === 'number' ? pct(aggregate.accuracy) : 'unlabeled';
  const latencyRatio = normalizeLatency(aggregate.p95DecisionMs);
  const throughputRatio = Math.min(1, aggregate.throughputPerSecond / 5000);
  const checkRows = (report.checks ?? []).map((check) => {
    const status = check.pass ? `${GREEN}pass${RESET}` : `${MAGENTA}fail${RESET}`;
    const comparator = check.direction === 'max' ? '<=' : '>=';
    return `${status} ${pad(check.label, 16)} ${pad(proofValue(check.value, check.unit), 12)} ${comparator} ${proofValue(check.target, check.unit)}`;
  });
  const checkBlock = checkRows.length > 0 ? [
    '',
    `${pad('check', 21)} observed     gate`,
    ...checkRows
  ] : [];
  const warmupBlock = report.warmup ? [classifierWarmupLine(report.warmup)] : [];
  const evidenceBlock = report.evidence ? [classifierEvidenceLine(report.evidence)] : [];
  const rows = report.rows.slice(0, 8).map((row) => {
    const mark = row.matched === undefined ? `${DIM}seen${RESET}` : row.matched ? `${GREEN}hit ${RESET}` : `${YELLOW}miss${RESET}`;
    const lane = row.lane === undefined ? 'none' : row.lane;
    const device = row.device === undefined ? 'none' : row.device;
    return `${mark} ${pad(row.id, 14)} ${pad(row.actualIntent, 13)} ${pad(row.backend, 16)} ${pad(`lane ${lane}`, 9)} ${pad(`gpu ${device}`, 9)} ${pct(row.confidence)}`;
  });
  return [
    title('classifier proof'),
    `${BOLD}${mark}${RESET} ${BOLD}${report.count} prompts${RESET} classified through ${CYAN}${report.mode}${RESET} in ${YELLOW}${ms(report.elapsedMs)}${RESET}, with p95 decision ${YELLOW}${ms(aggregate.p95DecisionMs)}${RESET}, ${MAGENTA}${aggregate.throughputPerSecond.toFixed(1)} prompts/s${RESET}, ${CYAN}${(aggregate.averageBatchSize ?? 1).toFixed(2)}${RESET} average batch size, ${CYAN}${aggregate.deviceCount ?? 0}${RESET} devices, ${CYAN}${aggregate.laneCount ?? 0}${RESET} lanes, and ${CYAN}${aggregate.hardwareProbeProfileCount ?? 0}${RESET} nvidia-smi profiles.`,
    `${GREEN}${accuracy}${RESET} labeled accuracy across ${aggregate.labeled}/${report.count} labeled classifications, ${aggregate.samples} unique samples, ${report.runs} runs.`,
    ...warmupBlock,
    ...evidenceBlock,
    '',
    `${pad('p95 decision', 16)} ${bar(latencyRatio, 40)} ${ms(aggregate.p95DecisionMs)}`,
    `${pad('throughput', 16)} ${bar(throughputRatio, 40)} ${aggregate.throughputPerSecond.toFixed(1)}/s`,
    ...checkBlock,
    '',
    `${pad('status', 5)} ${pad('sample', 14)} ${pad('intent', 13)} ${pad('backend', 16)} ${pad('lane', 9)} ${pad('device', 9)} confidence`,
    ...rows,
    '',
    `backend mix ${compactCounts(aggregate.backends) || 'none'}   batch mix ${compactCounts(aggregate.batchModes ?? {}) || 'none'}   lane mix ${compactCounts(aggregate.lanes) || 'none'}   device mix ${compactCounts(aggregate.devices) || 'none'}`
  ].join('\n');
}

export function renderClassifierEvidenceVerification(report) {
  const passed = report.status === 'pass';
  const mark = passed ? `${GREEN}PASS${RESET}` : `${MAGENTA}FAIL${RESET}`;
  const rows = (report.checks ?? []).map((check) => {
    const status = check.pass ? `${GREEN}pass${RESET}` : `${MAGENTA}fail${RESET}`;
    return `${status} ${pad(check.id, 18)} ${check.message}`;
  });
  const artifacts = (report.artifacts ?? []).slice(0, 4).map((artifact) => {
    const hash = artifact.sha256 ? `${artifact.sha256.slice(0, 12)}...` : artifact.status;
    return `${pad(artifact.env ?? 'artifact', 30)} ${pad(artifact.status ?? 'unknown', 8)} ${hash} ${artifact.path ?? ''}`;
  });
  return [
    title('classifier evidence verify'),
    `${BOLD}${mark}${RESET} ${DIM}${report.path ?? 'classifier evidence'}${RESET} checked against local artifact files.`,
    `${CYAN}${(report.checks ?? []).filter((check) => check.pass).length}/${(report.checks ?? []).length}${RESET} checks passed for ${DIM}${report.evidenceKind ?? 'unknown evidence'}${RESET}.`,
    '',
    ...rows,
    ...(artifacts.length ? ['', `${pad('artifact', 30)} ${pad('status', 8)} hash         path`, ...artifacts] : [])
  ].join('\n');
}

export function renderClassifierSvg(report) {
  if (report.aggregate) return renderClassifierBenchmarkSvg(report);
  return renderClassifierMetricsSvg(report);
}

function renderClassifierMetricsSvg(report) {
  if (report.status !== 'pass') return renderClassifierStatusSvg(report);
  const metrics = report.metrics;
  const profileSummary = compactSvgText(deviceProfileSummary(metrics.deviceProfiles) || `devices ${metrics.devices?.length ? metrics.devices.join(',') : 'none'}`, 104);
  const maxRequests = Math.max(1, ...metrics.laneMetrics.map((lane) => lane.requests));
  const lanes = metrics.laneMetrics.slice(0, 4);
  const laneRows = lanes.flatMap((lane, index) => {
    const y = 392 + index * 52;
    const device = lane.device === undefined ? 'none' : lane.device;
    const label = `lane ${lane.lane} worker ${device}`;
    const value = `${lane.requests} req avg ${ms(lane.averageDecisionMs)}`;
    return svgProgress(label, lane.requests / maxRequests, value, y, index % 2 === 0 ? '#38bdf8' : '#d946ef').split('\n');
  });
  const warmup = metrics.warmed ? 'warmed' : 'cold';
  const copy = compactSvgText(`ProofRoute classifier ${metrics.backend} handled ${metrics.requests} prompt-free classifications across ${metrics.lanes} lanes with ${metrics.microBatches ?? 0} microbatches; hardware claim none.`, 118);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720" role="img" aria-labelledby="title desc">',
    '<title id="title">ProofRoute classifier accelerator proof</title>',
    `<desc id="desc">ProofRoute classifier sidecar ${metrics.backend} reported ${metrics.requests} classifications across ${metrics.lanes} lanes with hardware claim none.</desc>`,
    '<rect width="1200" height="720" rx="32" fill="#070a12"/>',
    '<rect x="34" y="34" width="1132" height="652" rx="28" fill="#0e1422" stroke="#263244" stroke-width="2"/>',
    '<rect x="64" y="64" width="1072" height="96" rx="20" fill="#111827"/>',
    '<text x="94" y="112" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="42" font-weight="800" letter-spacing="0">ProofRoute Classifier</text>',
    '<text x="94" y="144" fill="#8bd3ff" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" letter-spacing="0">prompt-free accelerator receipt</text>',
    '<text x="930" y="105" fill="#22c55e" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" text-anchor="end" letter-spacing="0">HTTP sidecar</text>',
    '<text x="930" y="134" fill="#eab308" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" text-anchor="end" letter-spacing="0">hardware claim none</text>',
    svgMetricCard(74, 200, 'backend', compactSvgText(metrics.backend, 16), '#38bdf8'),
    svgMetricCard(330, 200, 'lanes', String(metrics.lanes), '#d946ef'),
    svgMetricCard(586, 200, 'requests', String(metrics.requests), '#22c55e'),
    svgMetricCard(842, 200, 'warmup', warmup, metrics.warmed ? '#22c55e' : '#eab308'),
    svgProgress('microbatches', Math.min(1, (metrics.microBatches ?? 0) / Math.max(1, metrics.batches || 1)), `${metrics.microBatches ?? 0}/${metrics.batches ?? 0}`, 340, '#eab308'),
    ...laneRows,
    '<rect x="74" y="614" width="1052" height="38" rx="14" fill="#0b1020" stroke="#263244" stroke-width="1"/>',
    `<text x="98" y="639" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" letter-spacing="0">${svgEscape(profileSummary)}</text>`,
    `<text x="74" y="684" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="17" letter-spacing="0">${svgEscape(copy)}</text>`,
    '</svg>'
  ].join('\n');
}

function renderClassifierBenchmarkSvg(report) {
  const aggregate = report.aggregate;
  const passed = report.status !== 'fail';
  const accuracy = typeof aggregate.accuracy === 'number' ? pct(aggregate.accuracy) : 'unlabeled';
  const latencyRatio = normalizeLatency(aggregate.p95DecisionMs);
  const throughputRatio = Math.min(1, aggregate.throughputPerSecond / 5000);
  const backendMix = compactSvgText(compactCounts(aggregate.backends) || 'none', 78);
  const deviceMix = compactSvgText(compactCounts(aggregate.devices) || 'none', 78);
  const batchMix = compactSvgText(compactCounts(aggregate.batchModes ?? {}) || 'none', 78);
  const warmup = report.warmup?.status === 'pass' ? `warmup pass ${report.warmup.count} prompts` : report.warmup ? `warmup ${report.warmup.status}` : 'warmup not requested';
  const evidence = report.evidence ? `   artifacts ${hashedArtifactCount(report.evidence)}` : '';
  const copy = compactSvgText(`ProofRoute classifier ${passed ? 'passed' : 'failed'}: ${ms(aggregate.p95DecisionMs)} p95, ${aggregate.throughputPerSecond.toFixed(1)} prompts/s, ${aggregate.laneCount ?? 0} lanes; hardware claim none.`, 118);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720" role="img" aria-labelledby="title desc">',
    '<title id="title">ProofRoute classifier benchmark proof</title>',
    `<desc id="desc">ProofRoute classifier benchmark ${report.status} with ${ms(aggregate.p95DecisionMs)} p95 decision latency, ${aggregate.throughputPerSecond.toFixed(1)} prompts per second, and hardware claim none.</desc>`,
    '<rect width="1200" height="720" rx="32" fill="#070a12"/>',
    '<rect x="34" y="34" width="1132" height="652" rx="28" fill="#0e1422" stroke="#263244" stroke-width="2"/>',
    '<rect x="64" y="64" width="1072" height="96" rx="20" fill="#111827"/>',
    '<text x="94" y="112" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="42" font-weight="800" letter-spacing="0">ProofRoute Classifier</text>',
    `<text x="94" y="144" fill="#8bd3ff" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" letter-spacing="0">${svgEscape(report.mode)} benchmark receipt</text>`,
    `<text x="930" y="105" fill="${passed ? '#22c55e' : '#d946ef'}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" text-anchor="end" font-weight="800" letter-spacing="0">${passed ? 'PASS' : 'FAIL'}</text>`,
    `<text x="930" y="134" fill="#eab308" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" text-anchor="end" letter-spacing="0">hardware claim none</text>`,
    svgMetricCard(74, 200, 'p95 decision', ms(aggregate.p95DecisionMs), '#eab308'),
    svgMetricCard(330, 200, 'throughput', `${aggregate.throughputPerSecond.toFixed(1)}/s`, '#d946ef'),
    svgMetricCard(586, 200, 'accuracy', accuracy, '#38bdf8'),
    svgMetricCard(842, 200, 'avg batch', (aggregate.averageBatchSize ?? 1).toFixed(2), '#22c55e'),
    svgProgress('p95 decision', latencyRatio, ms(aggregate.p95DecisionMs), 352, '#eab308'),
    svgProgress('throughput', throughputRatio, `${aggregate.throughputPerSecond.toFixed(1)}/s`, 414, '#d946ef'),
    svgProgress('labeled accuracy', typeof aggregate.accuracy === 'number' ? aggregate.accuracy : 0, accuracy, 476, '#38bdf8'),
    svgProgress('average batch', Math.min(1, (aggregate.averageBatchSize ?? 1) / 16), (aggregate.averageBatchSize ?? 1).toFixed(2), 538, '#22c55e'),
    '<rect x="74" y="594" width="1052" height="58" rx="16" fill="#0b1020" stroke="#263244" stroke-width="1"/>',
    `<text x="98" y="620" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" letter-spacing="0">backend mix ${svgEscape(backendMix)}   lane mix ${svgEscape(deviceMix)}</text>`,
    `<text x="98" y="644" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" letter-spacing="0">batch mix ${svgEscape(batchMix)}   lanes ${aggregate.laneCount ?? 0}   declared profiles ${aggregate.deviceProfileCount ?? 0}   hardware claim none${svgEscape(evidence)}</text>`,
    `<text x="74" y="684" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="17" letter-spacing="0">${svgEscape(copy)}</text>`,
    '</svg>'
  ].join('\n');
}

function renderClassifierStatusSvg(report) {
  const message = compactSvgText(report.message ?? 'No classifier sidecar proof is available yet.', 94);
  const mode = report.mode ?? 'unknown';
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720" role="img" aria-labelledby="title desc">',
    '<title id="title">ProofRoute classifier status</title>',
    `<desc id="desc">ProofRoute classifier status ${report.status ?? 'unknown'} in ${mode} mode.</desc>`,
    '<rect width="1200" height="720" rx="32" fill="#070a12"/>',
    '<rect x="34" y="34" width="1132" height="652" rx="28" fill="#0e1422" stroke="#263244" stroke-width="2"/>',
    '<text x="94" y="136" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="44" font-weight="800" letter-spacing="0">ProofRoute Classifier</text>',
    `<text x="94" y="192" fill="#eab308" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="24" letter-spacing="0">${svgEscape(String(report.status ?? 'warn').toUpperCase())} ${svgEscape(mode)}</text>`,
    `<text x="94" y="256" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="20" letter-spacing="0">${svgEscape(message)}</text>`,
    '<text x="94" y="642" fill="#8bd3ff" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" letter-spacing="0">Start proofroute-classifier or configure PROOFROUTE_CLASSIFIER_URL to capture accelerator proof.</text>',
    '</svg>'
  ].join('\n');
}

function classifierWarmupLine(warmup) {
  const mark = warmup.status === 'pass' ? `${GREEN}warmup pass${RESET}` : warmup.status === 'skip' ? `${YELLOW}warmup skip${RESET}` : `${MAGENTA}warmup fail${RESET}`;
  if (warmup.status === 'pass') {
    return `${mark}, ${warmup.count} prompts through ${warmup.backend} in ${YELLOW}${ms(warmup.elapsedMs)}${RESET} before benchmark.`;
  }
  return `${mark}, ${DIM}${warmup.message ?? 'No sidecar warmup evidence was recorded.'}${RESET}`;
}

function classifierEvidenceLine(evidence) {
  const gatesPass = Array.isArray(evidence.gates) && evidence.gates.length ? evidence.gates.every((gate) => gate.pass) : undefined;
  const gateText = gatesPass === undefined ? `${YELLOW}ungated${RESET}` : gatesPass ? `${GREEN}gates pass${RESET}` : `${MAGENTA}gates fail${RESET}`;
  return `${BOLD}evidence${RESET} ${DIM}${evidence.kind ?? 'proofroute-classifier-evidence'}${RESET}, ${CYAN}${hashedArtifactCount(evidence)}${RESET} artifacts hashed, ${CYAN}${evidence.benchmark?.deviceCount ?? 0}${RESET} devices, ${CYAN}${evidence.benchmark?.laneCount ?? 0}${RESET} lanes, ${gateText}.`;
}

function hashedArtifactCount(evidence) {
  return Array.isArray(evidence.artifacts) ? evidence.artifacts.filter((artifact) => artifact.status === 'hashed').length : 0;
}

function deviceProfileLine(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) return '';
  const informative = profiles.filter((profile) => profile && (profile.name || profile.memoryMb !== undefined || profile.runtime || profile.driver));
  if (informative.length === 0) return '';
  return `device profiles ${informative.map(formatDeviceProfile).join('   ')}`;
}

function deviceProfileSummary(profiles) {
  if (!Array.isArray(profiles) || profiles.length === 0) return '';
  const informative = profiles.filter((profile) => profile && (profile.name || profile.memoryMb !== undefined || profile.runtime || profile.driver));
  if (informative.length === 0) return '';
  return informative.map(formatDeviceProfile).join('   ');
}

function formatDeviceProfile(profile) {
  const parts = [profile.id ?? 'unknown'];
  if (profile.name) parts.push(profile.name);
  if (profile.memoryMb !== undefined) parts.push(`${profile.memoryMb}MB`);
  if (profile.runtime) parts.push(profile.runtime);
  if (profile.driver) parts.push(`driver ${profile.driver}`);
  if (profile.source) parts.push(`source ${profile.source}`);
  return parts.join(' ');
}

export function renderTune(report) {
  const summary = report.summary;
  const changed = report.currentPolicy !== report.recommendedPolicy;
  const patch = JSON.stringify(report.routerPatch);
  const classifierPatch = report.classifierPatch && Object.keys(report.classifierPatch).length > 0 ? JSON.stringify(report.classifierPatch) : 'not needed';
  return [
    title('tuning signal'),
    `${BOLD}${summary.count} events${RESET} from ${DIM}${report.path}${RESET}${ledgerScope(report)} produce ${pct(report.confidence)} recommendation confidence.`,
    `${changed ? YELLOW : GREEN}${report.currentPolicy} -> ${report.recommendedPolicy}${RESET} with ${GREEN}${money(summary.savingsUsd)} saved${RESET}, ${MAGENTA}${summary.averageSpeedup.toFixed(2)}x${RESET} speedup, and p95 decision ${YELLOW}${ms(summary.p95RouterMs)}${RESET}.`,
    '',
    `${pad('router patch', 16)} ${patch}`,
    `${pad('classifier patch', 16)} ${classifierPatch}`,
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

function compactTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || 'unknown').slice(0, 10);
  return date.toISOString().slice(11, 19);
}

function ledgerScope(report) {
  if (!report.window) return '';
  return ` since ${report.window.since} (${report.window.matched}/${report.window.total} ledger events)`;
}

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function percent(value) {
  return `${Number(value ?? 0).toFixed(2)}%`;
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
  if (unit === 'percent') return percent(value);
  if (unit === 'per_second') return `${value.toFixed(1)}/s`;
  if (unit === 'count') return String(value);
  return String(value);
}

function shareCopyLine(summary, report) {
  const source = typeof report === 'string' ? report : report.source;
  const suffix = source === 'ledger' ? `from my private local routing ledger${typeof report === 'string' ? '' : ledgerScope(report)}` : 'before any provider call';
  return `I routed ${summary.count} prompts with proofroute in ${ms(summary.p95RouterMs)} p95 decision time, saved ${money(summary.savingsUsd)}, and got ${summary.averageSpeedup.toFixed(2)}x estimated speedup ${suffix}.`;
}

function shareAccuracy(summary) {
  return typeof summary.accuracy === 'number' ? `${pct(summary.accuracy)} labeled intent accuracy` : 'unlabeled intent mix';
}

function signed(value = 0) {
  const number = Number.isFinite(value) ? value : 0;
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
}

function signedPct(value = 0) {
  const number = Number.isFinite(value) ? value : 0;
  return `${number >= 0 ? '+' : ''}${pct(number)}`;
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

function compactSvgText(value, width) {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= width) return text;
  return `${text.slice(0, Math.max(0, width - 3))}...`;
}

function svgMetricCard(x, y, label, value, color) {
  return [
    `<rect x="${x}" y="${y}" width="220" height="96" rx="18" fill="#0b1020" stroke="#263244" stroke-width="1"/>`,
    `<text x="${x + 24}" y="${y + 36}" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" letter-spacing="0">${svgEscape(label)}</text>`,
    `<text x="${x + 24}" y="${y + 72}" fill="${color}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="25" font-weight="800" letter-spacing="0">${svgEscape(value)}</text>`
  ].join('\n');
}

function svgProgress(label, ratio, value, y, color) {
  const width = 810;
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
  return [
    `<text x="74" y="${y}" fill="#cbd5e1" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" letter-spacing="0">${svgEscape(label)}</text>`,
    `<rect x="238" y="${y - 18}" width="${width}" height="22" rx="11" fill="#1f2937"/>`,
    `<rect x="238" y="${y - 18}" width="${filled}" height="22" rx="11" fill="${color}"/>`,
    `<text x="1074" y="${y}" fill="#f8fafc" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" text-anchor="end" letter-spacing="0">${svgEscape(value)}</text>`
  ].join('\n');
}

function svgEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
