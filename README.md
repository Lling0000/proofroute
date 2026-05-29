# llm-router

llm-router is a CLI-first large language model routing engine built for developers who do not want to pause their flow to choose a model. It runs as a transparent OpenAI-compatible proxy, inspects each prompt locally, predicts the task intent, estimates the context and output budget, and routes the request toward the model that gives the best blend of quality, latency, and price. The project is intentionally headless because the highest-leverage interface for a tool like this is the shell, the editor task runner, the CI log, and the invisible network hop between an agentic coding tool and its model provider.

The architecture follows an Agent-View-Controller shape that keeps each decision boundary sharp. The Controller owns local intent recognition, token estimation, context fit checks, cost modeling, latency modeling, and numerically stable Softmax ranking. The Agent owns asynchronous provider execution, OpenAI-compatible forwarding, Ollama adaptation, and benchmark orchestration. The View owns terminal-native proof, including dense ANSI charts that show the chosen model, confidence, speedup, and precise dollar savings without requiring a dashboard, browser, or hosted account.

The default path is deliberately zero configuration. A developer can clone the repository, run the CLI with a single prompt, and see a route decision before any network call happens. When the proxy is started, existing OpenAI-compatible clients can point their base URL at llm-router and keep using the same chat completion endpoint while the router silently swaps in the best configured local or cloud model. This makes the tool fit naturally into Vibe Coding sessions because it behaves like infrastructure that has taste: quiet during the work, loud only when it has evidence worth sharing.

```sh
node ./bin/llm-router.js route --prompt "Refactor this webhook, explain the bug, and write a regression test."
```

```sh
node ./bin/llm-router.js bench --prompt "Audit this repository migration plan and find the cheapest safe model." --runs 9
```

```sh
node ./bin/llm-router.js calibrate --file examples/samples.json
```

```sh
node ./bin/llm-router.js plan --prompt "Ship a router proxy, harden the tests, and rewrite the README for launch."
```

```sh
node ./bin/llm-router.js proxy --port 8787 --config examples/router.json
```

The `route` command is the fastest way to understand the router. It prints the detected intent, the selected model, viable alternatives, Softmax probabilities, estimated latency, estimated cost, and savings against the most expensive viable baseline. The `bench` command is designed for instant persuasion: it repeatedly runs the local routing path, reports p50 and p95 controller latency, and renders terminal bars for money saved and speed gained. The `calibrate` command runs a local prompt suite and reports labeled intent accuracy, total savings, average speedup, intent mix, model mix, and p95 routing latency. The `plan` command turns one complex request into an asynchronous multi-agent routing plan, assigning architect, builder, reviewer, and optional specialist roles to their best-fit models before any provider call is made. The `proxy` command starts an OpenAI-compatible server at `/v1/chat/completions`, exposes executable model discovery at `/v1/models`, reports operational readiness at `/ready`, and adds response headers that expose the selected model, detected intent, router latency, and estimated savings.

Configuration is plain JSON because routing should be inspectable and portable. Providers define base URLs and credentials, while models define context window, price, median latency, throughput, and per-intent quality. The default catalog includes local Ollama-style execution and several cloud-shaped entries so the scoring behavior is useful immediately, but production users should replace the example prices and latency medians with their own observed numbers. The scoring function intentionally rewards quality, penalizes latency and cost, gives a small configurable bias to local models, and applies a stable Softmax so extreme logits cannot overflow or produce invalid probabilities.

Routing policy can be selected per command with `--policy` or per proxied request through `metadata.llm_router_policy`. The balanced policy is tuned for the default demo, the save policy makes cost more aggressive, the fast policy increases latency pressure, the quality policy lets stronger models win more often, and the local policy strongly prefers executable local models. The policy layer changes weights before Softmax rather than forcing brittle rules, so the router remains probabilistic, explainable, and numerically stable.

```sh
node ./bin/llm-router.js init > router.json
```

The project is built with no runtime dependencies. Modern Node.js provides the HTTP server, fetch client, test runner, and performance timers needed for the first release, which keeps installation friction low and makes the repository easy to audit. The CLI can still be installed by any package manager that understands `package.json`, but the core demo path works with direct `node` execution so the first impression is fast even on stripped-down developer machines.

Provider discovery works through JSON configuration and environment variables. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `OLLAMA_BASE_URL` are enough to make the default catalog executable for common local and cloud setups, while `.env.example` documents the shape without asking the router to load secrets by itself. Existing OpenAI-compatible clients can switch their base URL to `http://127.0.0.1:8787/v1`, call `/v1/models` to see the executable catalog, and send chat completions through the proxy while llm-router adds its routing evidence in response headers.

The current local classifier is intentionally compact and deterministic. It uses weighted lexical features, prompt-shape signals such as code fences and stack traces, estimated token pressure, and a stable probability distribution to choose among code, reasoning, writing, extraction, long-context, and chat intents. The implementation is shaped so a future native GPU classifier can replace the scoring internals without changing the Agent or View contracts. That gives the repository a credible growth path from viral prototype to serious routing substrate.

Teams with local accelerators can attach an external classifier through `LLM_ROUTER_CLASSIFIER` or a `classifier.command` field in JSON configuration. The command receives a JSON object on stdin with the prompt and should print an intent object on stdout. llm-router keeps a tight timeout and automatically falls back to the built-in deterministic classifier, which means a GPU sidecar can improve classification without ever being allowed to make routing slower than the request it is trying to optimize.

Tests focus on the parts where correctness matters most. The Softmax test protects against overflow and invalid probability mass, the classifier test checks code-heavy prompt recognition, and the route controller test verifies that a full decision includes ranked candidates, cost savings, and latency estimates. Run the suite with the built-in Node test runner.

```sh
node --test
```

llm-router is meant to be open source infrastructure with a shareable heartbeat. The strongest demo is not a slide or a landing page; it is a terminal capture where a real prompt is routed in under a millisecond, a local model wins when it should, a premium model wins when the task deserves it, and the exact money saved is printed in the same frame as the engineering decision.
