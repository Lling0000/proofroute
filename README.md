# ProofRoute

[English](README.md) | [简体中文](README.zh-CN.md)

[![CI](https://github.com/Lling0000/proofroute/actions/workflows/ci.yml/badge.svg)](https://github.com/Lling0000/proofroute/actions/workflows/ci.yml) [![GitHub](https://img.shields.io/badge/github-Lling0000%2Fproofroute-181717?logo=github)](https://github.com/Lling0000/proofroute) [![License](https://img.shields.io/badge/license-MIT-2ea44f)](LICENSE) [![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=nodedotjs)](package.json) [![Dependencies](https://img.shields.io/badge/runtime%20dependencies-zero-0ea5e9)](package.json) [![Proxy](https://img.shields.io/badge/OpenAI-compatible%20proxy-111827)](#proofroute) [![Architecture](https://img.shields.io/badge/architecture-Agent--View--Controller-7c3aed)](docs/architecture.md)

ProofRoute is a CLI-first OpenAI-compatible proxy that routes coding-agent prompts to the cheapest fast-enough model and prints a prompt-free terminal receipt for the decision.

It is built for developers who do not want to pause a Vibe Coding session to compare model menus. ProofRoute inspects the request locally, predicts intent, estimates context and output pressure, checks cost and latency tradeoffs, and forwards the call to the best configured local or cloud model. The result is infrastructure that stays invisible while work is happening, then becomes loud only when it can prove speed, savings, model choice, and privacy in a frame worth sharing.

![ProofRoute terminal proof](docs/proofroute-terminal.svg)

The architecture follows Agent-View-Controller because routing has to be fast, explainable, and easy to harden. The Controller owns local intent recognition, token estimation, context fit checks, cost modeling, latency modeling, and numerically stable Softmax ranking. The Agent owns asynchronous provider execution, OpenAI-compatible forwarding, Ollama adaptation, fallback execution, proxy lifecycle, and benchmark orchestration. The View owns terminal-native proof cards, route traces, Markdown receipts, connection cards, model maps, privacy reports, launch checks, and classifier receipts.

The default experience is intentionally zero configuration. A developer can clone the repository, run the demo, and see a local proof card before any network call, API key, provider setup, or hosted dashboard exists. When the proxy is started, existing SDKs, editor extensions, CLIs, and coding agents can point their OpenAI base URL at ProofRoute and continue using familiar endpoints while the router quietly swaps in the model that fits the task.

## Quick Start

The fastest first run is the demo. It makes no network call, requires no provider credential, and immediately shows the route decision, p95 Controller latency, estimated savings, speed lift, and route mix that define the product.

```sh
node ./bin/proofroute.js demo
```

The package-facing memory hook is `proofroute demo` after the checkout is linked locally or the npm package is publicly available. Until public npm visibility is proven by the publish preflight, the honest copy-paste path is direct Node execution from this repository.

```sh
proofroute demo
```

## Proof Packs

The strongest maintainer first run is the core release proof pack. It needs no API key, calls no external provider, and makes no CUDA, TensorRT, or multi-GPU claim. It proves the repository face, zero-network router value, proxy smoke path, prompt-free privacy boundary, SVG receipt, git provenance, and launch copy that any contributor can reproduce on an ordinary laptop.

```sh
node ./bin/proofroute.js release --core --out proofroute-release-pack
```

When a maintainer wants stronger ordinary-laptop evidence, `npm run classifier:artifact:evidence` and `npm run classifier:artifact:verify` generate and verify `classifier-linear-evidence.json`, then the local artifact proof can be folded into the same no-hardware-claim archive. That path proves a hashed local classifier artifact and benchmark gate while still saying plainly that no CUDA, TensorRT, or multi-GPU hardware claim is being made.

```sh
node ./bin/proofroute.js release --core --require-artifact-evidence --artifact-evidence classifier-linear-evidence.json --max-evidence-age-hours 24 --out proofroute-release-pack
```

Any public hardware acceleration claim has to pass stricter evidence. `node ./bin/proofroute.js doctor --strict-hardware` checks that the classifier is a warmed HTTP sidecar with at least two devices, at least two lanes, and nvidia-smi sourced profiles. `node ./bin/proofroute.js release --preflight --require-evidence --evidence classifier-evidence.json --max-evidence-age-hours 24` explains strict release blockers without writing a proof pack or running proxy smoke unless `--smoke` is explicitly added.

## Daily Workflow

ProofRoute is shaped around terminal proof instead of a hosted dashboard. `node ./bin/proofroute.js share` or `npm run share` turns the zero-network proof into a launch screenshot. `node ./bin/proofroute.js share --markdown` or `npm run share:markdown` creates copy that can live in README sections, PR comments, launch posts, and discussions. `node ./bin/proofroute.js share --svg --out docs/proofroute-terminal.svg` or `npm run share:svg` refreshes the repository hero asset from the same prompt-free proof loop.

Once the proxy is running, `node ./bin/proofroute.js stats --since 1h`, `node ./bin/proofroute.js stats --watch --since 1h`, `node ./bin/proofroute.js privacy --file .proofroute/events.jsonl`, `node ./bin/proofroute.js share --ledger --since 1h --markdown`, `node ./bin/proofroute.js prove --ledger --since 1h --min-requests 20 --max-p95-ms 5 --max-router-overhead-pct 1 --max-classifier-circuit-open 0`, and `node ./bin/proofroute.js tune --since 1h --export tuned-router.json` turn a real coding session into a private proof loop. The ledger stores routing evidence rather than prompt or completion text, so teams can review savings, speed, policy, and privacy without exporting proprietary work.

## OpenAI Proxy

The day-one integration flow is compact. `node ./bin/proofroute.js connect --port 8787` prints the OpenAI-compatible base URL and verification commands, while `eval "$(node ./bin/proofroute.js connect --shell sh)"` injects the same environment into the current shell. When the first executable model already lives behind LM Studio, vLLM, or another local OpenAI-compatible gateway, `node ./bin/proofroute.js connect --local-openai http://127.0.0.1:1234/v1 --local-openai-model qwen3` emits the client-side OpenAI variables and the proxy-side `PROOFROUTE_LOCAL_OPENAI_*` exports so the first routed request does not depend on `router.json`.

```sh
node ./bin/proofroute.js connect --port 8787
eval "$(node ./bin/proofroute.js connect --shell sh)"
```

The transparent proxy serves `/v1/chat/completions`, `/v1/completions`, `/v1/responses`, `/v1/models`, and `/ready`. It exposes browser-readable proof headers for final model, requested model, model swap state, routing policy, intent, decision latency, router overhead, cache state, classifier backend, classifier circuit state, fallback, estimated savings, actual token count, and actual savings whenever the upstream returns usage metadata.

```sh
node ./bin/proofroute.js proxy --port 8787 --config examples/router.json
```

## Routing Proof

The fastest way to understand one prompt is `route`. It prints detected intent, resolved policy, selected model, viable alternatives, Softmax probabilities, estimated latency, estimated cost, and savings against the most expensive viable baseline. Trace mode adds the weighted quality, context, local, requested-model, cost, and latency contributions, plus the models filtered out by context, executability, budget, or latency ceilings.

```sh
node ./bin/proofroute.js route --trace --prompt "Refactor this webhook, explain the bug, and write a regression test."
```

Broader local evidence comes from `bench`, `calibrate`, `plan`, and `fanout`. The benchmark reports p50 and p95 Controller latency plus money saved and speed gained. Calibration reports labeled intent accuracy, savings, average speedup, intent mix, and model mix. Planning turns one complex request into multi-agent role routing before provider calls happen. Fanout batches executable role decisions in one Controller pass and dispatches them in parallel through configured providers.

## Command Surface

The everyday command surface is intentionally headless. `demo` creates the zero-network first impression. `share` turns that proof into screenshots, Markdown, SVG, or ledger-backed receipts. `prove` converts latency, overhead, savings, speed, request volume, accuracy, and classifier-circuit thresholds into a failing gate. `connect` prints drop-in proxy setup. `models` renders executable local and cloud coverage. `smoke` verifies runtime or transparent proxy compatibility with a fake provider. `stats` and `privacy` turn local telemetry into prompt-free evidence. `doctor` checks runtime, providers, telemetry, classifier, sidecar, and routing policy. `tune` recommends a reviewed policy patch from observed traffic. `publish` checks the package, npm, public GitHub, public npm, authenticated GitHub, and Actions surface before release copy tells people to install anything.

The detailed operator story lives in the executable commands instead of a static dashboard. Run `node ./bin/proofroute.js --help` for the current CLI map, `node ./bin/proofroute.js profile` for the repository face, `node ./bin/proofroute.js launch` for a prompt-free launch readiness card, and `node ./bin/proofroute.js publish --check-public --check-actions` for the public release gate. The publish gate emits machine-readable `blockers` and `nextActions` so npm auth failures, GitHub account visibility restrictions, anonymous public 404s, and disabled Actions runs become a release checklist instead of a vague red terminal. Adding `--probe-actions-dispatch` to `publish` deliberately attempts a workflow dispatch and records account-level Actions blockers when GitHub refuses the run.

## Configuration And Privacy

Configuration stays plain JSON because routing policy should be inspectable and copyable. Providers define execution endpoints, credentials, and protocol shape. Models define context window, price, median latency, throughput, locality, provider, endpoint, and per-intent quality. The default catalog is useful for demonstration rather than universal truth, and production teams should replace prices and latencies with their own observed telemetry.

```sh
node ./bin/proofroute.js init > router.json
```

For local OpenAI-compatible gateways, `node ./bin/proofroute.js init --preset local-openai > router.json` emits the same executable shape as `examples/local-openai-router.json`, including `requiresApiKey: false`, local policy bias, and a command-backed classifier example. The faster environment-only path is `PROOFROUTE_LOCAL_OPENAI_BASE_URL`, with optional model, context, latency, and throughput variables that let a private LM Studio, vLLM, or model server become a routable zero-price candidate without a JSON file.

The proxy writes `.proofroute/events.jsonl` as a privacy-preserving routing ledger by default. It records timestamp, requested model, final model, model swap state, provider, locality, resolved policy, intent, classifier backend, confidence, token estimates, cost estimates, savings, speedup, decision latency, router overhead, end-to-end latency, streaming mode, and status code. When a non-streaming upstream returns usage metadata, it can also record actual input tokens, output tokens, total tokens, routed cost, baseline cost, and actual savings, but it does not store prompt or completion text.

## Classifier Acceleration

The built-in classifier is compact, deterministic, and zero dependency. It uses weighted lexical features, prompt shape signals, token pressure, and stable probability mass to choose among code, reasoning, writing, extraction, long-context, and chat intents. The interface is intentionally shaped so ONNX, TensorRT, vLLM, private embedding code, or another warm local classifier can replace scoring internals without changing the proxy, evidence, or terminal views.

![ProofRoute classifier accelerator proof](docs/proofroute-classifier.svg)

Persistent local accelerators attach through `PROOFROUTE_CLASSIFIER_URL` or `classifier.url`. The bundled `proofroute-classifier` sidecar exposes `GET /health`, `GET /ready`, `GET /metrics`, `POST /warmup`, `POST /classify`, and `POST /classify/batch`, reports backend, scheduler, warmup, batch, lane, device profile, request, error, uptime, inflight, and decision-time metadata, and can use device profiles from environment fields or a bounded `nvidia-smi` startup probe. Public CUDA, TensorRT, or multi-GPU copy must come from `npm run classifier:hardware:evidence` and `npm run classifier:hardware:verify`, while ordinary laptops can use the artifact-only verifier without making a hardware claim.

```sh
PROOFROUTE_CLASSIFIER_URL=http://127.0.0.1:8788/classify node ./bin/proofroute.js route --prompt "Refactor this function and add a regression test."
```

The example accelerator path is practical rather than decorative. `examples/accelerator-worker.js` defines the hot NDJSON worker protocol, `examples/linear-accelerator-module.js` proves a local model artifact with stable Softmax, `examples/onnx-accelerator-module.js` shows the optional ONNX Runtime shape, and `examples/tensorrt-accelerator-module.js` defines the TensorRT engine contract for machines that build their own serialized engine. `proofroute learn`, `examples/train-linear-intent-model.js`, and `examples/export-linear-intent-onnx.js` close the loop from labeled samples to reviewed classifier artifacts.

## Development And Release

Tests focus on the pieces where correctness matters most: numerical stability, intent recognition, route economics, proxy compatibility, privacy boundaries, public repository metadata, publish readiness, release proof packs, and classifier evidence. Run the suite with the built-in Node test runner.

```sh
node --test
```

Repository copy is generated and checked by `node ./bin/proofroute.js profile`. Release readiness is checked by `node ./bin/proofroute.js launch`, while `node ./bin/proofroute.js launch --check-public` adds no-credential GitHub and npm visibility. The final publish-facing gate is `node ./bin/proofroute.js publish --check-public --check-actions` or `npm run publish:preflight`, which checks package metadata, npm CLI availability, npm pack dry-run contents, npm publish dry-run stability, npm registry identity, authenticated GitHub visibility, anonymous GitHub visibility, public npm visibility, and recent GitHub Actions evidence before public install copy is trusted.

The shareable core archive is `node ./bin/proofroute.js release --core --out proofroute-release-pack` or `npm run release:core`. It writes repository metadata, launch readiness JSON, git provenance, paragraph-only release prose, prompt-free launch copy, copied SVG proof assets, and an explicit no-accelerator-claim classifier state into one folder for release notes, pull requests, and launch posts. Strict hardware release paths require fresh classifier evidence with the hardware probe gate before accelerator claims can pass.

ProofRoute is meant to be open source infrastructure with a shareable heartbeat. The strongest demo is not a slide or a landing page; it is a terminal capture where a real prompt is routed in milliseconds, a local model wins when it should, a premium model wins when the task deserves it, and exact savings appear in the same frame as the engineering decision.

## License

MIT. See [LICENSE](LICENSE).
