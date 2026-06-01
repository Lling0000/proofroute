import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { publicRepositoryFaceReport, repositoryProfileReport } from './repository-profile.js';

const execFile = promisify(execFileCallback);

const requiredPackageFiles = [
  'bin/proofroute.js',
  'bin/proofroute-classifier.js',
  'src/agent/classifier-evidence.js',
  'src/agent/launch-readiness.js',
  'src/agent/release-pack.js',
  'src/agent/repository-profile.js',
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
  checkPublic = false,
  checkActions = false,
  repo,
  runner = runCommand,
  fetchImpl = globalThis.fetch
} = {}) {
  const profile = await repositoryProfileReport({ packagePath });
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const repository = repo ?? profile.github.repository;
  const checks = [];
  const npm = { command: npmCommand, registry };
  const metadata = packageMetadataCheck(pkg);
  checks.push(metadata);
  npm.metadata = metadata;
  const cli = await npmCliCheck({ npmCommand, cwd, runner });
  checks.push(cli);
  npm.cli = cli;
  if (cli.pass) {
    npm.pack = await npmPackCheck({ npmCommand, cwd, runner });
    checks.push(npm.pack);
    npm.publishDryRun = await npmPublishDryRunCheck({ npmCommand, cwd, registry, runner });
    checks.push(npm.publishDryRun);
    npm.auth = await npmAuthCheck({ npmCommand, cwd, registry, runner });
    checks.push(npm.auth);
  } else {
    npm.pack = skippedCheck('npm_pack', 'npm pack dry-run', 'npm CLI is unavailable.');
    npm.publishDryRun = skippedCheck('npm_publish_dry_run', 'npm publish dry-run', 'npm CLI is unavailable.');
    npm.auth = skippedCheck('npm_auth', 'npm auth', 'npm CLI is unavailable.');
    checks.push(npm.pack, npm.publishDryRun, npm.auth);
  }
  let publicFace;
  if (checkPublic) {
    publicFace = await publicRepositoryFaceReport({ packagePath, fetchImpl });
    checks.push(checkFromStatus({
      id: 'public_face',
      label: 'public GitHub and npm face',
      pass: publicFace.status === 'pass',
      detail: `public face ${publicFace.status}, github ${publicFace.github?.status ?? 'unknown'}, npm ${publicFace.npm?.status ?? 'unknown'}.`
    }));
  }
  let actions;
  if (checkActions) {
    actions = await githubActionsCheck({ repo: repository, cwd, runner });
    checks.push(actions.summary);
  }
  const requiredPass = checks.filter((check) => check.severity !== 'advisory').every((check) => check.pass || check.skipped);
  const skippedRequired = checks.some((check) => check.severity !== 'advisory' && check.skipped);
  return {
    kind: 'proofroute-publish-readiness-v1',
    generatedAt: new Date().toISOString(),
    status: requiredPass && !skippedRequired ? 'pass' : 'fail',
    package: {
      name: pkg.name,
      version: pkg.version,
      repository,
      publishAccess: pkg.publishConfig?.access ?? 'default'
    },
    npm,
    public: publicFace,
    actions,
    checks
  };
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
    detail: pass ? `${pkg.name}@${pkg.version} is public, has CLI bins, and ships both README surfaces.` : `metadata incomplete: private ${pkg.private === true}, public access ${hasPublicAccess}, missing bins ${missingBin.join(', ') || 'none'}, README ${hasReadme}, zh README ${hasChineseReadme}.`
  });
}

async function npmCliCheck({ npmCommand, cwd, runner }) {
  const result = await runNpm({ npmCommand, args: ['--version'], cwd, runner });
  return checkFromStatus({
    id: 'npm_cli',
    label: 'npm CLI',
    pass: result.ok,
    detail: result.ok ? `${npmCommand} ${result.stdout.trim()} is executable.` : `${npmCommand} is not executable: ${commandMessage(result)}.`,
    output: result
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
        output: result
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

async function githubActionsCheck({ repo, cwd, runner }) {
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
  const runs = await runCommandSafe({ command: 'gh', args: ['run', 'list', '-R', repo, '--limit', '5', '--json', 'databaseId,headSha,status,conclusion,workflowName,createdAt,url'], cwd, runner });
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
  const hasRuns = parsedRuns.length > 0;
  const hasPassingRun = parsedRuns.some((run) => run.conclusion === 'success');
  const pass = permissions.ok && runs.ok && enabled && hasRuns && hasPassingRun;
  const summary = checkFromStatus({
    id: 'github_actions',
    label: 'GitHub Actions',
    pass,
    detail: pass ? `Actions are enabled and ${parsedRuns.length} recent runs include a passing CI run.` : `Actions enabled ${enabled}, recent runs ${parsedRuns.length}, passing runs ${hasPassingRun ? 'yes' : 'no'}, permissions command ${permissions.ok ? 'ok' : 'failed'}, run list ${runs.ok ? 'ok' : 'failed'}.`
  });
  return {
    summary,
    permissions: parsedPermissions,
    runs: parsedRuns,
    errors: {
      permissions: permissions.ok ? undefined : commandMessage(permissions),
      runs: runs.ok ? undefined : commandMessage(runs)
    }
  };
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
  return compact(`${result.stderr || result.stdout || result.message || `exit ${result.code ?? 'unknown'}`}`);
}

function summarizeCommand(result) {
  return {
    ok: result.ok,
    code: result.code,
    stdout: compact(result.stdout),
    stderr: compact(result.stderr),
    message: result.message
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
