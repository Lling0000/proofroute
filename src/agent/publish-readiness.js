import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { redactSupportDocument, redactSupportText, redactSupportValue } from '../redaction.js';
import { publicRepositoryFaceReport, repositoryProfileReport } from './repository-profile.js';

const execFile = promisify(execFileCallback);

const requiredPackageFiles = [
  'bin/proofroute.js',
  'bin/proofroute-classifier.js',
  'src/agent/classifier-evidence.js',
  'src/agent/launch-readiness.js',
  'src/agent/publish-readiness.js',
  'src/agent/release-pack.js',
  'src/agent/repository-profile.js',
  'scripts/check-prose-docs.js',
  'docs/repository-profile.md',
  'docs/proofroute-terminal.svg',
  'docs/proofroute-classifier.svg',
  'docs/proofroute-classifier-benchmark.svg',
  'README.md',
  'README.zh-CN.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'LICENSE',
  '.env.example'
];

export async function publishReadinessReport({
  cwd = process.cwd(),
  packagePath = new URL('../../package.json', import.meta.url),
  npmCommand = process.env.PROOFROUTE_NPM_COMMAND ?? 'npm',
  registry = process.env.PROOFROUTE_NPM_REGISTRY ?? 'https://registry.npmjs.org/',
  localOnly = false,
  checkPublic = false,
  checkActions = false,
  probeActionsDispatch = false,
  actionsWorkflow = 'ProofRoute CI',
  actionsRef = 'main',
  repo,
  runner = runCommand,
  fetchImpl = globalThis.fetch
} = {}) {
  if (localOnly && (checkPublic || checkActions || probeActionsDispatch)) {
    throw new Error('--local-only cannot be combined with --check-public, --check-actions, or --probe-actions-dispatch.');
  }
  const profile = await repositoryProfileReport({ packagePath });
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const repository = repo ?? profile.github.repository;
  const mode = localOnly ? 'local_only' : 'full';
  const checks = [];
  const npm = { command: npmCommand, registry };
  const metadata = packageMetadataCheck(pkg);
  checks.push(metadata);
  npm.metadata = metadata;
  const source = await gitSourceCheck({ cwd, runner });
  checks.push(source.summary);
  const cli = await npmCliCheck({ npmCommand, cwd, runner });
  checks.push(cli);
  npm.cli = cli;
  if (cli.pass) {
    npm.pack = await npmPackCheck({ npmCommand, cwd, runner });
    checks.push(npm.pack);
    npm.publishDryRun = await npmPublishDryRunCheck({ npmCommand, cwd, registry, runner });
    checks.push(npm.publishDryRun);
    npm.auth = localOnly
      ? skippedCheck('npm_auth', 'npm auth', 'npm auth is skipped by --local-only.')
      : await npmAuthCheck({ npmCommand, cwd, registry, runner });
    if (!localOnly) checks.push(npm.auth);
  } else {
    npm.pack = skippedCheck('npm_pack', 'npm pack dry-run', 'npm CLI is unavailable.');
    npm.publishDryRun = skippedCheck('npm_publish_dry_run', 'npm publish dry-run', 'npm CLI is unavailable.');
    npm.auth = skippedCheck('npm_auth', 'npm auth', 'npm CLI is unavailable.');
    checks.push(npm.pack, npm.publishDryRun);
    if (!localOnly) checks.push(npm.auth);
  }
  npm.evidence = npmEvidenceSummary(npm);
  let publicFace;
  let github;
  let account;
  if (checkPublic) {
    github = await githubAuthenticatedRepositoryCheck({ repo: repository, cwd, runner });
    checks.push(github.summary);
    account = await githubAccountVisibilityCheck({ repo: repository, cwd, runner });
    checks.push(account.summary);
    publicFace = await publicRepositoryFaceReport({ packagePath, fetchImpl });
    checks.push(checkFromStatus({
      id: 'public_face',
      label: 'public GitHub and npm face',
      pass: publicFace.status === 'pass',
      detail: publicFaceCheckDetail(publicFace)
    }));
  }
  let actions;
  if (checkActions) {
    actions = await githubActionsCheck({ repo: repository, cwd, runner, probeDispatch: probeActionsDispatch, workflow: actionsWorkflow, ref: actionsRef, head: source.head });
    checks.push(actions.summary);
  }
  const requiredPass = checks.filter((check) => check.severity !== 'advisory').every((check) => check.pass || check.skipped);
  const skippedRequired = checks.some((check) => check.severity !== 'advisory' && check.skipped);
  const blockers = publishBlockers({ npm, source, account, publicFace, actions, repository, npmCommand, registry, localOnly });
  const nextActions = blockers.map((blocker) => ({
    id: `${blocker.id}_next`,
    forBlocker: blocker.id,
    summary: blocker.nextAction,
    command: blocker.command
  }));
  const status = requiredPass && !skippedRequired ? 'pass' : 'fail';
  const fullGateRequested = !localOnly && checkPublic && checkActions;
  const fullPublishReady = status === 'pass' && fullGateRequested;
  const summary = publishReadinessSummary({ npm, source, blockers, localOnly, fullPublishReady });
  return {
    kind: 'proofroute-publish-readiness-v1',
    generatedAt: new Date().toISOString(),
    mode,
    localOnly,
    fullGateRequested,
    fullPublishReady,
    status,
    summary,
    package: {
      name: pkg.name,
      version: pkg.version,
      repository,
      publishAccess: pkg.publishConfig?.access ?? 'default'
    },
    npm,
    source,
    github,
    account,
    public: publicFace,
    actions,
    blockers,
    nextActions,
    checks
  };
}

export async function writePublishSupportPack({ report, supportNote, outDir = 'proofroute-publish-support-pack', cwd = process.cwd(), now } = {}) {
  if (!report) throw new Error('publish support pack requires a publish readiness report.');
  const absoluteOut = resolve(cwd, String(outDir || 'proofroute-publish-support-pack'));
  const generatedAt = timestamp(now);
  await mkdir(absoluteOut, { recursive: true });
  const files = [
    displayPath(cwd, join(absoluteOut, 'manifest.json')),
    displayPath(cwd, join(absoluteOut, 'status.json')),
    displayPath(cwd, join(absoluteOut, 'publish-readiness.json')),
    displayPath(cwd, join(absoluteOut, 'publish-support-note.txt')),
    displayPath(cwd, join(absoluteOut, 'next-actions.md')),
    displayPath(cwd, join(absoluteOut, 'redaction-policy.txt'))
  ];
  const statusSummary = publishSupportStatusSummary({ report, generatedAt });
  const pack = {
    kind: 'proofroute-publish-support-pack-v1',
    generatedAt,
    status: report.status ?? 'unknown',
    readyToPublish: isFullPublishReady(report),
    outDir: displayPath(cwd, absoluteOut),
    package: {
      name: report.package?.name,
      version: report.package?.version,
      repository: report.package?.repository
    },
    blockerIds: (report.blockers ?? []).map((blocker) => blocker.id),
    nextActionCount: (report.nextActions ?? []).length,
    npmEvidence: report.npm?.evidence,
    statusSummary,
    files
  };
  const note = redactSupportDocument(supportNote ?? publishSupportNoteFallback(report));
  const markdown = publishSupportNextActionsMarkdown({ report, generatedAt });
  const redactionPolicy = publishSupportRedactionPolicy({ report, generatedAt });
  await writePackJson(join(absoluteOut, 'manifest.json'), redactSupportValue(pack));
  await writePackJson(join(absoluteOut, 'status.json'), redactSupportValue(statusSummary));
  await writePackJson(join(absoluteOut, 'publish-readiness.json'), redactSupportValue(report));
  await writePackText(join(absoluteOut, 'publish-support-note.txt'), note);
  await writePackText(join(absoluteOut, 'next-actions.md'), markdown);
  await writePackText(join(absoluteOut, 'redaction-policy.txt'), redactionPolicy);
  const leakSurface = `${JSON.stringify(redactSupportValue(report))}\n${JSON.stringify(redactSupportValue(statusSummary))}\n${note}\n${markdown}\n${redactionPolicy}`;
  if (/Refactor this webhook|Extract customer ids|Rewrite this README|secret production prompt|secret-token|sk-secret/i.test(leakSurface)) {
    throw new Error('publish support pack would expose prompt-like content or credential-shaped values.');
  }
  return redactSupportValue(pack);
}

function packageMetadataCheck(pkg) {
  const bin = pkg.bin && typeof pkg.bin === 'object' ? pkg.bin : {};
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const missingBin = ['proofroute', 'proofroute-classifier'].filter((name) => !bin[name]);
  const hasPublicAccess = pkg.publishConfig?.access === 'public';
  const hasReadme = files.includes('README.md');
  const hasChineseReadme = files.includes('README.zh-CN.md');
  const pass = Boolean(pkg.name) && Boolean(pkg.version) && pkg.private !== true && hasPublicAccess && missingBin.length === 0 && hasReadme && hasChineseReadme;
  return checkFromStatus({
    id: 'package_metadata',
    label: 'package metadata',
    pass,
    detail: pass ? `${pkg.name}@${pkg.version} is configured for public npm access, has CLI bins, and ships both README surfaces.` : `metadata incomplete: private ${pkg.private === true}, public access ${hasPublicAccess}, missing bins ${missingBin.join(', ') || 'none'}, README ${hasReadme}, zh README ${hasChineseReadme}.`
  });
}

async function npmCliCheck({ npmCommand, cwd, runner }) {
  const result = await runNpm({ npmCommand, args: ['--version'], cwd, runner });
  return checkFromStatus({
    id: 'npm_cli',
    label: 'npm CLI',
    pass: result.ok,
    detail: result.ok ? `${npmCommand} ${result.stdout.trim()} is executable.` : `${npmCommand} is not executable: ${commandMessage(result)}.`,
    output: summarizeCommand(result)
  });
}

async function npmPackCheck({ npmCommand, cwd, runner }) {
  const result = await runNpm({ npmCommand, args: ['pack', '--json', '--dry-run'], cwd, runner });
  let parsed;
  let missing = requiredPackageFiles;
  if (result.ok) {
    try {
      parsed = JSON.parse(result.stdout)[0];
      const files = new Set((parsed.files ?? []).map((file) => file.path));
      missing = requiredPackageFiles.filter((file) => !files.has(file));
    } catch (error) {
      return checkFromStatus({
        id: 'npm_pack',
        label: 'npm pack dry-run',
        pass: false,
        detail: `npm pack output was not valid JSON: ${error.message}.`,
        output: summarizeCommand(result)
      });
    }
  }
  return checkFromStatus({
    id: 'npm_pack',
    label: 'npm pack dry-run',
    pass: result.ok && missing.length === 0,
    detail: result.ok ? `${parsed?.filename ?? 'package'} has ${parsed?.entryCount ?? parsed?.files?.length ?? 0} files, ${missing.length} required files missing.` : `npm pack failed: ${commandMessage(result)}.`,
    output: summarizeCommand(result),
    package: summarizePack(parsed),
    missing
  });
}

async function npmPublishDryRunCheck({ npmCommand, cwd, registry, runner }) {
  const result = await runNpm({ npmCommand, args: ['publish', '--dry-run', '--access', 'public', '--registry', registry], cwd, runner });
  const autoCorrected = /auto-corrected|errors corrected/i.test(`${result.stdout}\n${result.stderr}`);
  return checkFromStatus({
    id: 'npm_publish_dry_run',
    label: 'npm publish dry-run',
    pass: result.ok && !autoCorrected,
    detail: result.ok ? `publish dry-run completed${autoCorrected ? ' but npm auto-corrected package metadata' : ' without metadata auto-correction'}.` : `publish dry-run failed: ${commandMessage(result)}.`,
    output: summarizeCommand(result)
  });
}

async function npmAuthCheck({ npmCommand, cwd, registry, runner }) {
  const result = await runNpm({ npmCommand, args: ['whoami', '--registry', registry], cwd, runner });
  return checkFromStatus({
    id: 'npm_auth',
    label: 'npm auth',
    pass: result.ok,
    detail: result.ok ? `npm registry identity ${result.stdout.trim()} is available.` : `npm registry auth is missing: ${commandMessage(result)}.`,
    output: summarizeCommand(result)
  });
}

async function githubAuthenticatedRepositoryCheck({ repo, cwd, runner }) {
  if (!repo) {
    const summary = checkFromStatus({
      id: 'github_authenticated',
      label: 'authenticated GitHub repository',
      pass: false,
      detail: 'GitHub repository is unknown, so authenticated visibility cannot be checked.'
    });
    return { summary };
  }
  const result = await runCommandSafe({
    command: 'gh',
    args: ['repo', 'view', repo, '--json', 'nameWithOwner,visibility,isPrivate,url,pushedAt'],
    cwd,
    runner
  });
  let parsed;
  try {
    parsed = result.ok ? JSON.parse(result.stdout) : undefined;
  } catch {
    parsed = undefined;
  }
  const visibility = parsed?.visibility ? String(parsed.visibility).toUpperCase() : 'unknown';
  const isPublic = result.ok && parsed?.isPrivate === false && visibility === 'PUBLIC';
  const summary = checkFromStatus({
    id: 'github_authenticated',
    label: 'authenticated GitHub repository',
    pass: isPublic,
    detail: isPublic ? `authenticated gh sees ${parsed.nameWithOwner ?? repo} as PUBLIC and private=false.` : `authenticated gh visibility is ${visibility}, private=${parsed?.isPrivate ?? 'unknown'}: ${result.ok ? 'metadata did not prove a public repository' : commandMessage(result)}.`
  });
  return {
    summary,
    repository: parsed,
    output: summarizeCommand(result)
  };
}

async function githubAccountVisibilityCheck({ repo, cwd, runner }) {
  const [owner, name] = String(repo ?? '').split('/');
  if (!owner || !name) {
    const summary = checkFromStatus({
      id: 'github_account_visibility',
      label: 'GitHub account visibility',
      pass: false,
      detail: 'GitHub owner and repository name are unknown, so account visibility cannot be checked.'
    });
    return { summary, blocker: 'missing_repository' };
  }
  const query = `${name} user:${owner}`;
  const result = await runCommandSafe({
    command: 'gh',
    args: ['api', '--method', 'GET', '/search/repositories', '-f', `q=${query}`],
    cwd,
    runner
  });
  const payload = parseJsonFromCommand(result);
  const errors = (payload?.errors ?? []).map((error) => error.message).filter(Boolean);
  const spammy = errors.some((message) => /flagged as spammy/i.test(message));
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const matched = items.some((item) => String(item.full_name ?? '').toLowerCase() === String(repo).toLowerCase());
  const totalCount = Number(payload?.total_count);
  const searchOk = result.ok && !spammy;
  const pass = searchOk && matched;
  const blocker = spammy ? 'account_flagged_as_spammy' : result.ok && !matched ? 'repository_not_search_discoverable' : result.ok ? undefined : 'account_visibility_probe_failed';
  const summary = checkFromStatus({
    id: 'github_account_visibility',
    label: 'GitHub account visibility',
    pass,
    detail: pass ? `authenticated GitHub search found ${repo} through ${query}.` : spammy ? `${owner} is flagged by GitHub search as spammy; anonymous public visibility will remain blocked until the account restriction is cleared.` : result.ok ? `authenticated GitHub search succeeded for ${query} but did not return ${repo}; total matches ${Number.isFinite(totalCount) ? totalCount : 'unknown'}.` : `GitHub account visibility probe failed for ${query}: ${commandMessage(result)}.`
  });
  return {
    summary,
    owner,
    query,
    blocker,
    errors,
    totalCount: Number.isFinite(totalCount) ? totalCount : undefined,
    matched,
    output: summarizeCommand(result)
  };
}

async function githubActionsCheck({ repo, cwd, runner, probeDispatch = false, workflow = 'ProofRoute CI', ref = 'main', head: sourceHead }) {
  if (!repo) {
    const summary = checkFromStatus({
      id: 'github_actions',
      label: 'GitHub Actions',
      pass: false,
      detail: 'GitHub repository is unknown, so Actions readiness cannot be checked.'
    });
    return { summary };
  }
  const permissions = await runCommandSafe({ command: 'gh', args: ['api', `repos/${repo}/actions/permissions`, '--jq', '{enabled,allowed_actions}'], cwd, runner });
  const dispatch = probeDispatch ? await runCommandSafe({ command: 'gh', args: ['workflow', 'run', workflow, '-R', repo, '--ref', ref], cwd, runner }) : undefined;
  const runs = await runCommandSafe({ command: 'gh', args: ['run', 'list', '-R', repo, '--limit', '20', '--json', 'databaseId,headSha,status,conclusion,workflowName,createdAt,url'], cwd, runner });
  const head = sourceHead ?? await gitHeadCheck({ cwd, runner });
  let parsedPermissions;
  let parsedRuns = [];
  try {
    parsedPermissions = permissions.ok ? JSON.parse(permissions.stdout) : undefined;
  } catch {
    parsedPermissions = undefined;
  }
  try {
    parsedRuns = runs.ok ? JSON.parse(runs.stdout) : [];
  } catch {
    parsedRuns = [];
  }
  const enabled = parsedPermissions?.enabled === true;
  const workflowRuns = parsedRuns.filter((run) => String(run.workflowName ?? '') === String(workflow));
  const headSha = head.sha;
  const hasRuns = workflowRuns.length > 0;
  const passingRuns = workflowRuns.filter((run) => run.status === 'completed' && run.conclusion === 'success');
  const hasPassingRun = passingRuns.some((run) => sameSha(run.headSha, headSha));
  const dispatchOk = dispatch === undefined || dispatch.ok;
  const pass = permissions.ok && runs.ok && head.pass && enabled && dispatchOk && hasRuns && hasPassingRun;
  const dispatchDetail = dispatch === undefined ? '' : `, dispatch probe ${dispatch.ok ? 'ok' : `failed ${commandMessage(dispatch)}`}`;
  const headDetail = headSha ? `current head ${shortSha(headSha)}` : 'current head unknown';
  const summary = checkFromStatus({
    id: 'github_actions',
    label: 'GitHub Actions',
    pass,
    detail: pass ? `Actions are enabled and ${workflowRuns.length}/${parsedRuns.length} recent runs for ${workflow} include a passing completed run for ${headDetail}${dispatchDetail}.` : `Actions enabled ${enabled}, recent runs ${parsedRuns.length}, ${workflow} runs ${workflowRuns.length}, passing ${workflow} runs for ${headDetail} ${hasPassingRun ? 'yes' : 'no'}, permissions command ${permissions.ok ? 'ok' : 'failed'}, run list ${runs.ok ? 'ok' : 'failed'}, git head ${head.pass ? 'ok' : 'failed'}${dispatchDetail}.`
  });
  return {
    summary,
    permissions: parsedPermissions,
    dispatch: dispatch ? summarizeCommand(dispatch) : undefined,
    head,
    runs: parsedRuns,
    workflow,
    workflowRuns,
    errors: {
      permissions: permissions.ok ? undefined : commandMessage(permissions),
      runs: runs.ok ? undefined : commandMessage(runs)
    }
  };
}

async function gitHeadCheck({ cwd, runner }) {
  const result = await runCommandSafe({ command: 'git', args: ['rev-parse', 'HEAD'], cwd, runner });
  const sha = result.ok ? normalizeSha(result.stdout) : '';
  return {
    pass: Boolean(sha),
    source: 'local_git_head',
    ref: 'HEAD',
    sha,
    shortSha: shortSha(sha),
    output: summarizeCommand(result)
  };
}

async function gitSourceCheck({ cwd, runner }) {
  const head = await gitHeadCheck({ cwd, runner });
  const status = await runCommandSafe({ command: 'git', args: ['status', '--porcelain'], cwd, runner });
  const dirtyCount = status.ok ? countPorcelainStatus(status.stdout) : undefined;
  const clean = status.ok && dirtyCount === 0;
  const pass = head.pass && clean;
  const detail = sourceTreeDetail({ head, status, dirtyCount, clean });
  return {
    summary: checkFromStatus({
      id: 'source_tree',
      label: 'source tree',
      pass,
      detail
    }),
    head,
    clean,
    dirty: status.ok ? dirtyCount > 0 : undefined,
    dirtyCount,
    status: summarizeSourceStatusCommand(status)
  };
}

function countPorcelainStatus(stdout) {
  return String(stdout ?? '').split(/\r?\n/).filter((line) => line.trim()).length;
}

function sourceTreeDetail({ head, status, dirtyCount, clean }) {
  const headText = head.sha ? `git HEAD ${shortSha(head.sha)}` : 'git HEAD unavailable';
  if (!head.pass) return `${headText}: ${commandMessage(head.output ?? {})}.`;
  if (!status.ok) return `${headText} resolved, but git status failed: ${commandMessage(status)}.`;
  return clean ? `${headText} resolved and working tree is clean.` : `${headText} resolved, but working tree has ${dirtyCount} uncommitted change${dirtyCount === 1 ? '' : 's'}.`;
}

function summarizeSourceStatusCommand(result) {
  const summary = summarizeCommand(result);
  return {
    ...summary,
    stdout: result.ok ? '' : summary.stdout
  };
}

function normalizeSha(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return /^[a-f0-9]{40}$/.test(text) ? text : '';
}

function sameSha(left, right) {
  const normalizedLeft = normalizeSha(left);
  const normalizedRight = normalizeSha(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function shortSha(value) {
  const sha = normalizeSha(value);
  return sha ? sha.slice(0, 7) : 'unknown';
}

function publishBlockers({ npm, source, account, publicFace, actions, repository, npmCommand, registry, localOnly = false }) {
  const publishCommand = publishCommandForMode(localOnly);
  const blockers = [];
  if (source?.summary && !source.summary.pass) {
    const headUnavailable = !source.head?.pass;
    blockers.push({
      id: headUnavailable ? 'source_head_unavailable' : 'source_tree_dirty',
      source: 'source',
      title: headUnavailable ? 'Make the local git HEAD resolvable before publication.' : 'Commit or stash local source changes before publication.',
      detail: source.summary.detail,
      evidence: {
        checkId: 'source_tree',
        headSha: source.head?.sha,
        headSource: source.head?.source,
        headRef: source.head?.ref,
        dirty: source.dirty,
        dirtyCount: source.dirtyCount,
        statusCode: source.status?.code
      },
      nextAction: headUnavailable ? `Run git rev-parse HEAD, repair the local checkout, then rerun ${publishCommand} so the package evidence has a stable source commit.` : `Run git status --short, commit or stash the local changes, then rerun ${publishCommand} so npm pack and publish dry-run describe the same source tree.`,
      command: headUnavailable ? 'git rev-parse HEAD' : 'git status --short',
      scope: 'local',
      localFixable: true,
      supportCategory: 'source_tree'
    });
  }
  if (npm.cli && !npm.cli.pass) {
    blockers.push({
      id: 'npm_cli_missing',
      source: 'npm.cli',
      title: 'Install or point ProofRoute at an executable npm CLI.',
      detail: npm.cli.detail,
      evidence: {
        checkId: 'npm_cli',
        code: npm.cli.output?.code
      },
      nextAction: `Run ${npmCommand} --version, install npm if needed, or rerun with ${publishCommand} --npm /path/to/npm.`,
      command: `${npmCommand} --version`,
      scope: 'local',
      localFixable: true,
      supportCategory: 'npm_cli'
    });
  }
  if (npm.metadata && !npm.metadata.pass) {
    blockers.push({
      id: 'npm_package_metadata_failed',
      source: 'npm.metadata',
      title: 'Fix package metadata before npm publication.',
      detail: npm.metadata.detail,
      evidence: {
        checkId: 'package_metadata'
      },
      nextAction: `Update package.json so the package is configured for public npm access, has both CLI bins, ships both README surfaces, and uses publishConfig access public, then rerun ${publishCommand}.`,
      command: `node ./bin/proofroute.js publish${localOnly ? ' --local-only' : ' --check-public --check-actions'} --json`,
      scope: 'local',
      localFixable: true,
      supportCategory: 'package_metadata'
    });
  }
  if (npm.pack && !npm.pack.pass && !npm.pack.skipped) {
    blockers.push({
      id: 'npm_package_surface_failed',
      source: 'npm.pack',
      title: 'Fix the npm tarball surface before release.',
      detail: npm.pack.detail,
      evidence: {
        checkId: 'npm_pack',
        missing: npm.pack.missing ?? [],
        code: npm.pack.output?.code
      },
      nextAction: `Run ${npmCommand} pack --json --dry-run and make the required ProofRoute CLI, source, docs, README, license, security, and env template files appear in the package before rerunning ${publishCommand}.`,
      command: `${npmCommand} pack --json --dry-run`,
      scope: 'local',
      localFixable: true,
      supportCategory: 'npm_pack'
    });
  }
  if (npm.publishDryRun && !npm.publishDryRun.pass && !npm.publishDryRun.skipped) {
    blockers.push({
      id: 'npm_publish_dry_run_failed',
      source: 'npm.publishDryRun',
      title: 'Make npm publish dry-run clean before release.',
      detail: npm.publishDryRun.detail,
      evidence: {
        checkId: 'npm_publish_dry_run',
        code: npm.publishDryRun.output?.code
      },
      nextAction: `Run ${npmCommand} publish --dry-run --access public --registry ${registry}, fix any npm errors or metadata auto-corrections, then rerun ${publishCommand}.`,
      command: `${npmCommand} publish --dry-run --access public --registry ${registry}`,
      scope: 'local',
      localFixable: true,
      supportCategory: 'npm_publish_dry_run'
    });
  }
  if (npm.auth && !npm.auth.pass && !npm.auth.skipped) {
    blockers.push({
      id: 'npm_auth_missing',
      source: 'npm.auth',
      title: 'Log into npm before publishing.',
      detail: npm.auth.detail,
      evidence: {
        checkId: 'npm_auth',
        code: npm.auth.output?.code
      },
      nextAction: `Run ${npmCommand} login --registry ${registry} or provide an npm automation token, then rerun proofroute publish --check-public --check-actions.`,
      command: `${npmCommand} login --registry ${registry}`,
      scope: 'operator_auth',
      localFixable: false,
      supportCategory: 'npm_auth'
    });
  }
  if (account?.summary && !account.summary.pass) {
    const flagged = account.blocker === 'account_flagged_as_spammy';
    blockers.push({
      id: flagged ? 'github_account_flagged_spammy' : 'github_account_visibility_failed',
      source: 'account',
      title: flagged ? 'Clear the GitHub account visibility restriction.' : 'Restore GitHub account search visibility.',
      detail: account.summary.detail,
      evidence: {
        checkId: 'github_account_visibility',
        blocker: account.blocker,
        query: account.query
      },
      nextAction: flagged ? 'Open GitHub account settings and Support for Lling0000; ask GitHub to review the account-level spam or visibility restriction before expecting anonymous repo access to work.' : `Confirm that authenticated GitHub search can find ${repository} through ${account.query}, then rerun the public preflight.`,
      supportMessage: flagged ? githubSupportMessage({ repository, publicFace, actions }) : undefined,
      scope: 'external_platform',
      localFixable: false,
      supportCategory: 'github_visibility'
    });
  }
  if (publicFace?.status === 'fail') {
    const ownerStatus = publicFace.github?.owner?.status;
    const githubStatus = publicFace.github?.status;
    const npmStatus = publicFace.npm?.status;
    const failedChecks = failedPublicFaceChecks(publicFace);
    const hasNotFound = [ownerStatus, githubStatus, npmStatus].some((status) => status === 404);
    const localOnly = failedChecks.length > 0 && failedChecks.every((check) => check.id === 'readme_badges');
    blockers.push({
      id: hasNotFound ? 'public_face_404' : 'public_face_failed',
      source: 'public',
      title: localOnly ? 'Fix the README badge contract before public launch.' : 'Make the public GitHub and npm face visible without credentials.',
      detail: publicFaceFailureDetail(publicFace),
      evidence: {
        checkId: 'public_face',
        ownerStatus,
        githubStatus,
        npmStatus,
        failedChecks
      },
      nextAction: localOnly ? 'Restore the README first-screen badge contract locally, then rerun profile --check-public.' : account?.blocker === 'account_flagged_as_spammy' ? 'Clear the GitHub account-level visibility blocker first, then publish the npm package and rerun profile --check-public.' : 'Verify the GitHub owner, GitHub repository, and npm package are reachable anonymously, then rerun profile --check-public.',
      scope: localOnly ? 'local' : 'external_platform',
      localFixable: localOnly,
      supportCategory: 'public_visibility'
    });
  }
  if (actions?.summary && !actions.summary.pass) {
    const userDisabled = actionsUserDisabled(actions);
    blockers.push({
      id: userDisabled ? 'github_actions_disabled' : 'github_actions_not_passing',
      source: 'actions',
      title: userDisabled ? 'Restore account-level GitHub Actions access.' : 'Produce a passing GitHub Actions run.',
      detail: actions.summary.detail,
      evidence: {
        checkId: 'github_actions',
        dispatchCode: actions.dispatch?.code,
        enabled: actions.permissions?.enabled,
        recentRuns: actions.runs?.length ?? 0,
        workflow: actions.workflow,
        headSha: actions.head?.sha,
        headSource: actions.head?.source,
        headRef: actions.head?.ref,
        workflowRuns: actions.workflowRuns?.length ?? 0
      },
      nextAction: userDisabled ? 'Open GitHub account Actions settings or Support; repo-level Actions permissions are already enabled, so repeating repo API toggles will not fix this blocker.' : 'Run the ProofRoute CI workflow after Actions access is healthy, then rerun publish --check-actions.',
      supportMessage: userDisabled ? githubActionsSupportMessage({ repository, actions }) : undefined,
      scope: 'external_platform',
      localFixable: false,
      supportCategory: 'github_actions'
    });
  }
  return blockers;
}

function publishCommandForMode(localOnly) {
  return localOnly ? 'proofroute publish --local-only' : 'proofroute publish --check-public --check-actions';
}

function publishReadinessSummary({ npm, source, blockers, localOnly = false, fullPublishReady = false }) {
  const localChecks = [source?.summary, npm.metadata, npm.cli, npm.pack, npm.publishDryRun].filter(Boolean);
  const localEvidence = localChecks.length === 0
    ? 'not_checked'
    : localChecks.every((check) => check.pass)
      ? 'pass'
      : localChecks.some((check) => !check.skipped && !check.pass)
        ? 'fail'
        : 'skipped';
  const blockerIds = blockers.map((blocker) => blocker.id);
  const localFixableBlockerIds = blockers.filter((blocker) => blocker.localFixable).map((blocker) => blocker.id);
  const operatorBlockerIds = blockers.filter((blocker) => blocker.scope === 'operator_auth').map((blocker) => blocker.id);
  const externalBlockerIds = blockers.filter((blocker) => blocker.scope === 'external_platform').map((blocker) => blocker.id);
  const skippedExternalChecks = localOnly
    ? ['npm_auth', 'github_authenticated', 'github_account_visibility', 'public_face', 'github_actions']
    : [];
  const remainingBlockerScope = blockers.length === 0
    ? localOnly ? 'full_publish_checks_skipped' : 'none'
    : localEvidence === 'pass' && localFixableBlockerIds.length === 0
      ? 'external_or_operator'
      : 'local_or_mixed';
  return {
    mode: localOnly ? 'local_only' : 'full',
    localEvidence,
    fullPublishReady,
    skippedExternalChecks,
    remainingBlockerScope,
    blockerIds,
    localFixableBlockerIds,
    operatorBlockerIds,
    externalBlockerIds
  };
}

function failedPublicFaceChecks(publicFace) {
  return (publicFace?.checks ?? [])
    .filter((check) => check.severity !== 'advisory' && !check.pass)
    .map((check) => ({
      id: check.id,
      label: check.label,
      detail: check.detail
    }));
}

function publicFaceCheckDetail(publicFace) {
  const failed = failedPublicFaceChecks(publicFace);
  if (failed.length === 0) return `public face ${publicFace?.status ?? 'unknown'}, owner ${publicFace?.github?.owner?.status ?? 'unknown'}, github ${publicFace?.github?.status ?? 'unknown'}, npm ${publicFace?.npm?.status ?? 'unknown'}.`;
  return `public face ${publicFace?.status ?? 'unknown'}, failed required checks ${failed.map((check) => check.id).join(', ')}.`;
}

function publicFaceFailureDetail(publicFace) {
  const failed = failedPublicFaceChecks(publicFace);
  if (failed.length > 0) return failed.map((check) => `${check.id}: ${check.detail}`).join(' ');
  return `owner ${publicFace?.github?.owner?.status ?? 'unknown'}, repository ${publicFace?.github?.status ?? 'unknown'}, npm ${publicFace?.npm?.status ?? 'unknown'}.`;
}

function actionsUserDisabled(actions) {
  const dispatchMessage = `${actions?.dispatch?.stderr ?? ''} ${actions?.dispatch?.message ?? ''}`;
  return /Actions has been disabled for this user/i.test(dispatchMessage);
}

function githubSupportMessage({ repository, publicFace, actions }) {
  const anonymous404 = [publicFace?.github?.owner?.status, publicFace?.github?.status].some((status) => status === 404);
  const publicEvidence = anonymous404
    ? 'Anonymous API access to the owner or repository returns 404.'
    : `Anonymous public visibility from this run is owner ${publicFace?.github?.owner?.status ?? 'unknown'} and repository ${publicFace?.github?.status ?? 'unknown'}.`;
  const actionsEvidence = actionsUserDisabled(actions)
    ? 'GitHub Actions repository permissions are enabled, but workflow dispatch reports that Actions has been disabled for this user.'
    : undefined;
  const closing = actionsEvidence
    ? 'Please review the account-level visibility restriction and the account-level Actions restriction shown in the attached publish preflight evidence.'
    : 'Please review the account-level visibility restriction shown in the attached publish preflight evidence.';
  return [
    `My account owns ${repository}.`,
    'Authenticated GitHub API shows this repository is public and private=false, but authenticated repository search reports that the user is flagged as spammy.',
    publicEvidence,
    actionsEvidence,
    closing
  ].filter(Boolean).join(' ');
}

function githubActionsSupportMessage({ repository, actions }) {
  const enabled = actions?.permissions?.enabled === true ? 'enabled' : 'unknown';
  const code = actions?.dispatch?.code ?? 'unknown';
  return `My account owns ${repository}. GitHub repository Actions permissions are ${enabled}, but workflow dispatch is rejected with code ${code} and reports that Actions has been disabled for this user. Please review the account-level Actions restriction shown in the attached publish preflight evidence.`;
}

function publishSupportNoteFallback(report) {
  const blockers = (report.blockers ?? []).map((blocker) => `${redactSupportText(blocker.id)}: ${redactSupportText(blocker.detail)}`).join(' ');
  return `ProofRoute publish preflight status is ${redactSupportText(report.status ?? 'unknown')}. ${blockers || 'No publish blockers were detected by this run.'}`;
}

function publishSupportStatusSummary({ report, generatedAt }) {
  const summary = report.summary ?? {};
  const npmEvidence = report.npm?.evidence ?? {};
  const publicFace = report.public;
  const actions = report.actions;
  const account = report.account;
  const github = report.github;
  const source = report.source;
  const blockerIds = (report.blockers ?? []).map((blocker) => blocker.id);
  const fullPublishReady = isFullPublishReady(report);
  return {
    kind: 'proofroute-publish-support-status-v1',
    generatedAt,
    mode: report.mode ?? (report.localOnly ? 'local_only' : 'full'),
    localOnly: report.localOnly === true,
    fullGateRequested: report.fullGateRequested === true,
    status: report.status ?? 'unknown',
    readyToPublish: fullPublishReady,
    fullPublishReady,
    localGateReady: summary.localEvidence === 'pass',
    localEvidence: summary.localEvidence ?? 'not_summarized',
    remainingBlockerScope: summary.remainingBlockerScope ?? 'unknown',
    skippedExternalChecks: summary.skippedExternalChecks ?? [],
    blockerIds,
    localFixableBlockerIds: summary.localFixableBlockerIds ?? [],
    operatorBlockerIds: summary.operatorBlockerIds ?? [],
    externalBlockerIds: summary.externalBlockerIds ?? [],
    nextActionCount: (report.nextActions ?? []).length,
    package: {
      name: report.package?.name,
      version: report.package?.version,
      repository: report.package?.repository,
      publishAccess: report.package?.publishAccess
    },
    source: {
      tree: source?.summary ? checkState(source.summary) : 'not_checked',
      head: source?.head?.sha,
      headShort: source?.head?.shortSha,
      headSource: source?.head?.source,
      headRef: source?.head?.ref,
      clean: source?.clean,
      dirty: source?.dirty,
      dirtyCount: source?.dirtyCount
    },
    npm: {
      command: npmEvidence.command ?? report.npm?.command,
      registry: npmEvidence.registry ?? report.npm?.registry,
      cli: npmEvidence.cli ?? 'not_checked',
      version: npmEvidence.version,
      pack: npmEvidence.pack ?? 'not_checked',
      requiredFilesChecked: npmEvidence.requiredFilesChecked,
      requiredFilesMissing: npmEvidence.requiredFilesMissing,
      publishDryRun: npmEvidence.publishDryRun ?? 'not_checked',
      auth: npmEvidence.auth ?? 'not_checked',
      package: npmEvidence.package
    },
    github: {
      authenticated: github?.summary ? checkState(github.summary) : 'not_checked',
      visibility: github?.repository?.visibility,
      private: github?.repository?.isPrivate,
      accountVisibility: account?.summary ? checkState(account.summary) : 'not_checked',
      accountBlocker: account?.blocker,
      publicFace: publicFace?.status ?? 'not_checked',
      ownerStatus: publicFace?.github?.owner?.status,
      repositoryStatus: publicFace?.github?.status,
      npmStatus: publicFace?.npm?.status,
      actions: actions?.summary ? checkState(actions.summary) : 'not_checked',
      actionsEnabled: actions?.permissions?.enabled,
      actionWorkflow: actions?.workflow,
      actionHead: actions?.head?.sha,
      actionHeadShort: actions?.head?.shortSha,
      actionHeadSource: actions?.head?.source,
      actionHeadRef: actions?.head?.ref,
      actionRunCount: actions?.runs?.length,
      actionWorkflowRunCount: actions?.workflowRuns?.length,
      dispatch: actions?.dispatch ? actions.dispatch.ok ? 'pass' : 'fail' : 'not_checked'
    },
    support: {
      categories: [...new Set((report.blockers ?? []).map((blocker) => blocker.supportCategory).filter(Boolean))],
      localFixable: (summary.localFixableBlockerIds ?? []).length > 0,
      operatorActionRequired: (summary.operatorBlockerIds ?? []).length > 0,
      externalPlatformActionRequired: (summary.externalBlockerIds ?? []).length > 0
    }
  };
}

function isFullPublishReady(report) {
  return report?.status === 'pass' && report?.localOnly !== true && report?.fullPublishReady !== false;
}

function npmEvidenceSummary(npm) {
  const pack = npm.pack?.package;
  const version = npm.cli?.pass ? npmVersionFromOutput(npm.cli.output?.stdout) : undefined;
  return {
    command: npm.command,
    registry: npm.registry,
    cli: checkState(npm.cli),
    version,
    pack: checkState(npm.pack),
    requiredFilesChecked: requiredPackageFiles.length,
    requiredFilesMissing: npm.pack?.missing?.length,
    package: pack ? {
      filename: pack.filename,
      entryCount: pack.entryCount,
      size: pack.size,
      unpackedSize: pack.unpackedSize,
      integrity: pack.integrity
    } : undefined,
    publishDryRun: checkState(npm.publishDryRun),
    auth: checkState(npm.auth)
  };
}

function npmVersionFromOutput(stdout) {
  const match = String(stdout ?? '').match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/);
  return match?.[0];
}

function checkState(check) {
  if (!check) return 'not_checked';
  if (check.skipped) return 'skipped';
  return check.pass ? 'pass' : 'fail';
}

function publishSupportNextActionsMarkdown({ report, generatedAt }) {
  const packageName = `${report.package?.name ?? 'unknown'}@${report.package?.version ?? 'unknown'}`;
  const repository = report.package?.repository ?? 'unknown repository';
  const blockers = (report.blockers ?? []).map((blocker) => redactSupportText(blocker.id));
  const actions = (report.nextActions ?? []).map((action) => redactSupportText(action.summary)).filter(Boolean);
  const status = redactSupportText(report.status ?? 'unknown').toUpperCase();
  const npmEvidence = report.npm?.evidence;
  const localOnly = report.localOnly === true;
  const evidenceLine = npmEvidence
    ? `Npm evidence is command ${redactSupportText(npmEvidence.command ?? 'unknown')}, version ${redactSupportText(npmEvidence.version ?? 'unknown')}, pack ${redactSupportText(npmEvidence.pack)}, package ${redactSupportText(npmEvidence.package?.filename ?? 'unknown package')} with ${redactSupportText(npmEvidence.package?.entryCount ?? 'unknown')} files, dry-run ${redactSupportText(npmEvidence.publishDryRun)}, auth ${redactSupportText(npmEvidence.auth)}, and ${redactSupportText(npmEvidence.requiredFilesMissing ?? 'unknown')} missing required files across ${redactSupportText(npmEvidence.requiredFilesChecked ?? 'unknown')} checked files.`
    : 'Npm evidence was not attached to this publish report.';
  const statusLine = localOnly
    ? `Generated at ${redactSupportText(generatedAt)} for ${redactSupportText(packageName)} and repository ${redactSupportText(repository)}. The local-only publish preflight status is ${status}, so this pack records source, package, and npm dry-run evidence without claiming npm auth, public visibility, or GitHub Actions readiness.`
    : `Generated at ${redactSupportText(generatedAt)} for ${redactSupportText(packageName)} and repository ${redactSupportText(repository)}. The publish preflight status is ${status}, so this pack records release evidence rather than converting the failed gate into a success.`;
  return [
    '# ProofRoute Publish Support Pack',
    '',
    statusLine,
    '',
    evidenceLine,
    '',
    blockers.length > 0 ? `Detected blocker ids are ${blockers.join(', ')}.` : 'No publish blocker ids were detected by this run.',
    '',
    actions.length > 0 ? `The next action trail says ${actions.join(' ')}` : 'No next action trail was emitted by this run.',
    '',
    'The redacted JSON report keeps machine-readable check evidence, the support note keeps copy-ready human context, and the redaction policy explains which sensitive surfaces were removed before the pack was written.',
    ''
  ].join('\n');
}

function publishSupportRedactionPolicy({ report, generatedAt }) {
  const blockers = (report.blockers ?? []).map((blocker) => redactSupportText(blocker.id)).join(', ') || 'none';
  const mode = report.localOnly === true ? 'local-only source and package preflight' : 'full publish preflight';
  return [
    'ProofRoute publish support pack redaction policy',
    '',
    `Generated at ${redactSupportText(generatedAt)} with blocker ids ${blockers}. This pack was created from the ${mode} and is designed for release logs or platform support conversations, not for replacing the publish gate.`,
    '',
    'The pack redacts ANSI control sequences, terminal control characters, URL userinfo, token-like query parameters, token-shaped environment assignments, Authorization bearer values, OpenAI-style secret keys, GitHub tokens, and local user home paths. It is not expected to contain prompt text, completion text, credentials, private provider endpoints, or raw local npm log paths.',
    ''
  ].join('\n');
}

async function writePackJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writePackText(path, value) {
  await writeFile(path, `${String(value).replace(/\n?$/, '\n')}`, 'utf8');
}

function timestamp(now) {
  if (now instanceof Date) return now.toISOString();
  if (now !== undefined) return new Date(now).toISOString();
  return new Date().toISOString();
}

function displayPath(cwd, absolutePath) {
  const rel = relative(cwd, absolutePath);
  return rel && !rel.startsWith('..') ? rel : absolutePath;
}

async function runNpm({ npmCommand, args, cwd, runner }) {
  return runCommandSafe({ command: npmCommand, args, cwd, runner });
}

async function runCommandSafe({ command, args, cwd, runner }) {
  try {
    const output = await runner(command, args, { cwd });
    return {
      ok: true,
      code: 0,
      stdout: output.stdout ?? '',
      stderr: output.stderr ?? ''
    };
  } catch (error) {
    return {
      ok: false,
      code: error.code ?? error.status ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
      message: error.message
    };
  }
}

async function runCommand(command, args, { cwd } = {}) {
  return execFile(command, args, {
    cwd,
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 8
  });
}

function checkFromStatus({ id, label, pass, detail, severity = 'required', ...rest }) {
  return {
    id,
    label,
    severity,
    pass: Boolean(pass),
    detail,
    ...rest
  };
}

function skippedCheck(id, label, detail) {
  return {
    id,
    label,
    severity: 'required',
    pass: false,
    skipped: true,
    detail
  };
}

function commandMessage(result) {
  return compact(redactSupportText(`${result.stderr || result.stdout || result.message || `exit ${result.code ?? 'unknown'}`}`));
}

function parseJsonFromCommand(result) {
  for (const value of [result.stdout, result.stderr, result.message]) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end < start) continue;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      continue;
    }
  }
  return undefined;
}

function summarizeCommand(result) {
  return {
    ok: result.ok,
    code: result.code,
    stdout: compact(redactSupportText(result.stdout)),
    stderr: compact(redactSupportText(result.stderr)),
    message: result.message === undefined ? undefined : redactSupportText(result.message)
  };
}

function summarizePack(parsed) {
  if (!parsed) return undefined;
  return {
    name: parsed.name,
    version: parsed.version,
    filename: parsed.filename,
    entryCount: parsed.entryCount ?? parsed.files?.length ?? 0,
    size: parsed.size,
    unpackedSize: parsed.unpackedSize,
    shasum: parsed.shasum,
    integrity: parsed.integrity
  };
}

function compact(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
}
