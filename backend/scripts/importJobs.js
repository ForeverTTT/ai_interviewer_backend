/**
 * 把飞书多维表格导出的 Excel / CSV 导入 job_postings。
 *
 *   node scripts/importJobs.js <xlsx|csv...> [--sheet 工作表名] [--category 分类] [--source 来源名] [--replace] [--dry-run] [--sample]
 *
 * - Excel：默认导入所有带「公司」和「招聘岗位」列的工作表（名录、内推码这类表会跳过），
 *   --sheet 只导入指定的一张。
 * - 分类：表里有「批次」列（飞书总表）就按批次归成 秋招 / 春招 / 实习 / 社招；
 *   没有时用 --category，再没有用工作表名（Excel）或文件名（CSV）。
 * - 按 external_key upsert，重复导入同一份文件不会产生重复行。
 * - --replace：同一来源（--source）下，这次导入（所有文件合计）里已经没有的旧岗位会被删掉。
 *   所以分 tab 导出的 CSV 要放在同一条命令里一起导入。
 * - --dry-run：只解析并打印统计和没识别的列，不写库；加 --sample 再打印一条解析结果。
 */
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { parseArgs } from 'node:util'
import { parseCsv, mapJobRow, unmappedHeaders, JOB_FIELD_ALIASES, STALE_AFTER_DAYS } from '../src/lib/feishuImport.js'
import { readXlsx } from '../src/lib/xlsx.js'

const { values: opts, positionals: files } = parseArgs({
  allowPositionals: true,
  options: {
    sheet: { type: 'string' },
    category: { type: 'string' },
    source: { type: 'string', default: '飞书求职汇总表' },
    replace: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    sample: { type: 'boolean', default: false },
  },
})

if (!files.length) {
  console.error('用法: node scripts/importJobs.js <xlsx|csv...> [--sheet 工作表] [--category 分类] [--source 来源] [--replace] [--dry-run] [--sample]')
  process.exit(1)
}

const BATCH = 500
const { supabase } = opts['dry-run'] ? {} : await import('../src/lib/supabase.js')
// 写库前先说清楚写到哪：手动设置的 SUPABASE_URL 优先于 backend/.env（本地开发库）
if (!opts['dry-run']) console.log(`目标数据库: ${process.env.SUPABASE_URL || '(未设置 SUPABASE_URL)'}`)

function hasColumn(rows, aliases) {
  const headers = Object.keys(rows[0] || {}).map(h => h.replace(/\s*\(\d+\)$/, ''))
  return aliases.some(a => headers.includes(a))
}

/** 每个文件拆成若干「表」：CSV 一张，Excel 每个像招聘表的工作表一张 */
async function loadTables(file) {
  if (extname(file).toLowerCase() === '.xlsx') {
    const sheets = readXlsx(await readFile(file))
    const picked = opts.sheet
      ? sheets.filter(s => s.name === opts.sheet)
      : sheets.filter(s => hasColumn(s.rows, JOB_FIELD_ALIASES.company) && hasColumn(s.rows, JOB_FIELD_ALIASES.positions))
    for (const s of sheets) {
      if (!picked.includes(s)) console.log(`  跳过工作表「${s.name}」（${opts.sheet ? '未指定' : '没有公司 / 招聘岗位列'}）`)
    }
    if (opts.sheet && !picked.length) throw new Error(`找不到工作表「${opts.sheet}」，可选: ${sheets.map(s => s.name).join('、')}`)
    return picked.map(s => ({ label: s.name, rows: s.rows, fallback: opts.category || s.name }))
  }
  const name = basename(file, extname(file))
  return [{ label: name, rows: parseCsv(await readFile(file, 'utf8')), fallback: opts.category || name }]
}

function tally(list, pickValues, top = 12) {
  const counts = new Map()
  for (const item of list) for (const v of pickValues(item)) counts.set(v, (counts.get(v) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, n]) => `${k} ${n}`).join('，')
}

async function existingKeys(source) {
  const keys = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('job_postings')
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
const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86400000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)

for (const file of files) {
  console.log(`\n${file}`)
  for (const table of await loadTables(file)) {
    const byKey = new Map()
    let skipped = 0
    for (const row of table.rows) {
      const job = mapJobRow(row, { category: table.fallback, source: opts.source })
      if (job) byKey.set(job.external_key, job)
      else skipped++
    }
    const jobs = [...byKey.values()]
    const open = jobs.filter(j => (j.deadline_date ? j.deadline_date >= today : !j.source_updated_at || j.source_updated_at >= staleCutoff))

    console.log(`\n[${table.label}]`)
    console.log(`  行数 ${table.rows.length}，有效岗位 ${jobs.length}，跳过 ${skipped}（缺公司名或说明行），重复合并 ${table.rows.length - skipped - jobs.length}`)
    if (table.rows[0]) {
      const extra = unmappedHeaders(table.rows[0])
      if (extra.length) console.log(`  未识别的列（不会导入）: ${extra.join('、')}`)
    }
    console.log(`  有投递链接 ${jobs.filter(j => j.apply_url).length}，有截止日期 ${jobs.filter(j => j.deadline_date).length}，按「只看未截止」能看到 ${open.length}`)
    console.log(`  分类: ${tally(jobs, j => [j.category])}`)
    console.log(`  企业类型: ${tally(jobs, j => [j.company_type || '(空)'])}`)
    console.log(`  企业分类: ${tally(jobs, j => j.industry_keys, 20)}`)
    console.log(`  岗位类别: ${tally(jobs, j => j.job_functions, 20)}`)
    console.log(`  届次: ${tally(jobs, j => j.graduation_years, 10)}`)

    if (opts['dry-run']) {
      if (opts.sample && jobs[0]) console.log('  示例:', JSON.stringify(jobs[0], null, 2).replace(/\n/g, '\n  '))
      continue
    }

    for (let i = 0; i < jobs.length; i += BATCH) {
      const { error } = await supabase
        .from('job_postings')
        .upsert(jobs.slice(i, i + BATCH), { onConflict: 'external_key' })
      if (error) throw error
    }
    for (const key of byKey.keys()) imported.add(key)
    console.log(`  已写入 ${jobs.length} 条`)
  }
}

if (opts.replace && !opts['dry-run']) {
  const stale = (await existingKeys(opts.source)).filter(k => !imported.has(k))
  for (let i = 0; i < stale.length; i += 100) {
    const { error } = await supabase.from('job_postings').delete().in('external_key', stale.slice(i, i + 100))
    if (error) throw error
  }
  console.log(`\n来源「${opts.source}」下已删除这次导入里没有的旧岗位 ${stale.length} 条`)
}
