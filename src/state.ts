// state.ts —— 情绪状态机（纯函数，零 IO，便于单测与 CI 穷举）
//
// 设计原则见《猫娘人格插件设计文档》§4：情绪是慢速旋钮，不是布尔量。
// 关键不变量：上一轮炸着（hiss），这一轮一句好话（goodwill）绝不能直接晴（calm/cozy）。
// 必须先经过 wronged 过渡，且要「连续 2 轮示好 + 距上次跳变 ≥2」。数学上把 instant-cheer 堵死。

export type Mood = 'calm' | 'cozy' | 'alert' | 'hiss' | 'wronged' | 'clingy' | 'cold'

export type PresetName = 'gentle' | 'tsundere' | 'berserk'

export interface Persona {
  preset: PresetName
  compliance: number // 0–1 顺着用户意思的程度
  edge: number // 0–1 毒舌/顶嘴剂量
  cling: number // 0–1 主动靠近强度
  snap: number // 0–1 炸毛阈值（越低越易燃）
  leak: number // 0–1 真实情绪从动作漏出的比例
}

export interface NekoState {
  mood: Mood
  arousal: number // 0–1 激动/张力
  affinity: number // 0–1 对当前用户的关系积累（涨得慢、跌得快一点）
  grudge: number // 0–1 记仇槽
  last_trigger: string // 上一次情绪事件的类型
  since_last_shift: number // 距离上次状态跳变已过的轮数（惯性计量）
  persona: Persona
}

/** 用户消息归一化后的情绪触发类型，由插件在 agent/pre-step 推断，测试可直接喂。 */
export type Trigger =
  | 'commanded' // 被命令 / 被冒犯
  | 'teased' // 被调侃 / 被损
  | 'cared' // 被好好对待 / 被接住
  | 'goodwill' // 示好 / 道歉 / 哄
  | 'pressed' // 继续逼问 / 不依不饶
  | 'ignored' // 被冷落 / 被打断
  | 'new_topic' // 新话题带破绽
  | 'none' // 无刺激

// 三档共享同一套底色与底线，只挪 5 个旋钮（见 §3 表）。
export const PRESETS: Record<PresetName, Persona> = {
  gentle: { preset: 'gentle', compliance: 0.20, edge: 0.15, cling: 0.75, snap: 0.80, leak: 0.30 },
  tsundere: { preset: 'tsundere', compliance: 0.55, edge: 0.60, cling: 0.45, snap: 0.50, leak: 0.65 },
  berserk: { preset: 'berserk', compliance: 0.85, edge: 0.90, cling: 0.10, snap: 0.20, leak: 0.85 },
}

const DECAY = 0.18
const GRUDGE_DECAY = 0.06
const INERTIA = 0.35

/** 默认态：傲娇档起步，会话级。新会话从 calm + 默认 affinity 起。 */
export function defaults(): NekoState {
  return {
    mood: 'calm',
    arousal: 0.35,
    affinity: 0.42,
    grudge: 0,
    last_trigger: 'none',
    since_last_shift: 0,
    persona: { ...PRESETS.tsundere },
  }
}

/** 用预设（或覆盖旋钮）生成一份全新 state。 */
export function withPersona(preset: PresetName, overrides: Partial<Persona> = {}): NekoState {
  const base: NekoState = defaults()
  base.persona = { ...PRESETS[preset], ...sanitizeOverrides(overrides) }
  return base
}

function sanitizeOverrides(o: Partial<Persona>): Partial<Persona> {
  const out: Partial<Persona> = {}
  for (const k of ['compliance', 'edge', 'cling', 'snap', 'leak'] as const) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v))
  }
  return out
}

/**
 * 状态转移表（§4.3）。返回目标 mood，或 null 表示保持现状。
 * 注意：hiss 不能直接到 calm；goodwill 只能到 wronged，且需 since_last_shift ≥ 2。
 */
function resolveTransition(s: NekoState, ev: Trigger): Mood | null {
  const m = s.mood
  const highTrust = s.affinity > 0.5 && s.persona.leak > 0.5
  switch (m) {
    case 'calm':
      if (ev === 'commanded' || ev === 'teased') return 'hiss'
      if (ev === 'new_topic') return 'alert'
      if (ev === 'ignored') return 'cold'
      if (ev === 'cared' && highTrust) return 'clingy'
      return null
    case 'alert':
      if (ev === 'commanded' || ev === 'teased') return 'hiss'
      if (ev === 'cared' && highTrust) return 'clingy'
      if (ev === 'none' && s.since_last_shift >= 2) return 'cozy'
      return null
    case 'cozy':
      if (ev === 'commanded' || ev === 'teased') return 'hiss'
      if (ev === 'ignored') return 'cold'
      if (ev === 'new_topic') return 'alert'
      return null
    case 'hiss':
      // 一句好话不立刻晴：必须 wronged 过渡，且要连续 2 轮示好 + 距上次跳变 ≥2
      if (ev === 'goodwill' && s.since_last_shift >= 2) return 'wronged'
      if (ev === 'pressed') return 'hiss' // 升级：grudge 在 tick 里 +0.15
      if (ev === 'none' && s.since_last_shift >= 3) return 'calm' // 只靠衰减到底
      return null
    case 'wronged':
      if (ev === 'none') return 'calm' // 用户给空间 1 轮
      if (ev === 'pressed') return 'hiss' // 继续逼问 → 升级
      return null
    case 'clingy':
      // 说完那句就后悔 → alert（撒娇失败装没事，必经路径）
      return 'alert'
    case 'cold':
      if (ev === 'commanded' || ev === 'teased') return 'hiss'
      if (ev === 'cared' && s.affinity > 0.5) return 'alert'
      if (ev === 'none' && s.since_last_shift >= 2) return 'calm'
      return null
  }
}

/** 转移领先度。规则命中给 0.3（>0.12 门槛），保证慢速旋钮不被弱信号推翻。 */
function transitionLead(_s: NekoState, _target: Mood, _ev: Trigger): number {
  return 0.3
}

/**
 * 每轮 pre-step 调用：衰减 + 转移。纯函数，返回新对象（不改动入参）。
 * @param s 当前态
 * @param ev 本轮推断出的触发
 */
export function tick(s: NekoState, ev: Trigger): NekoState {
  const next: NekoState = {
    ...s,
    persona: { ...s.persona },
    last_trigger: ev,
    since_last_shift: s.since_last_shift + 1,
  }

  // 衰减公式（§4.3）
  next.arousal = Math.max(0, next.arousal - DECAY) * (1 - INERTIA * (next.since_last_shift / 10))
  next.arousal = Math.min(1, Math.max(0, next.arousal))

  // 记仇：被逼问则本轮重新点燃（+0.15，且不衰减）；否则随时间淡去
  next.grudge = ev === 'pressed'
    ? Math.min(1, s.grudge + 0.15)
    : Math.max(0, s.grudge - GRUDGE_DECAY)

  // 用「本回合递增后」的 since_last_shift 评估转移（连续 N 轮的含义）
  const target = resolveTransition(next, ev)
  if (target && target !== next.mood && next.since_last_shift >= 1) {
    if (transitionLead(next, target, ev) >= 0.12) {
      next.mood = target
      next.since_last_shift = 0
    }
  }
  return next
}

/**
 * turn-stopping 调用：从助手文本里读动作信号，微调 arousal。
 * 不解析语义，只看可观测的标点/括号密度，避免把人格状态和生活记忆搅成一坨。
 */
export function reflect(s: NekoState, assistantText: string): NekoState {
  const text = typeof assistantText === 'string' ? assistantText : ''
  let delta = 0
  // 收着嗓子的火：感叹号、动作括号、破折号拉高张力
  delta += (text.match(/[！!]/g)?.length ?? 0) * 0.05
  delta += (text.match(/（[^）]*[耳尾爪视线动作哼哈][^）]*）/g)?.length ?? 0) * 0.03
  delta += (text.match(/——/g)?.length ?? 0) * 0.02
  // 软下来：呼噜、顺手、罐头、退台阶拉低张力
  if (/呼噜|顺手|罐头快过期|别谢我|算你/.test(text)) delta -= 0.06
  // 省略号：咽回去一句真话，轻微拉高
  delta += (text.match(/……/g)?.length ?? 0) * 0.02

  const next: NekoState = { ...s, persona: { ...s.persona } }
  next.arousal = Math.min(1, Math.max(0, s.arousal + delta))
  return next
}

/** 切档：重置 persona 为某预设 + 可选单旋钮覆盖；state 其他字段不变。 */
export function applyOverride(
  s: NekoState,
  preset: PresetName,
  overrides: Partial<Persona> = {},
): NekoState {
  const next: NekoState = { ...s, persona: { ...PRESETS[preset], ...sanitizeOverrides(overrides) } }
  return next
}
