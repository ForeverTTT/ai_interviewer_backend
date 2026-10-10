/**
 * 直接从飞书多维表格拉取招聘信息写进 job_postings（每天由 GitHub Actions 定时跑，也可手动跑）。
 *
 *   node scripts/syncFeishuJobs.js [--url 多维表格链接] [--source 来源名] [--dry-run] [--sample] [--force]
 *
 * 环境变量：
 *   FEISHU_APP_ID / FEISHU_APP_SECRET  飞书自建应用凭证
 *   FEISHU_JOBS_URL                    多维表格链接（--url 优先）
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *
 * - 链接带 ?table= 就只同步那张表；不带则同步表格里所有有「公司」和「招聘岗位」列的数据表。
 * - 和 importJobs.js --replace 一样：同一来源下，飞书里已经删掉的岗位也从库里删掉。
 * - 这次拉到的岗位数不到库里现有的一半时不写库、直接报错（防止接口出错把求职页清空），
 *   确实是表格大幅删减时加 --force。
 */
import { parseArgs } from 'node:util'
import '../src/config/env.js'
import { JOB_FIELD_ALIASES } from '../src/lib/feishuImport.js'
import { createBitableClient, parseBitableUrl, recordToRow } from '../src/lib/feishuBitable.js'
import { importJobTables } from '../src/lib/jobImport.js'

const { values: opts } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.FEISHU_JOBS_URL },
    source: { type: 'string', default: '飞书求职汇总表' },
    'dry-run': { type: 'boolean', default: false },
    sample: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
})

const missing = ['FEISHU_APP_ID', 'FEISHU_APP_SECRET'].filter(k => !process.env[k])
if (!opts.url) missing.push('FEISHU_JOBS_URL（或 --url）')
if (missing.length) {
  console.error(`缺少配置: ${missing.join('、')}`)
  process.exit(1)
}

const { appToken, tableId } = parseBitableUrl(opts.url)
const client = createBitableClient({ appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET })

const hasColumn = (fields, aliases) => fields.some(f => aliases.includes(f.field_name))

const allTables = await client.listTables(appToken)
let picked = allTables
if (tableId) {
  picked = allTables.filter(t => t.table_id === tableId)
  if (!picked.length) throw new Error(`表格里找不到数据表 ${tableId}，可选: ${allTables.map(t => `${t.name}(${t.table_id})`).join('、')}`)
}

const tables = []
for (const t of picked) {
  const fields = await client.listFields(appToken, t.table_id)
  if (!tableId && !(hasColumn(fields, JOB_FIELD_ALIASES.company) && hasColumn(fields, JOB_FIELD_ALIASES.positions))) {
    console.log(`跳过数据表「${t.name}」（没有公司 / 招聘岗位列）`)
    continue
  }
  const rows = (await client.listRecords(appToken, t.table_id)).map(r => recordToRow(r, fields))
  console.log(`读取数据表「${t.name}」${rows.length} 行`)
  tables.push({ label: t.name, rows, fallback: t.name })
}

const { supabase } = opts['dry-run'] ? {} : await import('../src/lib/supabase.js')
if (!opts['dry-run']) console.log(`目标数据库: ${process.env.SUPABASE_URL || '(未设置 SUPABASE_URL)'}`)

const result = await importJobTables(tables, {
  supabase,
  source: opts.source,
  replace: true,
  dryRun: opts['dry-run'],
  sample: opts.sample,
  minKeepRatio: opts.force ? 0 : 0.5,
})
if (!opts['dry-run']) console.log(`\n同步完成：写入 ${result.written} 条，删除 ${result.deleted} 条`)
