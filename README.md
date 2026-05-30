# ProofRoute

[English](README.md) | [简体中文](README.zh-CN.md)

> Route every OpenAI-shaped request to the cheapest fast-enough model, prove the decision in your terminal, and keep prompt text on your machine.

[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Zero runtime deps](https://img.shields.io/badge/runtime_deps-0-111111)](package.json)
[![OpenAI compatible proxy](https://img.shields.io/badge/proxy-OpenAI--compatible-412991)](#drop-in-openai-proxy)
[![Local telemetry](https://img.shields.io/badge/telemetry-local_JSONL-0f766e)](#privacy-model)

ProofRoute is a CLI-first model router for developers who would rather ship than stare at model menus. It runs as a transparent OpenAI-compatible proxy, classifies each prompt locally, estimates context, latency, and cost, then routes to the model with the best quality/price/speed tradeoff.

The first run is deliberately boring in the best possible way: no dashboard, no account, no hosted telemetry, no runtime dependencies. Just a terminal receipt that says which model won and why.

```sh
node ./bin/proofroute.js share --markdown
```

```text
proofroute routed 5 prompts before any provider call, with 0.31ms p95 decision time, $0.019173 estimated savings, 1.64x estimated speedup, and 100.0% labeled intent accuracy.

Copy line: I routed 5 prompts with proofroute in 0.31ms p95 decision time, saved $0.019173, and got 1.64x estimated speedup before any provider call.
```

## Why Developers Star It

- **Drop-in proxy**: point OpenAI-compatible SDKs, agents, editor extensions, and CLI tools at `http://127.0.0.1:8787/v1`.
- **Terminal proof**: every route can show intent, selected model, alternatives, cost delta, speed delta, p95 decision time, and CI gates.
- **Private by default**: the proxy ledger stores routing evidence, timing, status, token counts, and savings, not prompt or completion text.
- **Local plus cloud**: route across Ollama, OpenAI-compatible local gateways such as LM Studio/vLLM, OpenAI-shaped cloud providers, and configured fallback models.
- **No dependency maze**: the package uses modern Node.js for the CLI, HTTP server, fetch client, tests, and performance timers.
- **Built to tune**: run real traffic, inspect the local JSONL ledger, and export a reviewed routing-policy patch instead of accepting a black box.

## 30-Second Quick Start

```sh
git clone <your-fork-or-checkout-url>
cd proofroute
node --version # requires Node.js >=20

# Zero-network launch proof.
node ./bin/proofroute.js demo
node ./bin/proofroute.js share --markdown

# CI-shaped gate for the public claim.
node ./bin/proofroute.js prove --max-p95-ms 5 --min-accuracy 0.8
```

Want a config file first?

```sh
node ./bin/proofroute.js init > router.json
node ./bin/proofroute.js models --config router.json
node ./bin/proofroute.js doctor --config router.json
```

Starting from LM Studio, vLLM, or another local OpenAI-compatible server?

```sh
node ./bin/proofroute.js init --preset local-openai > router.json
node ./bin/proofroute.js doctor --config router.json
```

The local OpenAI preset mirrors [examples/local-openai-router.json](examples/local-openai-router.json): no API key required, local policy bias, a local model entry, and a command-backed classifier example.

## Drop-In OpenAI Proxy

Start ProofRoute once:

```sh
node ./bin/proofroute.js proxy --port 8787 --config examples/router.json
```

Point existing tools at it:

```sh
export OPENAI_BASE_URL=http://127.0.0.1:8787/v1
export OPENAI_API_BASE=http://127.0.0.1:8787/v1
export OPENAI_API_KEY=proofroute-local
```

Or let the CLI print the exact connection card:

```sh
node ./bin/proofroute.js connect --port 8787
eval "$(node ./bin/proofroute.js connect --shell sh)"
```

ProofRoute serves:

| Endpoint | Purpose |
| --- | --- |
| `/v1/chat/completions` | Routed chat completions, including streaming |
| `/v1/completions` | Legacy completions adapted through the routed chat path |
| `/v1/responses` | Simple Responses API requests routed through the same engine |
| `/v1/models` | Executable model discovery for configured providers |
| `/ready` | Operational readiness check |

Proxy responses expose browser-readable routing headers for the selected model, detected intent, decision latency, cache state, fallback switch, estimated savings, actual token count, actual routed cost, and actual savings when upstream usage metadata is available.

## Terminal Proof Loop

Use `route` when you want to understand one prompt:

```sh
node ./bin/proofroute.js route \
  --trace \
  --prompt "Refactor this webhook, explain the bug, and write a regression test."
```

Use `bench`, `calibrate`, and `prove` when you want evidence that survives a screenshot, a PR comment, or CI:

```sh
node ./bin/proofroute.js bench --prompt "Audit this migration plan." --runs 9
node ./bin/proofroute.js calibrate --file examples/samples.json
node ./bin/proofroute.js prove --max-p95-ms 5 --min-accuracy 0.8
```

After real proxy traffic, turn the local ledger into a receipt:

```sh
node ./bin/proofroute.js stats
node ./bin/proofroute.js share --ledger --markdown
node ./bin/proofroute.js prove --ledger --min-requests 20 --max-p95-ms 5
node ./bin/proofroute.js tune --export tuned-router.json
```

## Privacy Model

ProofRoute is designed to make routing auditable without making your prompts portable.

- Prompt classification runs locally by default through a deterministic, dependency-free classifier.
- The route cache uses prompt fingerprints rather than storing prompt text on disk.
- The proxy writes `.proofroute/events.jsonl` by default.
- The ledger stores routing evidence: timestamp, model, provider, locality, intent, confidence, token estimates, estimated cost, savings, speedup, decision latency, end-to-end latency, streaming mode, and status code.
- When non-streaming upstreams return usage metadata, the ledger can also store actual input tokens, output tokens, total tokens, actual routed cost, actual baseline cost, and actual savings.
- Prompt text and completion text are intentionally omitted from telemetry.

That ledger powers `stats`, `share --ledger`, `prove --ledger`, and `tune`, so a team can build evidence from real work without sending private development context to a hosted analytics product.

## Routing Controls

ProofRoute filters impossible routes before scoring. Context limits, executability, estimated cost ceilings, and estimated latency ceilings can reject candidates before the Softmax ranking is calculated.

```sh
node ./bin/proofroute.js route --tokens 8000 --output-tokens 1200 --prompt "audit this plan"
node ./bin/proofroute.js route --max-cost-usd 0.001 --prompt "keep this cheap"
node ./bin/proofroute.js route --max-latency-ms 1500 --prompt "keep this fast"
node ./bin/proofroute.js route --policy save --prompt "summarize these logs"
```

Policies adjust the same scoring function:

| Policy | Bias |
| --- | --- |
| `balanced` | Default quality, cost, latency, and local-model tradeoff |
| `save` | Stronger cost pressure |
| `fast` | Stronger latency pressure |
| `quality` | Lets stronger models win more often |
| `local` | Strong preference for executable local models |

Proxy callers can pass the same controls through request metadata or headers:

| Control | Metadata | Header |
| --- | --- | --- |
| Policy | `metadata.proofroute_policy` | `x-proofroute-policy` |
| Max estimated cost | `metadata.proofroute_max_cost_usd` or `metadata.max_cost_usd` | `x-proofroute-max-cost-usd` |
| Max estimated latency | `metadata.proofroute_max_latency_ms` or `metadata.max_latency_ms` | `x-proofroute-max-latency-ms` |

## Command Matrix

| Command | What it proves |
| --- | --- |
| `route` | Classify one prompt and print the selected model with cost, speed, alternatives, and optional trace evidence |
| `demo` | Render a zero-network proof card with savings, speedup, p95 latency, intent mix, and route mix |
| `share` | Render a copy-ready routing receipt for screenshots, Markdown posts, PRs, and launch notes |
| `prove` | Exit non-zero when latency, savings, speed, request volume, or accuracy gates miss |
| `connect` | Print the drop-in proxy base URL, environment exports, and smoke/proof commands |
| `models` | Render executable catalog coverage, context windows, prices, latency medians, and per-intent leaders |
| `smoke` | Run a fake-provider execution loop through the runtime or transparent proxy without external credentials |
| `bench` | Repeatedly run local routing and show p50/p95 controller latency, savings, and speed gain |
| `calibrate` | Run a prompt suite and report labeled intent accuracy, total savings, average speedup, and model mix |
| `plan` | Split one complex request into architect, builder, reviewer, and optional specialist route decisions |
| `fanout` | Execute a multi-agent plan through configured providers in parallel |
| `stats` | Render the local routing ledger as terminal proof |
| `classifier` | Show sidecar backend, lane, device, error, and latency telemetry |
| `doctor` | Check runtime, providers, telemetry path, classifier mode, sidecar health, and routing policy |
| `tune` | Recommend or export a routing-policy patch from local telemetry |
| `proxy` | Start the OpenAI-compatible transparent proxy |
| `init` | Print the default or local OpenAI-compatible model catalog as editable JSON |

## Configuration

Configuration is plain JSON because routing policy should be inspectable.

```json
{
  "router": {
    "softmaxTemperature": 0.82,
    "latencyPenaltyMs": 900,
    "costPenaltyUsd": 0.00035,
    "qualityWeight": 2.1,
    "localBias": 0.18
  },
  "providers": {
    "local": {
      "baseUrl": "http://127.0.0.1:11434",
      "kind": "ollama"
    },
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "env:OPENAI_API_KEY"
    }
  }
}
```

Models define context window, price, median latency, throughput, provider, endpoint, locality, and per-intent quality. Production users should replace example prices and latency medians with observed numbers from their own traffic.

Environment variables supported by the default discovery path include:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Cloud OpenAI-compatible provider credentials |
| `ANTHROPIC_API_KEY` | Anthropic provider credentials when configured |
| `OLLAMA_BASE_URL` | Local Ollama daemon URL |
| `PROOFROUTE_LOCAL_OPENAI_BASE_URL` | Append an executable local OpenAI-compatible model without a JSON file |
| `PROOFROUTE_LOCAL_OPENAI_MODEL` | Override the generated local OpenAI-compatible model id |
| `PROOFROUTE_LOCAL_OPENAI_CONTEXT_WINDOW` | Override generated context window |
| `PROOFROUTE_LOCAL_OPENAI_LATENCY_MS` | Override generated latency estimate |
| `PROOFROUTE_LOCAL_OPENAI_TOKENS_PER_SECOND` | Override generated throughput estimate |

## Classifier Acceleration

The built-in classifier is deterministic and compact. It uses weighted lexical features, prompt-shape signals, token pressure, and a stable probability distribution across `code`, `reasoning`, `writing`, `extraction`, `long_context`, and `chat`.

Teams with local accelerators can replace or augment that path:

```sh
PROOFROUTE_CLASSIFIER="node ./examples/classifier-command.js" \
  node ./bin/proofroute.js route --prompt "Refactor this function and add a regression test."

node ./bin/proofroute-classifier.js --port 8788 --lanes 4 --devices 0,1 --backend sidecar-builtin

PROOFROUTE_CLASSIFIER_URL=http://127.0.0.1:8788/classify \
  node ./bin/proofroute.js classifier
```

The HTTP sidecar contract supports `GET /health`, `GET /metrics`, `POST /classify`, and `POST /classify/batch`. It lets ONNX, TensorRT, vLLM, or a custom multi-GPU classifier stay warm in another process while ProofRoute enforces a tight timeout and falls back to the built-in classifier when the accelerator is unavailable.

## Architecture

ProofRoute follows an Agent-View-Controller shape:

- **Controller**: local intent recognition, token estimation, context fit checks, cost modeling, latency modeling, route cache, policy weights, and stable Softmax ranking.
- **Agent**: OpenAI-compatible forwarding, Ollama adaptation, Anthropic/OpenAI-shaped streaming, fallback execution, smoke tests, proxy lifecycle, benchmark orchestration, and fanout execution.
- **View**: terminal-native proof cards, route traces, Markdown receipts, proxy connection cards, catalog maps, stats, tuning output, and classifier receipts.

Read the deeper design notes in [docs/architecture.md](docs/architecture.md).

## Development

```sh
node --test
npm run check
```

The tests focus on the correctness-sensitive parts: classifier behavior, Softmax stability, route decisions, proxy selection, streaming adapters, telemetry, policy controls, doctor checks, sidecar classifier behavior, local gateway examples, and fallback handling.

## License

MIT. See [LICENSE](LICENSE).
