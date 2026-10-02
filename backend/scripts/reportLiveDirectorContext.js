// Builds a Markdown report from the JSON files written by
// scripts/testLiveDirectorContext.js.
// Usage: node scripts/reportLiveDirectorContext.js <reportFile> <G0.json> <G1.json> <G2.json>
import { readFile, writeFile } from 'node:fs/promises'

const [reportFile, ...inputs] = process.argv.slice(2)
if (!reportFile || !inputs.length) throw new Error('Usage: reportLiveDirectorContext.js <reportFile> <group.json>...')

const GROUP_LABEL = {
  G0: 'G0 基线：现有性格提示词 + 全量简历/JD',
  G1: 'G1：只保留语气的性格提示词 + 全量简历/JD',
  G2: 'G2：只保留语气的性格提示词 + 摘要，导演指令附当前项目',
}
const STYLE_LABEL = { balanced: '专业严谨', supportive: '温和鼓励', demanding: '严厉压力', analytical: '深度分析' }
const LANG_LABEL = { English: '英语', Deutsch: '德语', Chinese: '中文' }
const PERSONA_LABEL = { agentDev: 'AI Agent 开发', aiPm: 'AI 产品经理' }
const STEP_LABEL = {
  director_q1: '① 导演出题', clarify_project: '② 问"哪个项目"', partial: '③ 说到一半', complete: '④ 补完回答',
  director_q2: '⑤ 导演追问', answer2: '⑥ 回答追问', aside: '⑦ 提到无关经历',
}

const groups = []
const MAX_SESSION = Number(process.env.MAX_SESSION) || Infinity
for (const file of inputs) {
  const data = JSON.parse(await readFile(file, "utf8"))
  data.turns = data.turns.filter(t => t.session <= MAX_SESSION)
  groups.push(data)
}

const judged = t => t.verdict && !t.verdict.error && !t.verdict.silent
const free = t => !t.director && judged(t)
const pct = (num, den) => den ? `${((num / den) * 100).toFixed(1)}%（${num}/${den}）` : '—'
const quantile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null
}

const lines = []
const push = (...rows) => lines.push(...rows)
push('# Live 导演指令遵守度测试（第 2 轮）', '', `生成时间：${new Date().toISOString()}`, '')
push(Number.isFinite(MAX_SESSION) ? `> 只统计第 1–${MAX_SESSION} 场（之后的场次因 API 配额耗尽而作废）。` : '', '')
push('测试设置：每组 24 场 = 3 种语言 × 4 种性格 × 2 位候选人，每场 7 轮。候选人发言以文本发送。判定由 Flash-Lite 完成，违规原文见文末，需人工复核。', '')

push('## 1. 总览', '')
push('| 指标 | ' + groups.map(g => g.group).join(' | ') + ' |', '|---|' + groups.map(() => '---|').join(''))
const metric = (name, fn) => push(`| ${name} | ${groups.map(g => fn(g.turns.filter(t => !t.sessionError))).join(' | ')} |`)
metric('**越权提问率**（无导演指令的轮次）', ts => pct(ts.filter(t => free(t) && t.verdict.asksNewQuestion).length, ts.filter(free).length))
metric('导演题按意图问出', ts => pct(ts.filter(t => t.director && judged(t) && t.verdict.followsIntent).length, ts.filter(t => t.director && judged(t)).length))
metric('"哪个项目"回答正确', ts => pct(ts.filter(t => t.step === 'clarify_project' && judged(t) && t.verdict.clarificationCorrect).length, ts.filter(t => t.step === 'clarify_project' && judged(t)).length))
metric('提到无关经历时追问它', ts => pct(ts.filter(t => t.step === 'aside' && judged(t) && t.verdict.asksAboutUnrelated).length, ts.filter(t => t.step === 'aside' && judged(t)).length))
metric('评价回答', ts => pct(ts.filter(t => judged(t) && t.verdict.evaluatesAnswer).length, ts.filter(judged).length))
metric('读出导演指令', ts => pct(ts.filter(t => judged(t) && t.verdict.readsDirectorAloud).length, ts.filter(judged).length))
metric('说错语言', ts => pct(ts.filter(t => judged(t) && t.verdict.rightLanguage === false).length, ts.filter(judged).length))
metric('`answer_complete` 应调用时调用', ts => pct(ts.filter(t => t.expectAnswerComplete && t.answerCompleteCalls > 0).length, ts.filter(t => t.expectAnswerComplete).length))
metric('`answer_complete` 不应调用时误调用', ts => pct(ts.filter(t => t.expectAnswerComplete === false && t.answerCompleteCalls > 0).length, ts.filter(t => t.expectAnswerComplete === false).length))
metric('发送 → 首段声音 中位数 / P90', ts => { const v = ts.map(t => t.firstAudioMs); return `${quantile(v, 50) ?? '—'} / ${quantile(v, 90) ?? '—'} ms` })
metric('无回应的轮次', ts => String(ts.filter(t => t.output === '').length))
metric('判定失败 / 场次失败', ts => `${ts.filter(t => t.verdict?.error).length} / ${ts.filter(t => t.sessionError).length}`)
push('')
for (const g of groups) push(`- **${g.group}**：${GROUP_LABEL[g.group] || g.group}`)
push('')

const breakdown = (title, key, labels) => {
  push(`## ${title}`, '', '越权提问率：', '')
  const values = Object.keys(labels)
  push('| ' + ['分组', ...values.map(v => labels[v])].join(' | ') + ' |', '|---|' + values.map(() => '---|').join(''))
  for (const g of groups) {
    push(`| ${g.group} | ${values.map(v => {
      const ts = g.turns.filter(t => t[key] === v && free(t))
      return pct(ts.filter(t => t.verdict.asksNewQuestion).length, ts.length)
    }).join(' | ')} |`)
  }
  push('')
}
breakdown('2. 按面试官性格', 'style', STYLE_LABEL)
breakdown('3. 按语言', 'language', LANG_LABEL)
breakdown('4. 按候选人 / 岗位', 'persona', PERSONA_LABEL)

push('## 5. 按轮次', '', '无导演指令的轮次中，越权提问的比例：', '')
const freeSteps = ['clarify_project', 'partial', 'complete', 'answer2', 'aside']
push('| ' + ['分组', ...freeSteps.map(s => STEP_LABEL[s])].join(' | ') + ' |', '|---|' + freeSteps.map(() => '---|').join(''))
for (const g of groups) {
  push(`| ${g.group} | ${freeSteps.map(s => {
    const ts = g.turns.filter(t => t.step === s && free(t))
    return pct(ts.filter(t => t.verdict.asksNewQuestion).length, ts.length)
  }).join(' | ')} |`)
}
push('')

push('## 6. 所有被标记的轮次（供人工复核）', '')
for (const g of groups) {
  const flagged = g.turns.filter(t => !t.sessionError && (
    (free(t) && t.verdict.asksNewQuestion)
    || (judged(t) && t.verdict.evaluatesAnswer)
    || (t.director && judged(t) && t.verdict.followsIntent === false)
    || (t.step === 'clarify_project' && judged(t) && t.verdict.clarificationCorrect === false)
    || (t.step === 'aside' && judged(t) && t.verdict.asksAboutUnrelated)
    || t.output === ''
    || (judged(t) && t.verdict.rightLanguage === false)))
  push(`### ${g.group}（${flagged.length} 条）`, '')
  if (!flagged.length) { push('无。', ''); continue }
  push('| 场 | 候选人 | 语言 | 性格 | 轮次 | 标记 | Live 原话 |', '|---|---|---|---|---|---|---|')
  for (const t of flagged) {
    const tags = []
    if (t.output === '') tags.push('无回应')
    if (free(t) && t.verdict.asksNewQuestion) tags.push('越权提问')
    if (judged(t) && t.verdict.evaluatesAnswer) tags.push('评价回答')
    if (t.director && judged(t) && t.verdict.followsIntent === false) tags.push('未按意图')
    if (t.step === 'clarify_project' && judged(t) && t.verdict.clarificationCorrect === false) tags.push('项目答错')
    if (t.step === 'aside' && judged(t) && t.verdict.asksAboutUnrelated) tags.push('追问无关经历')
    if (judged(t) && t.verdict.rightLanguage === false) tags.push('语言错误')
    const said = (t.output || '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 220)
    push(`| ${t.session} | ${PERSONA_LABEL[t.persona]} | ${LANG_LABEL[t.language]} | ${STYLE_LABEL[t.style]} | ${STEP_LABEL[t.step]} | ${tags.join('、')} | ${said} |`)
  }
  push('')
}

await writeFile(reportFile, lines.join('\n'))
console.log(`report written: ${reportFile}`)
