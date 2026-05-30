# ProofRoute

[English](README.md) | [简体中文](README.zh-CN.md)

> 把每一次 OpenAI 兼容请求路由到“足够好、足够快、成本更低”的模型，并在终端给出可复核证据，同时让 prompt 文本留在本机。

[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](package.json)
[![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Zero runtime deps](https://img.shields.io/badge/runtime_deps-0-111111)](package.json)
[![OpenAI compatible proxy](https://img.shields.io/badge/proxy-OpenAI--compatible-412991)](#可替换-openai-代理)
[![Local telemetry](https://img.shields.io/badge/telemetry-local_JSONL-0f766e)](#隐私模型)

ProofRoute 解决的核心问题很简单：开发者、Agent、编辑器插件和内部工具越来越依赖不同模型，但每次手动选择模型都很慢、很贵，也很难解释为什么这次该用哪个模型。

ProofRoute 是一个 CLI-first 的模型路由器。它可以作为透明的 OpenAI 兼容代理运行，在本地识别 prompt 意图，估算上下文、延迟和成本，然后选择质量、价格、速度之间最合适的模型。它的第一屏价值不是“又一个模型菜单”，而是一个可以截图、放进 PR、放进 CI 的路由证据。

```sh
node ./bin/proofroute.js share --markdown
```

```text
proofroute routed 5 prompts before any provider call, with 0.31ms p95 decision time, $0.019173 estimated savings, 1.64x estimated speedup, and 100.0% labeled intent accuracy.

Copy line: I routed 5 prompts with proofroute in 0.31ms p95 decision time, saved $0.019173, and got 1.64x estimated speedup before any provider call.
```

## 为什么值得 Star

- **直接替换 OpenAI Base URL**：把 SDK、Agent、编辑器扩展和 CLI 工具指向 `http://127.0.0.1:8787/v1`。
- **路由证据可见**：每次决策都能说明意图、选中模型、备选模型、成本差异、速度差异、p95 决策耗时和 CI 门禁。
- **默认保护隐私**：本地 ledger 记录路由证据、状态、token 和节省金额，不保存 prompt 或 completion 文本。
- **本地与云模型一起用**：支持 Ollama、LM Studio/vLLM 这类 OpenAI 兼容本地网关、云端 OpenAI-shaped provider 和 fallback 模型。
- **运行时零依赖**：CLI、HTTP server、fetch client、测试和性能计时都使用现代 Node.js 能力。
- **可持续调优**：跑真实流量，查看本地 JSONL ledger，再导出可审查的 routing policy patch。

## 30 秒快速开始

```sh
git clone https://github.com/Lling0000/proofroute.git
cd proofroute
node --version # requires Node.js >=20

# 零网络启动证明
node ./bin/proofroute.js demo
node ./bin/proofroute.js share --markdown

# 用 CI 风格门禁验证公开承诺
node ./bin/proofroute.js prove --max-p95-ms 5 --min-accuracy 0.8
```

需要先生成配置文件：

```sh
node ./bin/proofroute.js init > router.json
node ./bin/proofroute.js models --config router.json
node ./bin/proofroute.js doctor --config router.json
```

如果你从 LM Studio、vLLM 或其他本地 OpenAI 兼容服务开始：

```sh
node ./bin/proofroute.js init --preset local-openai > router.json
node ./bin/proofroute.js doctor --config router.json
```

本地 OpenAI preset 对应 [examples/local-openai-router.json](examples/local-openai-router.json)：不需要 API key，默认偏向本地策略，包含一个本地模型条目和 command-backed classifier 示例。

## 可替换 OpenAI 代理

启动 ProofRoute：

```sh
node ./bin/proofroute.js proxy --port 8787 --config examples/router.json
```

把现有工具指向它：

```sh
export OPENAI_BASE_URL=http://127.0.0.1:8787/v1
export OPENAI_API_BASE=http://127.0.0.1:8787/v1
export OPENAI_API_KEY=proofroute-local
```

也可以让 CLI 输出连接卡片：

```sh
node ./bin/proofroute.js connect --port 8787
eval "$(node ./bin/proofroute.js connect --shell sh)"
```

ProofRoute 提供：

| Endpoint | 用途 |
| --- | --- |
| `/v1/chat/completions` | 路由后的 chat completions，包含 streaming |
| `/v1/completions` | 旧 completions 请求，通过 chat 路径适配 |
| `/v1/responses` | 简单 Responses API 请求，使用同一路由引擎 |
| `/v1/models` | 返回已配置 provider 中可执行模型 |
| `/ready` | 运行状态检查 |

代理响应会暴露浏览器可读的路由 header，包含选中模型、识别意图、决策耗时、缓存状态、fallback、预估节省、实际 token、实际路由成本，以及上游返回 usage metadata 时的实际节省。

## 终端证据循环

分析单个 prompt：

```sh
node ./bin/proofroute.js route \
  --trace \
  --prompt "Refactor this webhook, explain the bug, and write a regression test."
```

生成适合截图、PR 注释或 CI 的证据：

```sh
node ./bin/proofroute.js bench --prompt "Audit this migration plan." --runs 9
node ./bin/proofroute.js calibrate --file examples/samples.json
node ./bin/proofroute.js prove --max-p95-ms 5 --min-accuracy 0.8
```

有真实代理流量后，把本地 ledger 变成收据：

```sh
node ./bin/proofroute.js stats
node ./bin/proofroute.js share --ledger --markdown
node ./bin/proofroute.js prove --ledger --min-requests 20 --max-p95-ms 5
node ./bin/proofroute.js tune --export tuned-router.json
```

## 隐私模型

ProofRoute 的设计目标是：让路由可审计，但不让你的 prompt 变成可搬运的数据。

- 默认使用本地、确定性、零依赖的 classifier 识别 prompt 意图。
- 路由缓存使用 prompt fingerprint，不把 prompt 文本落盘。
- 代理默认写入 `.proofroute/events.jsonl`。
- ledger 记录 timestamp、model、provider、locality、intent、confidence、token 估算、成本估算、节省、速度提升、决策耗时、端到端延迟、streaming 模式和状态码。
- 非 streaming 上游返回 usage metadata 时，也可以记录实际 input/output/total tokens、实际路由成本、baseline 成本和实际节省。
- prompt 文本和 completion 文本不会写入 telemetry。

这个 ledger 驱动 `stats`、`share --ledger`、`prove --ledger` 和 `tune`。团队可以从真实工作流里积累证据，而不需要把开发上下文送到托管分析产品。

## 路由控制

ProofRoute 会先过滤不可能的路线，再进入打分：上下文窗口、模型是否可执行、预估成本上限、预估延迟上限都会在 Softmax 排名前生效。

```sh
node ./bin/proofroute.js route --tokens 8000 --output-tokens 1200 --prompt "audit this plan"
node ./bin/proofroute.js route --max-cost-usd 0.001 --prompt "keep this cheap"
node ./bin/proofroute.js route --max-latency-ms 1500 --prompt "keep this fast"
node ./bin/proofroute.js route --policy save --prompt "summarize these logs"
```

| Policy | 偏向 |
| --- | --- |
| `balanced` | 默认平衡质量、成本、延迟和本地模型 |
| `save` | 更强成本压力 |
| `fast` | 更强延迟压力 |
| `quality` | 更容易让强模型获胜 |
| `local` | 强烈偏向可执行本地模型 |

## 命令矩阵

| Command | 证明什么 |
| --- | --- |
| `route` | 识别一个 prompt，并打印选中模型、成本、速度、备选项和 trace |
| `demo` | 输出零网络 proof card，包含节省、速度、p95、意图分布和路由分布 |
| `share` | 输出适合截图、Markdown、PR、launch note 的路由收据 |
| `prove` | 当延迟、节省、速度、请求量或准确率门禁不达标时返回非零 |
| `connect` | 打印代理 URL、环境变量和 smoke/proof 命令 |
| `models` | 展示可执行模型覆盖、上下文窗口、价格、延迟和每类意图 leader |
| `smoke` | 不需要外部凭证，用 fake provider 验证 runtime 或透明代理 |
| `bench` | 重复运行本地路由，输出 p50/p95 控制器延迟、节省和速度提升 |
| `calibrate` | 跑 prompt suite，输出意图准确率、总节省、平均速度提升和模型分布 |
| `plan` | 把复杂请求拆成 architect、builder、reviewer 和可选 specialist 路由 |
| `fanout` | 通过配置的 providers 并行执行多 Agent plan |
| `stats` | 把本地 ledger 渲染成终端证据 |
| `classifier` | 查看 sidecar backend、lane、device、error 和 latency telemetry |
| `doctor` | 检查 runtime、providers、telemetry 路径、classifier、sidecar 和 policy |
| `tune` | 从本地 telemetry 推荐或导出 routing-policy patch |
| `proxy` | 启动 OpenAI 兼容透明代理 |
| `init` | 输出默认或本地 OpenAI 兼容模型目录 JSON |

## 架构

ProofRoute 使用 Agent-View-Controller 形态：

- **Controller**：本地意图识别、token 估算、context fit、成本建模、延迟建模、route cache、policy weight 和稳定 Softmax 排名。
- **Agent**：OpenAI 兼容转发、Ollama 适配、Anthropic/OpenAI-shaped streaming、fallback 执行、smoke tests、proxy lifecycle、benchmark 编排和 fanout 执行。
- **View**：终端 proof card、route trace、Markdown receipt、proxy connection card、catalog map、stats、tuning output 和 classifier receipt。

更深入的设计见 [docs/architecture.md](docs/architecture.md)。

## License

MIT
