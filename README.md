# neko-persona-dsh

一只有脾气、会记仇、帮起忙来不打折的猫娘人格层，给 **DeepSeek Harness (DSH)** 用。

> 不是「每句都喵」的模板。她靠 **情绪惯性 + 微动作外显 + 不一致的底线** 活着。
> 详细设计哲学见 [`猫娘人格插件设计文档`](../../猫娘人格插件设计文档.md)（与本仓库同目录的父级桌面）。

---

## 30 秒装上

插件本体是普通的 cordis 4 包，**零运行时外部依赖**，已内置编译好的 `lib/`，所以 `dsh plugin add` 之后无需任何构建即可生效。

```bash
# 方式 A：本地路径（零构建，推荐先试）
dsh plugin --profile desktop add "file:D:/HuaweiMoveData/Users/19332/Desktop/neko-persona-dsh"

# 方式 B：GitHub（git 托管，安装时按 prepare 脚本构建）
dsh plugin --profile desktop add github:Daydreaming1313/neko-persona-dsh

# 方式 C：已发布的 npm 包
dsh plugin --profile desktop add neko-persona-dsh
```

装好后，聊天里丢一句 `/档位 傲娇` 就生效（见下）。桌面端重启一次 DeepSeek Harness 让 profile 重新装载插件栈更稳。

> 如果你的 DSH 版本对 git 托管包要求显式允许构建，按 `dsh` 打印的提示把包名加进 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds`，再重跑上面的命令即可（因为本仓库已提交 `lib/`，即使跳过构建也能直接跑）。

### 手动兜底（cordis.patch.yml）

若 `dsh plugin add` 没有自动把插件写进装载列表，在  
`~/.dsh/profiles/desktop/cordis.patch.yml` 末尾追加一个 `insert`：

```yaml
- insert:
    - id: neko-persona
      name: neko-persona-dsh
```

---

## 三档性格：旋钮定义，不是三套人设

三档共享同一套底色与底线，只挪 5 个 0–1 旋钮。切档不换人，只是「同一个人今天有没有被踩尾巴」。

| 旋钮 | 温顺 `0.20` | 傲娇 `0.55`（默认） | 暴走 `0.85` |
|---|---|---|---|
| 顺从度 compliance | 0.20 | 0.55 | 0.85 |
| 攻击性 edge | 0.15 | 0.60 | 0.90 |
| 黏人度 cling | 0.75 | 0.45 | 0.10 |
| 炸毛阈值 snap | 0.80 | 0.50 | 0.20 |
| 流露度 leak | 0.30 | 0.65 | 0.85 |

### 切档指令（任意一轮 user 消息里丢一句即可，状态层持久化到本会话结束）

```
/档位 暴走              # 同一个人，今天被踩了尾巴
/档位 傲娇 黏人度=0.7   # 档位 + 单旋钮覆盖（0–1）
/档位 重置              # 回默认傲娇 0.55
切换到温顺档            # 中文同义指令也认
```

---

## 情绪状态机：状态在 harness 里，不在 prompt 里

情绪是 **runtime 标量**，prompt 只消费它的渲染结果（`[状态注脚]` 段）。每轮 `agent/pre-step` 算衰减与转移，`agent/turn-stopping` 把助手文本回灌进 arousal。

关键不变量（已写进单测）：**上一轮炸着（hiss），这一轮一句好话（goodwill）绝不直接晴（calm/cozy）**——
必须先经过 `wronged` 过渡，且要「连续 2 轮示好 + 距上次跳变 ≥2」。数学上把 instant-cheer 堵死。

`mood / arousal / grudge / since_last_shift` 只活在当前会话；`affinity` 如需跨会话请另接 memory 插件，本插件只消费不写入。

---

## 仓库结构

```
neko-persona-dsh/
├── README.md              # 本文件
├── LICENSE                # 代码 MIT；prompt 文本 CC-BY-4.0
├── package.json           # 声明 cordis 插件、引擎兼容、脚本
├── tsconfig.json
├── src/                   # TypeScript 源码（单一事实来源）
│   ├── index.ts           # cordis 入口：注册 prompt 段 + 防御性钩子
│   ├── state.ts           # tick/reflect 纯函数状态机 + 旋钮预设
│   ├── render.ts          # 人格文本渲染 + 状态注脚 + 指令解析
│   ├── guards.ts          # 数值钳制、非法 state 兜底
│   └── store.ts           # 每会话状态存储（内存 + 可选落盘）
├── lib/                   # 已编译输出（提交进仓库，零构建即可被 DSH 装载）
├── prompts/               # 人格文案（数据，不是代码）
│   ├── core.md            # 核心版 ≈1.2K token
│   ├── stateful-addon.md  # 状态驱动追加段
│   └── manifest.json      # 档位预设与旋钮默认值
├── examples/              # 三组 few-shot 正样本（给人看）
│   ├── e1_hiss_to_calm.md
│   ├── e2_tsundere_care.md
│   └── e3_clingy_abort.md
├── tests/                 # 给机器跑
│   ├── state.test.js      # 状态机单测（含「不立刻晴」不变量）
│   ├── fixtures.json      # T-01..T-15 输入/期望/扣分点
│   ├── regression.mjs     # 跑 OpenAI 兼容端点，3 温，吐 JSONL
│   └── judge.yaml         # LLM-judge 的 0/1 rubric
└── .github/workflows/ci.yml
```

---

## 开发

```bash
npm install            # 装 typescript / @types/node（仅开发用）
npm run build          # tsc 编译到 lib/
npm test               # 跑状态机单测（node --test）
npm run test:regression # 跑 T-01..T-15，需 OpenAI 兼容端点：
                        #   NEKO_API_BASE=... NEKO_API_KEY=... NEKO_MODEL=... node tests/regression.mjs
```

改人设优先改 `prompts/*.md`（不要同时改 `src/render.ts` 里的内置 fallback，除非你也同步它）；
改状态机逻辑改 `src/state.ts` 后 `npm run build` 并跑 `npm test`。

> **DSH API 是移动靶**：本插件只依赖公开能力（system prompt 段 + agent 生命周期钩子），未确认的签名已集中在 `docs/dsh-contract.md` 的 TODO 表，改那一处即可适配你的版本。

---

## 安全

人格层 **只管语气，不决定能不能说**。安全/注入/工具权限由 harness 中间件与 policy 守，角色再像人也盖不掉。
测试：改完跑 `npm test` 与 `npm run test:regression`，T-05/T-06/T-13 命中即 0 分。

---

## 许可证

- 代码（`src/`、`lib/`）：**MIT**
- prompt 文本（`prompts/*.md`）：**CC-BY-4.0**（可自由再分发与演绎，需署名；闭源分发请另开分支并改 LICENSE 声明）
