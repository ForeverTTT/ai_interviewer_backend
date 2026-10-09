/**
 * 批量导入面经到 interview_experiences（导入的面经没有站内作者，发布者显示为来源名）。
 *
 *   node scripts/importExperiences.js <file.csv|file.json...> [--source 来源名] [--dry-run]
 *
 * 导入的面经直接进公开面经库（public / approved），不走审核。
 *
 * CSV：一行一轮面试，同「公司 + 岗位 + 日期」的行合并成一篇。识别的列：
 *   公司 岗位 类型 部门 地点 日期 语言 结果 薪资 轮次 面试形式 时长 面试题 心得
 *   「面试题」一格里多道题用换行或「;」分隔。
 * 「类型」写实习 / 校招 / 社招，认不出时按校招。
 * JSON：数组，字段同站内发布面经（company / position / type / rounds[{format, duration_min, questions, answers}] / reflection …）。
 *
 * 按 external_key upsert，重复导入不会产生重复面经。
 */
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { parseArgs } from 'node:util'
import { parseCsv, mapExperienceCsvRows, mapExperienceJson } from '../src/lib/feishuImport.js'

const { values: opts, positionals: files } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string', default: '飞书求职汇总表' },
    'dry-run': { type: 'boolean', default: false },
  },
})

if (!files.length) {
  console.error('用法: node scripts/importExperiences.js <file.csv|file.json...> [--source 来源] [--dry-run]')
  process.exit(1)
}

const { supabase } = opts['dry-run'] ? {} : await import('../src/lib/supabase.js')

for (const file of files) {
  const text = await readFile(file, 'utf8')
  const mapped = extname(file).toLowerCase() === '.json'
    ? mapExperienceJson(JSON.parse(text.replace(/^﻿/, '')), { source: opts.source })
    : mapExperienceCsvRows(parseCsv(text), { source: opts.source })
  const experiences = [...new Map(mapped.map(e => [e.external_key, e])).values()]

  const questionCount = experiences.reduce((n, e) => n + e.rounds.reduce((m, r) => m + r.questions.length, 0), 0)
  console.log(`\n${file}: ${experiences.length} 篇面经，${questionCount} 道题`)

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
  console.log(`  已写入 ${experiences.length} 篇`)
}
