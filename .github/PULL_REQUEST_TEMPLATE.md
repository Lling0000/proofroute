# ProofRoute Pull Request

Explain which proof loop this change improves and why the repository should carry it. The strongest description names the affected surface, such as route, proxy, classifier, ledger, training, terminal view, documentation, or public metadata, and then describes the developer experience before and after the change in one tight paragraph.

Paste the command evidence that proves the change. A small change can cite focused `node --test` output, `npm run check`, or the direct Node equivalent when a package manager is unavailable, while a routing, proxy, classifier, or terminal change should include the local proof command that demonstrates latency, savings, warmup, device metadata, privacy, or compatibility. If evidence is intentionally not available, explain the exact reason and the residual risk.

Call out the privacy boundary touched by this pull request. ProofRoute should keep prompt text, completion text, credentials, and private provider endpoints out of telemetry, launch artifacts, and social proof unless a maintainer has explicitly chosen otherwise for a synthetic local fixture.

Describe any public-facing copy or repository-face change included here. README, package metadata, GitHub topics, social preview assets, contribution guidance, and terminal receipts should stay aligned with the promise that ProofRoute is a CLI-first OpenAI-compatible router that proves speed and cost wins without becoming a hosted dashboard.
