/**
 * 批量导入面经到 interview_experiences（导入的面经没有站内作者，发布者显示为来源名）。
 *
 *   node scripts/importExperiences.js <file.md|file.csv|file.json...> [--source 来源名] [--replace] [--dry-run]
 *
 * 导入的面经直接进公开面经库（public / approved），不走审核。
 *
 * Markdown：飞书「面经分享」文档导出的 .md，每个「## 面经分享…」标题一篇，
 *   拆分规则见 src/lib/experienceMarkdown.js。
 * CSV：一行一轮面试，同「公司 + 岗位 + 日期」的行合并成一篇。识别的列：
 *   公司 岗位 类型 部门 地点 日期 语言 结果 薪资 轮次 面试形式 时长 面试题 心得
 *   「面试题」一格里多道题用换行或「;」分隔。
 * 「类型」写实习 / 校招 / 社招，认不出时按校招。
 * JSON：数组，字段同站内发布面经（company / position / type / rounds[{format, duration_min, questions, answers}] / reflection …）。
 *
 * 按 external_key upsert，重复导入（包括文档里重复贴的同一篇）不会产生重复面经。
 * --replace：同一来源下，这次导入（所有文件合计）里已经没有的旧面经会被删掉。
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { parseArgs } from 'node:util'
import { parseCsv, mapExperienceCsvRows, mapExperienceJson } from '../src/lib/feishuImport.js'
import { parseExperienceMarkdown } from '../src/lib/experienceMarkdown.js'

const { values: opts, positionals: files } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string', default: '飞书求职汇总表' },
    replace: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
})

if (!files.length) {
  console.error('用法: node scripts/importExperiences.js <file.md|file.csv|file.json...> [--source 来源] [--replace] [--dry-run]')
  process.exit(1)
}

const { supabase } = opts['dry-run'] ? {} : await import('../src/lib/supabase.js')
// 写库前先说清楚写到哪：手动设置的 SUPABASE_URL 优先于 backend/.env（本地开发库）
if (!opts['dry-run']) console.log(`目标数据库: ${process.env.SUPABASE_URL || '(未设置 SUPABASE_URL)'}`)

function parseFile(file, text) {
  const ext = extname(file).toLowerCase()
  if (ext === '.json') return mapExperienceJson(JSON.parse(text.replace(/^﻿/, '')), { source: opts.source })
  if (ext === '.md' || ext === '.markdown') return mapExperienceJson(parseExperienceMarkdown(text), { source: opts.source })
  return mapExperienceCsvRows(parseCsv(text), { source: opts.source })
}

async function existingKeys(source) {
  const keys = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('interview_experiences')
      .select('external_key')
      .eq('source', source)
      // 分页必须有固定顺序，否则各页之间会重复 / 漏行
      .order('id')
      .range(from, from + 999)
    if (error) throw error
    keys.push(...data.map(r => r.external_key))
    if (data.length < 1000) return keys
  }
}

const imported = new Set()

for (const file of files) {
  const mapped = parseFile(file, await readFile(file, 'utf8'))
  const experiences = [...new Map(mapped.map(e => [e.external_key, e])).values()]

  const questionCount = experiences.reduce((n, e) => n + e.rounds.reduce((m, r) => m + r.questions.length, 0), 0)
  const companies = new Set(experiences.map(e => e.company))
  console.log(`\n${file}: ${experiences.length} 篇面经（重复合并 ${mapped.length - experiences.length}），${companies.size} 家公司，${questionCount} 道题，没拆出题目的 ${experiences.filter(e => !e.rounds.length).length} 篇`)

  if (opts['dry-run']) {
    if (experiences[0]) console.log('  示例:', JSON.stringify(experiences[0], null, 2).replace(/\n/g, '\n  '))
    continue
  }

  for (let i = 0; i < experiences.length; i += 200) {
    const { error } = await supabase
      .from('interview_experiences')
      .upsert(experiences.slice(i, i + 200), { onConflict: 'external_key' })
    if (error) throw error
  }
  for (const e of experiences) imported.add(e.external_key)
  console.log(`  已写入 ${experiences.length} 篇`)
}

if (opts.replace && !opts['dry-run']) {
  const stale = (await existingKeys(opts.source)).filter(k => !imported.has(k))
  for (let i = 0; i < stale.length; i += 100) {
    const { error } = await supabase.from('interview_experiences').delete().in('external_key', stale.slice(i, i + 100))
    if (error) throw error
  }
  console.log(`\n来源「${opts.source}」下已删除这次导入里没有的旧面经 ${stale.length} 篇`)
}
