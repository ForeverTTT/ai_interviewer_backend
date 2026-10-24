#!/usr/bin/env node
/**
 * 企业官网岗位同步器：每个企业独立抓取完整快照，再新增/更新/失效岗位。
 *
 * node scripts/syncCompanyJobs.js [--source huawei-campus] [--dry-run] [--sample] [--limit 3] [--force]
 */
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import '../src/config/env.js'
import { syncCompanyJobSources } from '../src/lib/companyJobSync.js'

const { values: opts } = parseArgs({
  options: {
    config: { type: 'string', default: fileURLToPath(new URL('../config/company-job-sources.json', import.meta.url)) },
    source: { type: 'string', multiple: true, default: [] },
    limit: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    sample: { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    'allow-source-failures': { type: 'boolean', default: false },
  },
})

const limit = opts.limit == null ? undefined : Number.parseInt(opts.limit, 10)
if (limit != null && (!Number.isInteger(limit) || limit < 1)) {
  console.error('--limit 必须是正整数')
  process.exit(1)
}

const config = JSON.parse(await readFile(opts.config, 'utf8'))
const { supabase } = opts['dry-run'] ? {} : await import('../src/lib/supabase.js')
if (!opts['dry-run']) console.log(`目标数据库: ${process.env.SUPABASE_URL || '(未设置 SUPABASE_URL)'}`)

const results = await syncCompanyJobSources(config.sources || [], {
  supabase,
  dryRun: opts['dry-run'],
  sample: opts.sample,
  force: opts.force,
  selectedIds: opts.source,
  limit,
})

console.log('\n同步结果')
for (const result of results) {
  console.log(result.ok
    ? `  ✓ ${result.name}: ${result.rows} 条，写入 ${result.written}，关闭 ${result.deleted}`
    : `  ✗ ${result.name}: ${result.error}`)
}
const failures = results.filter(result => !result.ok)
if (failures.length && opts['allow-source-failures']) {
  for (const result of failures) {
    const message = String(result.error || '未知错误').replace(/[\r\n]+/g, ' ')
    console.warn(`::warning title=${result.name} 同步失败::${message}；数据库中的旧快照已保留`)
  }
  console.warn(`本轮有 ${failures.length} 个外部来源失败，其余来源已正常更新；失败来源旧岗位保持不变`)
} else if (failures.length) {
  process.exitCode = 1
}
