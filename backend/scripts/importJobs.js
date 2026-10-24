/**
 * 把飞书多维表格导出的 Excel / CSV 导入 job_postings。
 *
 *   node scripts/importJobs.js <xlsx|csv...> [--sheet 工作表名] [--category 分类] [--source 来源名] [--source-type feishu|official|user] [--replace] [--dry-run] [--sample]
 *
 * - Excel：默认导入所有带「公司」和「招聘岗位」列的工作表（名录、内推码这类表会跳过），
 *   --sheet 只导入指定的一张。
 * - 分类：表里有「批次」列（飞书总表）就按批次归成 秋招 / 春招 / 实习 / 社招；
 *   没有时用 --category，再没有用工作表名（Excel）或文件名（CSV）。
 * - 按 external_key upsert，重复导入同一份文件不会产生重复行。
 * - --replace：同一来源（--source）下，这次导入里已经没有的来源记录会停用；无其他有效来源的岗位关闭。
 *   所以分 tab 导出的 CSV 要放在同一条命令里一起导入。
 * - --dry-run：只解析并打印统计和没识别的列，不写库；加 --sample 再打印一条解析结果。
 */
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { parseArgs } from 'node:util'
import { parseCsv, JOB_FIELD_ALIASES } from '../src/lib/feishuImport.js'
import { importJobTables } from '../src/lib/jobImport.js'
import { readXlsx } from '../src/lib/xlsx.js'

const { values: opts, positionals: files } = parseArgs({
  allowPositionals: true,
  options: {
    sheet: { type: 'string' },
    category: { type: 'string' },
    source: { type: 'string', default: '飞书求职汇总表' },
    'source-type': { type: 'string', default: 'feishu' },
    replace: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    sample: { type: 'boolean', default: false },
  },
})

if (!files.length) {
  console.error('用法: node scripts/importJobs.js <xlsx|csv...> [--sheet 工作表] [--category 分类] [--source 来源] [--replace] [--dry-run] [--sample]')
  process.exit(1)
}

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

const tables = []
for (const file of files) {
  console.log(`
${file}`)
  tables.push(...await loadTables(file))
}
await importJobTables(tables, {
  supabase,
  source: opts.source,
  sourceType: opts['source-type'],
  replace: opts.replace,
  dryRun: opts['dry-run'],
  sample: opts.sample,
})
