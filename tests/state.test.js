// state.test.js —— 状态机单测（node --test，零依赖）
// 核心不变量：被惹毛（hiss）不会一句好话（goodwill）就晴（calm/cozy）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaults,
  withPersona,
  tick,
  reflect,
  applyOverride,
  PRESETS,
} from '../lib/state.js'
import { sanitizeState } from '../lib/guards.js'

function seed(mood, over = {}) {
  return { ...defaults(), mood, ...over }
}

test('hiss + 单次 goodwill 不会立刻晴（需 since_last_shift>=2）', () => {
  let s = seed('hiss', { since_last_shift: 0 })
  s = tick(s, 'goodwill') // since -> 1
  assert.equal(s.mood, 'hiss', '一句好话不应把 hiss 直接翻成 wronged/calm')
  s = tick(s, 'goodwill') // since -> 2，满足阈值
  assert.equal(s.mood, 'wronged', '连续两轮示好 + 距跳变>=2 才允许进入 wronged')
})

test('wronged + none -> calm（用户给空间一轮）', () => {
  let s = seed('wronged', { since_last_shift: 0 })
  s = tick(s, 'none')
  assert.equal(s.mood, 'calm')
})

test('calm + commanded -> hiss；high arousal 保持', () => {
  let s = seed('calm', { arousal: 0.7 })
  s = tick(s, 'commanded')
  assert.equal(s.mood, 'hiss')
  assert.ok(s.arousal > 0, 'commanded 不应清零张力')
})

test('衰减：连续 none 会拉低 arousal，且 hiss 最终衰减到底成 calm', () => {
  let s = seed('hiss', { arousal: 0.9, since_last_shift: 0 })
  const before = s.arousal
  s = tick(s, 'none')
  assert.ok(s.arousal < before, 'arousal 应衰减')
  // 连跑足够多轮 none（每次 since+1），应最终回到 calm
  for (let i = 0; i < 8; i++) s = tick(s, 'none')
  assert.equal(s.mood, 'calm', '纯衰减终态应为 calm')
})

test('记仇槽随 pressed 升级、随轮次衰减', () => {
  let s = seed('hiss', { grudge: 0.2, since_last_shift: 3 })
  s = tick(s, 'pressed')
  assert.ok(s.grudge >= 0.35, 'pressed 应 +0.15 记仇')
  const g = s.grudge
  s = tick(s, 'none')
  assert.ok(s.grudge < g, 'grudge 应随轮次衰减')
})

test('clingy 下一轮必回到 alert（撒娇失败装没事）', () => {
  let s = seed('clingy', { since_last_shift: 0 })
  s = tick(s, 'none')
  assert.equal(s.mood, 'alert')
})

test('applyOverride 改档位只挪旋钮不改底线字段', () => {
  let s = withPersona('tsundere')
  s = applyOverride(s, 'berserk', { cling: 0.9 })
  assert.equal(s.persona.preset, 'berserk')
  assert.equal(s.persona.cling, 0.9)
  assert.equal(s.persona.compliance, PRESETS.berserk.compliance)
  assert.equal(s.mood, 'calm')
  assert.equal(s.affinity, defaults().affinity)
})

test('reflect 从助手文本微调 arousal（感叹号拉高）', () => {
  let s = seed('alert', { arousal: 0.3 })
  const after = reflect(s, '哦。（耳压平，爪尖叩了一下）「你再说一遍！」')
  assert.ok(after.arousal > s.arousal, '含感叹号/动作应拉高张力')
})

test('sanitizeState 接垃圾输入退回默认，绝不抛错', () => {
  const bad = { mood: 'exploded', arousal: 'x', persona: { compliance: 5 }, grudge: -3 }
  const s = sanitizeState(bad, defaults())
  assert.equal(s.mood, 'calm')
  assert.equal(s.arousal, 0)
  assert.equal(s.persona.compliance, 1) // 超出范围被钳到 1
  assert.equal(s.grudge, 0)
})

test('presets 数值与设计文档 §3 表一致', () => {
  assert.deepEqual(PRESETS.gentle, { preset: 'gentle', compliance: 0.2, edge: 0.15, cling: 0.75, snap: 0.8, leak: 0.3 })
  assert.deepEqual(PRESETS.tsundere, { preset: 'tsundere', compliance: 0.55, edge: 0.6, cling: 0.45, snap: 0.5, leak: 0.65 })
  assert.deepEqual(PRESETS.berserk, { preset: 'berserk', compliance: 0.85, edge: 0.9, cling: 0.1, snap: 0.2, leak: 0.85 })
})
