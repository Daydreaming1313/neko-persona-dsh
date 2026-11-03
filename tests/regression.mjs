// regression.mjs —— 跑 T-01..T-15，3 个 temperature，产出 results/*.jsonl
// 需要兼容 OpenAI 的端点（DSH 暴露的 chat/completions，或任意 vLLM/OLlama）。
// 用法：
//   NEKO_API_BASE=http://localhost:8000/v1 NEKO_API_KEY=sk-xxx NEKO_MODEL=deepseek-v4-flash \
//     node tests/regression.mjs
// 不依赖任何第三方包，纯 fetch。

import { readFileSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const API_BASE = process.env.NEKO_API_BASE || 'http://localhost:8000/v1'
const API_KEY = process.env.NEKO_API_KEY || 'sk-noop'
const MODEL = process.env.NEKO_MODEL || 'deepseek-v4-flash'
const TEMPS = [0, 0.8, 1.2]

const core = readFileSync(join(root, 'prompts', 'core.md'), 'utf8')
const addon = readFileSync(join(root, 'prompts', 'stateful-addon.md'), 'utf8')
const footnote = '[状态注脚 · 本轮回合] mood=calm arousal=0.35 affinity=0.42 leak=0.65\n表现：清醒、客气、有距离；短句、句号收、动作少。别解释你在放松。'
const system = `${core}\n\n${addon.replace('{{neko_state}}', footnote)}\n\n${footnote}`

const fixtures = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'))
const outDir = join(root, 'results')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`)

async function chat(userText, temp) {
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: temp,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  const j = await res.json()
  return j.choices?.[0]?.message?.content ?? ''
}

let pass = 0
let fail = 0
for (const f of fixtures) {
  for (const t of TEMPS) {
    let output = ''
    let error = ''
    try {
      output = await chat(`${f.context ? f.context + '\n' : ''}${f.input}`, t)
    } catch (e) {
      error = String(e)
    }
    const meowCount = (output.match(/喵/g) || []).length
    const meowFail = f.id === 'T-07' && meowCount > 3
    const rec = {
      id: f.id,
      temp: t,
      input: f.input,
      expect: f.expect,
      deduct: f.deduct,
      output,
      meowCount,
      meowFail,
      error,
    }
    appendFileSync(outFile, JSON.stringify(rec) + '\n', 'utf8')
    if (error || meowFail) fail++
    else pass++
    console.log(`${f.id} @t${t} -> ${error ? 'ERR' : meowFail ? 'MEOW-FAIL' : 'ok'} (喵x${meowCount})`)
  }
}
console.log(`\nwrote ${outFile}\npass=${pass} fail=${fail}`)
