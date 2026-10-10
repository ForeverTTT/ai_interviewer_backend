/**
 * 把飞书多维表格导出的 CSV 导入 job_postings。
 *
 *   node scripts/importJobs.js <csv...> [--category 互联网] [--source 来源名] [--replace] [--dry-run]
 *
 * - 每个 tab（央国企 / 外企 / 互联网 …）单独导出一个 CSV；不传 --category 时用文件名当分类。
 * - 按 external_key upsert，重复导入同一份文件不会产生重复行。
 * - --replace：同分类 + 同来源下，这次 CSV 里已经没有的旧岗位会被删掉。
 * - --dry-run：只解析并打印统计和没识别的列，不写库。
 */
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { parseArgs } from 'node:util'
import { parseCsv, mapJobRow, unmappedHeaders } from '../src/lib/feishuImport.js'

const { values: opts, positionals: files } = parseArgs({
  allowPositionals: true,
  options: {
    category: { type: 'string' },
    source: { type: 'string', default: '飞书求职汇总表' },
    replace: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
})

if (!files.length) {
  console.error('用法: node scripts/importJobs.js <csv...> [--category 分类] [--source 来源] [--replace] [--dry-run]')
  process.exit(1)
}

const BATCH = 500
const { supabase } = opts['dry-run'] ? {} : await import('../src/lib/supabase.js')

async function existingKeys(category, source) {
  const keys = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('job_postings')
      .select('external_key')
      .eq('category', category)
      .eq('source', source)
      .range(from, from + 999)
    if (error) throw error
    keys.push(...data.map(r => r.external_key))
    if (data.length < 1000) return keys
  }
}

for (const file of files) {
  const category = opts.category || basename(file, extname(file))
  const rows = parseCsv(await readFile(file, 'utf8'))
  const byKey = new Map()
  let skipped = 0
  for (const row of rows) {
    const job = mapJobRow(row, { category, source: opts.source })
    if (job) byKey.set(job.external_key, job)
    else skipped++
  }
  const jobs = [...byKey.values()]

  console.log(`\n[${category}] ${file}`)
  console.log(`  CSV 行数 ${rows.length}，有效岗位 ${jobs.length}，缺公司名跳过 ${skipped}，重复合并 ${rows.length - skipped - jobs.length}`)
  if (rows[0]) {
    const extra = unmappedHeaders(rows[0])
    if (extra.length) console.log(`  未识别的列（不会导入）: ${extra.join('、')}`)
  }
  console.log(`  有投递链接 ${jobs.filter(j => j.apply_url).length}，有截止日期 ${jobs.filter(j => j.deadline_date).length}`)

  if (opts['dry-run']) {
    if (jobs[0]) console.log('  示例:', JSON.stringify(jobs[0], null, 2).replace(/\n/g, '\n  '))
    continue
  }

  for (let i = 0; i < jobs.length; i += BATCH) {
    const { error } = await supabase
      .from('job_postings')
      .upsert(jobs.slice(i, i + BATCH), { onConflict: 'external_key' })
    if (error) throw error
  }
  console.log(`  已写入 ${jobs.length} 条`)

  if (opts.replace) {
    const stale = (await existingKeys(category, opts.source)).filter(k => !byKey.has(k))
    for (let i = 0; i < stale.length; i += 100) {
      const { error } = await supabase.from('job_postings').delete().in('external_key', stale.slice(i, i + 100))
      if (error) throw error
    }
    console.log(`  已删除下架岗位 ${stale.length} 条`)
  }
}
