---
name: ProofRoute bug report
about: Report a routing, proxy, classifier, ledger, or terminal proof problem with local evidence.
title: ""
labels: bug
assignees: ""
---

Describe the failure in one clear paragraph. The most useful report names the command or OpenAI-compatible request that failed, the expected proof loop, the actual route or proxy behavior, and whether the issue touched routing, provider execution, classifier acceleration, telemetry, terminal rendering, or repository metadata.

Paste the smallest local command evidence that reproduces the problem. Useful evidence can come from `node --test`, `node ./bin/proofroute.js route --trace`, `node ./bin/proofroute.js smoke --proxy`, `node ./bin/proofroute.js classifier --bench --warmup`, `node ./bin/proofroute.js stats --since 1h`, or a sanitized HTTP response showing ProofRoute headers. Keep proprietary prompts, completions, credentials, private endpoints, and customer data out of the report unless they are synthetic fixtures created only for reproduction.

Describe the runtime shape where the failure happens. Include Node version, operating system, local model gateway if relevant, classifier mode if relevant, sidecar readiness if relevant, and whether the route uses local, cloud, streaming, fallback, or virtual policy models. If the problem only appears with an external accelerator, explain the sidecar backend, lanes, device profile labels, warmup state, and proof gate that failed.

Explain the user-visible impact. The fastest triage path is a concrete sentence about whether ProofRoute selected the wrong model, became slower than the request it was protecting, leaked proof data that should have stayed private, failed to expose evidence, broke OpenAI-compatible behavior, or made the public repository story less trustworthy.
