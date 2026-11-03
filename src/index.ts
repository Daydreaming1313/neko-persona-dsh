// index.ts —— DSH (cordis 4) 插件入口
//
// 本文件只做三件事，且全部防御性包裹，绝不因为某个 hook 不存在就崩：
//   1) 注册人格 system prompt 段（核心 API：ctx.systemPrompt.section，已确认存在）
//   2) 在 agent/pre-step 每轮 tick 状态机、解析 /档位 指令
//   3) 在 agent/turn-stopping 把助手文本回灌进 arousal（best-effort）
//
// 只要 (1) 成功，人格就一定注入；钩子不可用则退化为「静态人格 + 默认 mood 注脚」。
// 具体 DSH 版本若对 hook 名称有出入，见 docs/dsh-contract.md 的 TODO 表，改这一处即可。

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyOverride, defaults, tick, reflect, type NekoState } from './state.js'
import { sanitizeState } from './guards.js'
import {
  loadPrompts,
  parsePresetCommand,
  parseUserTrigger,
  renderPersona,
  type Prompts,
} from './render.js'
import { StateStore } from './store.js'

const SECTION_NAME = 'neko-persona'
const SECTION_ORDER = 4200 // 在 plan/team policy 与工具段之后、deliverable 之前，给人格「最后一句语气权」

export interface NekoConfig {
  preset?: 'gentle' | 'tsundere' | 'berserk'
  stateful?: boolean
  sectionOrder?: number
  stateDir?: string
}

// —— 最小本地类型，避免强依赖 cordis 类型定义即可编译；运行时按 cordis 注入对象工作 ——
interface AgentLike {
  on?: (event: string, handler: (payload: any, next?: () => Promise<any>) => any) => unknown
  session?: any
  scope?: unknown
  id?: unknown
}
interface ContextLike {
  systemPrompt?: { section: (s: { name: string; order: number; text: string | ((c: any) => string) }) => unknown }
  on?: (event: string, handler: (payload: any) => unknown) => unknown
}

function lastUserText(messages: any): string {
  if (!Array.isArray(messages) || messages.length === 0) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const role = m?.role ?? m?.['role'] ?? ''
    if (role !== 'user' && role !== 'tool') continue
    const content = m?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((p: any) => p && (p.type === 'text' || p.text))
        .map((p: any) => (typeof p === 'string' ? p : p.text ?? ''))
        .join(' ')
    }
    return ''
  }
  return ''
}

function sessionKey(scope: unknown, agent: AgentLike | undefined): string {
  try {
    if (scope !== undefined && scope !== null) return `scope:${String(scope)}`
    if (agent?.scope !== undefined) return `scope:${String(agent.scope)}`
    const sid = agent?.session?.id ?? agent?.session?.sessionId
    if (sid !== undefined) return `session:${String(sid)}`
    if (agent?.id !== undefined) return `agent:${String(agent.id)}`
  } catch {
    /* ignore */
  }
  return 'global'
}

/** 在目标对象上注册事件，自动透传 waterfall 的 next，且吞掉任何运行期错误。 */
function safeOn(target: any, event: string, handler: (payload: any, next?: () => Promise<any>) => any): void {
  if (!target || typeof target.on !== 'function') return
  try {
    target.on(event, async (payload: any, next?: () => Promise<any>) => {
      try {
        const r = handler(payload, next)
        if (r && typeof (r as any).then === 'function') await r
      } catch {
        /* 任何钩子内部错误都不许冒泡到 harness */
      }
      if (typeof next === 'function') {
        try {
          return await next()
        } catch {
          /* ignore */
        }
      }
    })
  } catch {
    /* 该事件在此版本不存在，静默跳过 */
  }
}

function applyPlugin(ctx: ContextLike, config: NekoConfig = {}): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const pkgRoot = dirname(here)
  const prompts: Prompts = loadPrompts(join(pkgRoot, 'prompts'))

  const withStateful = config.stateful !== false
  const order = typeof config.sectionOrder === 'number' ? config.sectionOrder : SECTION_ORDER
  const store = new StateStore(config.stateDir)
  const baseState: NekoState = sanitizeState(
    { ...defaults(), persona: { ...(defaults().persona) } },
    defaults(),
  )
  // 预设档位来自 config（cordis 注入），缺省傲娇
  if (config.preset) {
    baseState.persona = { ...defaults().persona, ...{ preset: config.preset } }
    const map: Record<string, NekoState['persona']> = {
      gentle: { preset: 'gentle', compliance: 0.2, edge: 0.15, cling: 0.75, snap: 0.8, leak: 0.3 },
      tsundere: { preset: 'tsundere', compliance: 0.55, edge: 0.6, cling: 0.45, snap: 0.5, leak: 0.65 },
      berserk: { preset: 'berserk', compliance: 0.85, edge: 0.9, cling: 0.1, snap: 0.2, leak: 0.85 },
    }
    baseState.persona = { ...map[config.preset] }
  }

  // 1) 注册人格 prompt 段（核心：已确认 API）
  if (ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
    ctx.systemPrompt.section({
      name: SECTION_NAME,
      order,
      text: (assembleCtx: any) => {
        const key = sessionKey(assembleCtx?.scope, undefined)
        const st = store.get(key) ?? baseState
        return renderPersona(st, { withStateful, prompts })
      },
    })
  }

  // 2)+3) 生命周期钩子（版本敏感，全部 try/guard）
  try {
    if (typeof ctx.on === 'function') {
      ctx.on('agent/created', (payload: any) => {
        const agent: AgentLike | undefined = payload?.agent
        const key = sessionKey(undefined, agent)
        store.ensure(key, { ...baseState })

        safeOn(agent, 'agent/pre-step', (p: any) => {
          const text = lastUserText(p?.messages)
          // /档位 指令优先
          const cmd = parsePresetCommand(text)
          let cur = store.get(key) ?? { ...baseState }
          if (cmd) cur = applyOverride(cur, cmd.preset, cmd.overrides)
          const ev = parseUserTrigger(text)
          cur = tick(cur, ev)
          store.set(key, cur)
        })

        safeOn(agent, 'agent/turn-stopping', (p: any) => {
          const text = lastAssistantText(p?.agent ?? agent)
          if (!text) return
          const cur = store.get(key)
          if (cur) store.set(key, reflect(cur, text))
        })
      })
    }
  } catch {
    /* 钩子层不可用：人格仍以默认态静态注入，仍可用 */
  }
}

/** best-effort 抽取上一轮助手文本；拿不到就返回 ''（reflect 退化为无操作）。 */
function lastAssistantText(agent: AgentLike | undefined): string {
  try {
    const surface = agent?.session?.surface
    if (surface && Array.isArray(surface.nodes)) {
      for (let i = surface.nodes.length - 1; i >= 0; i--) {
        const node = surface.nodes[i]
        const role = node?.message?.role ?? node?.role
        if (role === 'assistant') {
          const c = node?.message?.content ?? node?.content
          if (typeof c === 'string') return c
          if (Array.isArray(c)) return c.map((x: any) => (typeof x === 'string' ? x : x?.text ?? '')).join(' ')
        }
      }
    }
  } catch {
    /* ignore */
  }
  return ''
}

// cordis 4 插件出口：export default { name, apply, inject }
//
// 关键：cordis 的 ctx 经过依赖注入代理，访问服务属性（如 ctx.systemPrompt）前
// 必须在插件定义里通过 inject 声明依赖，否则会抛
//   Error: cannot get property "systemPrompt" without inject
// 声明后，只有当 systemPrompt 服务就绪时插件才会被激活（activate）。
const plugin = {
  name: 'neko-persona',
  // 声明本插件依赖的服务；未声明则 cordis 在 apply 里访问 ctx.systemPrompt 直接报错
  inject: ['systemPrompt'] as const,
  apply(ctx: ContextLike, config: NekoConfig = {}) {
    applyPlugin(ctx, config ?? {})
  },
}

export default plugin
