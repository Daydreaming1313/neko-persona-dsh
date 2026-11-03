# DSH 插件契约记录（dsh-contract.md）

本文件记录本插件在 **实测 DSH 安装** 上确认的 API 事实，以及仍随版本可能漂移的 TODO。
所有「状态机是慢速旋钮」「人格只管语气、安全层盖不掉」等设计原则见主设计文档，这里只记机械契约。

> 实测环境：`@deepseek-ai/dsh` **0.2.1-rc.2**，依赖 `@deepseek-ai/cordis` **~4.0.5**。
> 任何与本文不符之处，以你所用版本的 `node_modules/@deepseek-ai/dsh*/lib/types/*.d.ts` 为准。

## 已确认（Confirmed）

| 项 | 事实 | 来源 |
|---|---|---|
| 插件形态 | cordis 4 插件：`export default { name, apply(ctx, config) {} }`；loader 取 `exports.default ?? exports` | `cordis-plugin-loader/lib/index.js` |
| Prompt 注入 | `ctx.systemPrompt.section({ name, order, text })`；`text` 可为 `(assembleCtx) => string` | `@deepseek-ai/dsh-system-prompt/lib/types/index.d.ts` (`SystemPrompt.section`) |
| 段排序 | 内部槽见 `SECTION_ORDERS`；本插件用 `4200`（plan/team policy 与工具段之后、deliverable 之前） | 同上，`SECTION_ORDERS` |
| 装配上下文 | `text(ctx)` 的 `ctx` 形如 `{ scope?: ScopeKey, signal?: AbortSignal }` | 同上，`AssembleContext` |
| 生命周期事件 | `agent/created`、`agent/pre-step`、`agent/request`、`agent/turn-stopping`、`agent/error` 等 | `@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts` |
| 钩子注册 | 在 `ctx.on('agent/created', ({ agent }) => { agent.on('agent/pre-step', handler) })` 上挂 | 同上；`agent` 即 Scoped<Agent> |
| pre-step 载荷 | `{ agent, messages: UserMessage[], turn, step, signal }` | 同上 |
| turn-stopping 载荷 | `{ agent, turn, signal }` | 同上 |
| 会话句柄 | `agent.session` 是事件源 Session（`session/event`、`surface` 等） | `@deepseek-ai/dsh-session/lib/types/index.d.ts` |
| 安装 | `dsh plugin --profile <name> <pnpm-args...>` 把剩余参数透传给 profile 目录下的 pnpm | `dsh` CLI `--help` / `plugin-BiveYA7h.js` |
| 发现 | 插件以 npm 包形式装进 profile 的 `node_modules`，并在 `cordis.patch.yml` 的 `insert` / bundle 中被引用 | `profiles/desktop/cordis.patch.yml` 结构 |

## 关键设计取舍（已落实在 src/index.ts）

1. **零运行时外部依赖**：插件只 `import` Node 内置 `node:*` 与自身相对模块，不 import `@deepseek-ai/*`。
   宿主在运行时把 `systemPrompt`、`agent` 等注入 `ctx`，因此安装时不会因解析 dsh 内部包版本而冲突。
2. **全部钩子防御性包裹**：`ctx.systemPrompt.section` 成功即可注入人格；`agent/created` 及子钩子若在当前版本不存在，
   静默降级为「静态人格 + 默认 mood 注脚」，绝不抛错中断 harness。
3. **路径解析兜底**：`render.ts` 优先读 `prompts/*.md`，文件缺失则用内置等价 fallback，避免不同版本路径差异导致崩溃。
4. **状态 key**：优先用装配/agent 的 `scope`，回退到 `session.id`、`agent.id`，再回退 `'global'`。
   多 agent 时各 scope 独立状态；拿不到 scope 时退化为单全局态（仍能工作）。

## TODO（按你所用版本回填）

- [ ] `ctx.systemPrompt.section` 的精确 `order` 语义在不同 DSH 小版本间是否稳定？若某版本 4200 与内置段冲突，改 `config.sectionOrder`。
- [ ] `agent/created` 的事件名是否在所有 0.2.x 一致？若改名，只改 `src/index.ts` 中那一个字符串。
- [ ] `agent.session.surface.nodes` 取上一轮助手文本的结构是否随版本变化？`lastAssistantText` 已 try/catch，取不到则 reflect 退化为无操作。
- [ ] 跨会话 `affinity` 持久化：本插件只消费不写入；若要跨会话记挂，请另接 memory 插件，把 affinity 写进你自己的 store。
- [ ] 本插件 `package.json` 的 `peerDependenciesMeta["@deepseek-ai/cordis"].optional=true`，仅供元数据提示，不强制安装。

## 版本对齐纪律（发布前必填）

每次发版在 release note 写清两件事，避免「模型换了一版、prompt 也换了一版」却只记一个：
- `engine-tested-with: dsh@<x.y.z> / <model>`
- `prompt-version: <git tag 或 hash>`
