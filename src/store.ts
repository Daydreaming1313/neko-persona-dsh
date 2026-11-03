// store.ts —— 每会话一份的状态存储（内存 + 可选落盘）
//
// 设计文档 §4.4：mood/arousal/grudge/since_last_shift 只活在当前会话；
// affinity 可跨会话由上层 memory 负责，本插件只消费不写入。
// 这里用 scope/agent 维度做 key，落盘仅作调试/可观测用途，绝不进 git。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { sanitizeState } from './guards.js'
import { defaults, type NekoState } from './state.js'

export class StateStore {
  private mem = new Map<string, NekoState>()
  private dir?: string

  constructor(stateDir?: string) {
    this.dir = stateDir && stateDir.length ? stateDir : undefined
    if (this.dir) {
      try {
        if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
      } catch {
        this.dir = undefined
      }
    }
  }

  private fileFor(key: string): string | undefined {
    if (!this.dir) return undefined
    const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
    return join(this.dir, `neko-${safe}.json`)
  }

  get(key: string): NekoState | undefined {
    const cached = this.mem.get(key)
    if (cached) return cached
    const f = this.fileFor(key)
    if (f && existsSync(f)) {
      try {
        const raw = JSON.parse(readFileSync(f, 'utf8'))
        const s = sanitizeState(raw, defaults())
        this.mem.set(key, s)
        return s
      } catch {
        /* 坏文件直接忽略，退化到默认 */
      }
    }
    return undefined
  }

  set(key: string, state: NekoState): void {
    this.mem.set(key, state)
    const f = this.fileFor(key)
    if (f) {
      try {
        writeFileSync(f, JSON.stringify(state, null, 2), 'utf8')
      } catch {
        /* 落盘失败不影响内存态 */
      }
    }
  }

  ensure(key: string, fallback: NekoState): NekoState {
    const s = this.get(key)
    if (s) return s
    this.set(key, fallback)
    return fallback
  }
}

// 兼容旧引用：prompt 文件目录解析辅助（render.ts 也会用）
export function resolvePromptDir(candidate: string): string {
  return dirname(candidate)
}
