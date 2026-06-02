import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';

const githubDescription = 'CLI-first OpenAI-compatible LLM router/proxy for coding agents that picks the cheapest fast-enough model and proves speed, savings, and prompt-free privacy.';

const githubTopics = [
  'llm-router',
  'ai-router',
  'inference-router',
  'openai-compatible',
  'transparent-proxy',
  'local-llm',
  'local-first',
  'prompt-privacy',
  'cost-optimization',
  'coding-agent',
  'vibe-coding',
  'model-router',
  'prompt-routing',
  'model-selection',
  'llm-proxy',
  'ai-gateway',
  'llm-gateway',
  'gpu-classifier',
  'tensorrt',
  'terminal-ui'
];

const readmeBadges = Object.freeze([
  Object.freeze({
    id: 'proof',
    alt: 'Proof',
    image: 'https://img.shields.io/badge/local%20proof-zero--network-22c55e',
    target: '#quick-start'
  }),
  Object.freeze({
    id: 'github',
    alt: 'GitHub',
    image: 'https://img.shields.io/badge/github-Lling0000%2Fproofroute-181717?logo=github',
    target: 'https://github.com/Lling0000/proofroute'
  }),
  Object.freeze({
    id: 'license',
    alt: 'License',
    image: 'https://img.shields.io/badge/license-MIT-2ea44f',
    target: 'LICENSE'
  }),
  Object.freeze({
    id: 'node',
    alt: 'Node',
    image: 'https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs',
    target: 'package.json'
  }),
  Object.freeze({
    id: 'dependencies',
    alt: 'Dependencies',
    image: 'https://img.shields.io/badge/runtime%20dependencies-zero-0ea5e9',
    target: 'package.json'
  }),
  Object.freeze({
    id: 'proxy',
    alt: 'Proxy',
    image: 'https://img.shields.io/badge/OpenAI-compatible%20proxy-111827',
    target: '#proofroute'
  }),
  Object.freeze({
    id: 'architecture',
    alt: 'Architecture',
    image: 'https://img.shields.io/badge/architecture-Agent--View--Controller-7c3aed',
    target: 'docs/architecture.md'
  })
]);

const social = {
  preview: 'docs/proofroute-terminal.svg',
  acceleratorPreview: 'docs/proofroute-classifier.svg',
  benchmarkPreview: 'docs/proofroute-classifier-benchmark.svg',
  badges: readmeBadges,
  shortPitch: 'ProofRoute is a zero-dependency OpenAI-compatible proxy that routes every coding-agent prompt to the cheapest fast-enough local or cloud model, then prints a terminal receipt with p95 router latency, speed lift, and exact savings without logging prompt text.',
  vibePitch: 'Point your coding agent at one local OpenAI-compatible endpoint, let ProofRoute pick the right model before you notice the choice, and keep a prompt-free receipt of what got faster and cheaper.'
};

const commands = {
  firstProof: 'node ./bin/proofroute.js demo',
  publicFace: 'node ./bin/proofroute.js profile --check-public',
  npmDryRun: 'npm run release:npm:dry-run',
  publishPreflight: 'node ./bin/proofroute.js publish --check-public --check-actions',
  publishSupportNote: 'node ./bin/proofroute.js publish --check-public --check-actions --probe-actions-dispatch --support-note',
  publishSupportPack: 'node ./bin/proofroute.js publish --check-public --check-actions --probe-actions-dispatch --support-pack proofroute-publish-support-pack',
  coreLaunch: 'node ./bin/proofroute.js launch --core',
  publicLaunch: 'node ./bin/proofroute.js launch --check-public',
  launchReadiness: 'node ./bin/proofroute.js launch',
  launchEvidenceGate: 'node ./bin/proofroute.js launch --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24',
  coreReleasePack: 'node ./bin/proofroute.js release --core --out proofroute-release-pack',
  artifactReleasePack: 'node ./bin/proofroute.js release --core --require-artifact-evidence --artifact-evidence classifier-linear-evidence.json --max-evidence-age-hours 24 --out proofroute-release-pack',
  releaseStrictPreflight: 'node ./bin/proofroute.js release --preflight --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24',
  publicReleasePreflight: 'node ./bin/proofroute.js release --preflight --core --check-public',
  shareSvg: 'node ./bin/proofroute.js share --svg --out docs/proofroute-terminal.svg',
  privacyProof: 'node ./bin/proofroute.js privacy --file .proofroute/events.jsonl',
  repairLedger: 'node ./bin/proofroute.js repair --file .proofroute/events.jsonl --out .proofroute/events.repaired.jsonl',
  hardwareDoctor: 'node ./bin/proofroute.js doctor --strict-hardware',
  acceleratorSvg: 'node ./bin/proofroute.js classifier --warmup --svg --out docs/proofroute-classifier.svg',
  acceleratorBenchmarkSvg: 'node ./bin/proofroute.js classifier --bench --warmup --min-devices 2 --min-lanes 2 --require-device-profiles --svg --out docs/proofroute-classifier-benchmark.svg',
  artifactEvidenceGate: 'npm run classifier:artifact:evidence && npm run classifier:artifact:verify',
  linearEvidenceGate: 'npm run classifier:linear:sidecar, then npm run classifier:linear:evidence && npm run classifier:linear:verify',
  hardwareProbeGate: 'node ./bin/proofroute.js classifier --bench --warmup --min-devices 2 --min-lanes 2 --require-device-profiles --require-hardware-probe --evidence --json --out classifier-evidence.json',
  hardwareEvidenceVerify: 'node ./bin/proofroute.js classifier --verify-evidence classifier-evidence.json --require-hardware-probe --max-evidence-age-hours 24',
  proofGate: 'node ./bin/proofroute.js prove --max-p95-ms 5 --min-accuracy 0.8',
  ledgerProofGate: 'node ./bin/proofroute.js prove --ledger --min-requests 20 --max-p95-ms 5 --max-router-overhead-pct 1 --max-classifier-circuit-open 0'
};

export async function repositoryProfileReport({ packagePath = new URL('../../package.json', import.meta.url) } = {}) {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  const npmKeywords = Array.isArray(pkg.keywords) ? pkg.keywords : [];
  const homepage = pkg.homepage;
  return {
    generatedAt: new Date().toISOString(),
    github: {
      description: githubDescription,
      topics: githubTopics,
      topicLine: githubTopics.join(', '),
      homepage,
      repository: repositorySlugFromUrl(pkg.repository?.url)
    },
    npm: {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      keywords: npmKeywords,
      keywordLine: npmKeywords.join(', '),
      homepage,
      repository: pkg.repository?.url
    },
    social,
    commands,
    privacy: 'Repository copy should keep the proof loop prompt-free: publish routing receipts, classifier evidence, device metadata, repaired ledger artifacts, and aggregate savings without shipping prompt text, completion text, credentials, private provider endpoints, or the original ledger when repair was required.'
  };
}

export function desiredGithubRepositoryState(profile) {
  return {
    repository: profile.github.repository,
    description: profile.github.description,
    homepage: profile.github.homepage,
    topics: normalizeTopics(profile.github.topics)
  };
}

export async function githubRepositoryStateReport({ mode = 'check', repo, packagePath, token, tokenEnv, env = process.env, fetchImpl = globalThis.fetch, execFileImpl = execFile } = {}) {
  const profile = await repositoryProfileReport({ packagePath });
  const desired = desiredGithubRepositoryState(profile);
  const repository = repo ?? desired.repository;
  if (!repository) throw new Error('GitHub repository is required. Pass --repo owner/name or set package.json repository to a GitHub URL.');
  const resolvedToken = await resolveGithubToken({ token, tokenEnv, env, execFileImpl });
  if (!resolvedToken) throw new Error('GitHub token is required. Set GH_TOKEN or GITHUB_TOKEN, or run gh auth login so proofroute can read gh auth token.');
  const before = await readGithubRepositoryState({ repo: repository, token: resolvedToken, fetchImpl });
  const beforeComparison = compareGithubRepositoryState(desired, before);
  let current = before;
  let comparison = beforeComparison;
  const operations = [];
  if (mode === 'sync' && beforeComparison.status === 'fail') {
    if (!beforeComparison.checks.find((check) => check.id === 'description')?.pass || !beforeComparison.checks.find((check) => check.id === 'homepage')?.pass) {
      await updateGithubRepositoryMetadata({ repo: repository, token: resolvedToken, fetchImpl, desired });
      operations.push('metadata');
    }
    if (!beforeComparison.checks.find((check) => check.id === 'topics')?.pass) {
      await replaceGithubRepositoryTopics({ repo: repository, token: resolvedToken, fetchImpl, topics: desired.topics });
      operations.push('topics');
    }
    current = await readGithubRepositoryState({ repo: repository, token: resolvedToken, fetchImpl });
    comparison = compareGithubRepositoryState(desired, current);
  }
  return {
    kind: 'proofroute-github-repository-face-v1',
    generatedAt: new Date().toISOString(),
    mode,
    status: comparison.status,
    repository,
    url: current.url,
    desired,
    current,
    before: mode === 'sync' ? before : undefined,
    operations,
    changed: operations.length > 0,
    comparison,
    beforeComparison: mode === 'sync' ? beforeComparison : undefined
  };
}

export async function publicRepositoryFaceReport({ packagePath, fetchImpl = globalThis.fetch } = {}) {
  const profile = await repositoryProfileReport({ packagePath });
  const desired = desiredGithubRepositoryState(profile);
  const checks = [];
  const badges = await readmeBadgeReport({ fetchImpl, checkImages: true });
  checks.push(publicCheck({
    id: 'readme_badges',
    label: 'README badges',
    pass: badges.missing.length === 0,
    detail: `${badges.present.length}/${badges.expected.length} expected first-screen badges are declared in README.md.`
  }));
  checks.push(publicCheck({
    id: 'badge_images',
    label: 'public badge images',
    severity: 'advisory',
    pass: badges.images.length > 0 && badges.images.every((image) => image.pass),
    detail: `${badges.images.filter((image) => image.pass).length}/${badges.images.length} badge images returned public success responses without credentials; badge reachability is advisory because third-party badge services can be transient.`
  }));
  const owner = desired.repository?.split('/')[0];
  const githubOwner = await publicGithubOwnerState({ owner, fetchImpl });
  checks.push(publicCheck({
    id: 'github_owner_public',
    label: 'public GitHub owner',
    pass: githubOwner.ok === true,
    detail: githubOwner.status === 200 ? `${owner} is visible without credentials.` : `${owner ?? 'unknown owner'} returned HTTP ${githubOwner.status ?? 'error'} without credentials.`
  }));
  const github = await publicGithubState({ repo: desired.repository, fetchImpl });
  checks.push(publicCheck({
    id: 'github_public',
    label: 'public GitHub repository',
    pass: github.ok === true,
    detail: github.status === 200 ? `${desired.repository} is visible without credentials.` : `${desired.repository} returned HTTP ${github.status ?? 'error'} without credentials.`
  }));
  const githubComparison = github.payload ? compareGithubRepositoryState(desired, {
    repository: desired.repository,
    description: github.payload.description ?? '',
    homepage: github.payload.homepage ?? '',
    topics: github.payload.topics ?? []
  }) : undefined;
  checks.push(publicCheck({
    id: 'github_metadata',
    label: 'public GitHub metadata',
    pass: githubComparison?.status === 'pass',
    detail: githubComparison ? `${githubComparison.missingTopics.length} missing topics, ${githubComparison.extraTopics.length} extra topics, description ${githubComparison.checks.find((check) => check.id === 'description')?.pass ? 'matches' : 'drifts'}, homepage ${githubComparison.checks.find((check) => check.id === 'homepage')?.pass ? 'matches' : 'drifts'}.` : 'Public GitHub metadata could not be compared.'
  }));
  const npm = await publicNpmState({ name: profile.npm.name, fetchImpl });
  checks.push(publicCheck({
    id: 'npm_public',
    label: 'public npm package',
    pass: npm.ok === true,
    detail: npm.status === 200 ? `${profile.npm.name} is visible on the npm registry.` : `${profile.npm.name} returned HTTP ${npm.status ?? 'error'} from the npm registry.`
  }));
  const npmLatestVersion = npm.payload?.['dist-tags']?.latest;
  const npmVersionMatches = npmLatestVersion === profile.npm.version;
  checks.push(publicCheck({
    id: 'npm_version',
    label: 'public npm version',
    pass: npm.ok === true && npmVersionMatches,
    detail: npm.ok === true ? `latest ${npmLatestVersion ?? 'unknown'}, local ${profile.npm.version}, version ${npmVersionMatches ? 'matches' : 'drifts'}.` : 'Public npm version could not be compared.'
  }));
  const npmLatest = npm.payload?.versions?.[npm.payload?.['dist-tags']?.latest];
  const npmDescriptionMatches = normalizeText(npmLatest?.description ?? npm.payload?.description) === normalizeText(profile.npm.description);
  const npmRepositoryMatches = repositorySlugFromUrl(npmLatest?.repository?.url ?? npm.payload?.repository?.url) === profile.github.repository;
  checks.push(publicCheck({
    id: 'npm_metadata',
    label: 'public npm metadata',
    pass: npm.ok === true && npmDescriptionMatches && npmRepositoryMatches,
    detail: npm.ok === true ? `description ${npmDescriptionMatches ? 'matches' : 'drifts'}, repository ${npmRepositoryMatches ? 'matches' : 'drifts'}.` : 'Public npm metadata could not be compared.'
  }));
  return {
    kind: 'proofroute-public-repository-face-v1',
    generatedAt: new Date().toISOString(),
    status: checks.filter((check) => check.severity !== 'advisory').every((check) => check.pass) ? 'pass' : 'fail',
    repository: desired.repository,
    npmPackage: profile.npm.name,
    github: {
      url: `https://github.com/${desired.repository}`,
      apiUrl: `https://api.github.com/repos/${desired.repository}`,
      owner: {
        login: owner,
        url: owner ? `https://github.com/${owner}` : undefined,
        apiUrl: owner ? `https://api.github.com/users/${owner}` : undefined,
        status: githubOwner.status,
        message: githubOwner.message,
        reason: githubOwner.reason
      },
      status: github.status,
      message: github.message,
      reason: github.reason,
      comparison: githubComparison
    },
    npm: {
      url: `https://www.npmjs.com/package/${profile.npm.name}`,
      registryUrl: `https://registry.npmjs.org/${profile.npm.name}`,
      status: npm.status,
      message: npm.message,
      reason: npm.reason,
      latest: npm.payload?.['dist-tags']?.latest
    },
    badges,
    checks
  };
}

export async function readmeBadgeReport({ readmePath = new URL('../../README.md', import.meta.url), fetchImpl = globalThis.fetch, checkImages = false } = {}) {
  let readme = '';
  let readError;
  try {
    readme = await readFile(readmePath, 'utf8');
  } catch (error) {
    readError = error.message;
  }
  const expected = readmeBadges.map((badge) => ({ ...badge, markdown: badgeMarkdown(badge) }));
  const present = expected.filter((badge) => readme.includes(badge.markdown));
  const missing = expected.filter((badge) => !readme.includes(badge.markdown));
  const images = checkImages ? await Promise.all(expected.map(async (badge) => {
    const result = await publicFetchStatus(badge.image, fetchImpl, {
      accept: 'image/svg+xml,image/*,*/*',
      'user-agent': 'proofroute-public-face'
    });
    return {
      id: badge.id,
      url: badge.image,
      status: result.status,
      pass: result.ok === true,
      reason: result.reason,
      message: result.message
    };
  })) : [];
  return {
    kind: 'proofroute-readme-badges-v1',
    status: missing.length === 0 ? 'pass' : 'fail',
    imageStatus: !checkImages || images.every((image) => image.pass) ? 'pass' : 'warn',
    readmePath: String(readmePath),
    expected,
    present,
    missing,
    images,
    message: readError
  };
}

export async function readGithubRepositoryState({ repo, token, fetchImpl = globalThis.fetch }) {
  const metadata = await githubApi({ repo, token, fetchImpl, path: '' });
  const topics = await githubApi({ repo, token, fetchImpl, path: '/topics' });
  return {
    repository: repo,
    url: metadata.html_url,
    description: metadata.description ?? '',
    homepage: metadata.homepage ?? '',
    topics: normalizeTopics(topics.names ?? metadata.topics ?? [])
  };
}

export async function updateGithubRepositoryMetadata({ repo, token, fetchImpl = globalThis.fetch, desired }) {
  return githubApi({
    repo,
    token,
    fetchImpl,
    path: '',
    method: 'PATCH',
    body: {
      description: desired.description,
      homepage: desired.homepage
    }
  });
}

export async function replaceGithubRepositoryTopics({ repo, token, fetchImpl = globalThis.fetch, topics }) {
  return githubApi({
    repo,
    token,
    fetchImpl,
    path: '/topics',
    method: 'PUT',
    body: {
      names: normalizeTopics(topics)
    }
  });
}

export function compareGithubRepositoryState(desired, current) {
  const desiredTopics = normalizeTopics(desired.topics);
  const currentTopics = normalizeTopics(current.topics);
  const missingTopics = desiredTopics.filter((topic) => !currentTopics.includes(topic));
  const extraTopics = currentTopics.filter((topic) => !desiredTopics.includes(topic));
  const checks = [
    {
      id: 'description',
      label: 'description',
      pass: normalizeText(current.description) === normalizeText(desired.description),
      desired: desired.description,
      current: current.description ?? ''
    },
    {
      id: 'homepage',
      label: 'homepage',
      pass: normalizeText(current.homepage) === normalizeText(desired.homepage),
      desired: desired.homepage,
      current: current.homepage ?? ''
    },
    {
      id: 'topics',
      label: 'topics',
      pass: missingTopics.length === 0 && extraTopics.length === 0,
      desired: desiredTopics,
      current: currentTopics,
      missing: missingTopics,
      extra: extraTopics
    }
  ];
  return {
    status: checks.every((check) => check.pass) ? 'pass' : 'fail',
    checks,
    missingTopics,
    extraTopics
  };
}

export function repositorySlugFromUrl(value) {
  const text = String(value ?? '').trim().replace(/^git\+/, '').replace(/\.git$/, '');
  const match = text.match(/github\.com[:/]([^/\s]+)\/([^/#?\s]+)/i);
  if (!match) return undefined;
  return `${match[1]}/${match[2].replace(/\.git$/, '')}`;
}

async function githubApi({ repo, token, fetchImpl, path, method = 'GET', body }) {
  if (!fetchImpl) throw new Error('fetch is unavailable; use Node.js 20 or pass a fetch implementation.');
  const response = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'proofroute-repository-profile'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload.message ? `: ${payload.message}` : '';
    throw new Error(`GitHub ${method} /repos/${repo}${path || ''} failed with ${response.status}${message}`);
  }
  return payload;
}

async function publicGithubState({ repo, fetchImpl }) {
  return publicJson(`https://api.github.com/repos/${repo}`, fetchImpl, {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'proofroute-public-face'
  });
}

async function publicGithubOwnerState({ owner, fetchImpl }) {
  if (!owner) return { status: undefined, ok: false, reason: 'missing_owner', message: 'missing owner' };
  return publicJson(`https://api.github.com/users/${owner}`, fetchImpl, {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'proofroute-public-face'
  });
}

async function publicNpmState({ name, fetchImpl }) {
  return publicJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`, fetchImpl, {
    accept: 'application/json',
    'user-agent': 'proofroute-public-face'
  });
}

function badgeMarkdown(badge) {
  return `[![${badge.alt}](${badge.image})](${badge.target})`;
}

async function publicFetchStatus(url, fetchImpl, headers) {
  if (!fetchImpl) return { status: undefined, ok: false, reason: 'fetch_unavailable', message: 'fetch is unavailable' };
  try {
    const response = await fetchWithTimeout(fetchImpl, url, { headers });
    return {
      status: response.status,
      ok: response.ok,
      reason: response.ok ? undefined : httpFailureReason(response.status, response.statusText),
      message: response.ok ? undefined : response.statusText
    };
  } catch (error) {
    return { status: undefined, ok: false, reason: error.name === 'AbortError' ? 'timeout' : 'network_error', message: error.message };
  }
}

async function publicJson(url, fetchImpl, headers) {
  if (!fetchImpl) return { status: undefined, ok: false, reason: 'fetch_unavailable', message: 'fetch is unavailable' };
  try {
    const response = await fetchWithTimeout(fetchImpl, url, { headers });
    const text = await response.text();
    let payload;
    let parseError = false;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      parseError = true;
      payload = undefined;
    }
    if (response.ok && parseError) {
      return {
        status: response.status,
        ok: false,
        reason: 'bad_json',
        message: 'invalid JSON response'
      };
    }
    return {
      status: response.status,
      ok: response.ok,
      payload: response.ok ? payload : undefined,
      reason: response.ok ? undefined : httpFailureReason(response.status, payload?.message ?? payload?.error ?? response.statusText),
      message: response.ok ? undefined : payload?.message ?? payload?.error ?? response.statusText
    };
  } catch (error) {
    return { status: undefined, ok: false, reason: error.name === 'AbortError' ? 'timeout' : 'network_error', message: error.message };
  }
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs = 7000) {
  if (typeof AbortController === 'undefined') return fetchImpl(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function httpFailureReason(status, message = '') {
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 403 && /rate limit/i.test(String(message))) return 'rate_limited';
  return 'http_error';
}

function publicCheck({ id, label, pass, detail, severity = 'required' }) {
  return {
    id,
    label,
    severity,
    pass: Boolean(pass),
    detail
  };
}

async function resolveGithubToken({ token, tokenEnv, env, execFileImpl }) {
  if (typeof token === 'string' && token.trim()) return token.trim();
  if (tokenEnv && env?.[tokenEnv]) return String(env[tokenEnv]).trim();
  if (env?.GH_TOKEN) return String(env.GH_TOKEN).trim();
  if (env?.GITHUB_TOKEN) return String(env.GITHUB_TOKEN).trim();
  try {
    const { stdout } = await execFilePromise(execFileImpl, 'gh', ['auth', 'token'], { timeout: 2000 });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

function execFilePromise(execFileImpl, file, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function normalizeTopics(topics) {
  return [...new Set((topics ?? []).map((topic) => String(topic).trim().toLowerCase()).filter(Boolean))].sort();
}

function normalizeText(value) {
  return String(value ?? '').trim();
}
