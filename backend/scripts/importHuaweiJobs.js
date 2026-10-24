#!/usr/bin/env node
/**
 * 从华为招聘官网公开使用的职位接口导入逐岗位完整 JD。
 *
 * node scripts/importHuaweiJobs.js [--keyword AI] [--limit 50] [--replace] [--dry-run] [--sample]
 *
 * 接口无需登录，脚本只读取官网公开信息，不处理验证码或绕过访问限制。
 */
import { parseArgs } from 'node:util'
import '../src/config/env.js'
import { fetchHuaweiCampusSnapshot } from '../src/lib/huaweiJobImport.js'
import { importJobTables } from '../src/lib/jobImport.js'

const { values: opts } = parseArgs({
  options: {
    keyword: { type: 'string', default: '' },
    limit: { type: 'string' },
    replace: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    sample: { type: 'boolean', default: false },
  },
})

const limit = opts.limit == null ? Infinity : Number.parseInt(opts.limit, 10)
if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) {
  console.error('--limit 必须是正整数')
  process.exit(1)
}

console.log(`正在读取华为招聘官网公开岗位${opts.keyword ? `（关键词：${opts.keyword}）` : ''}${limit === Infinity ? '（全量）' : `，最多 ${limit} 条`}…`)
const snapshot = await fetchHuaweiCampusSnapshot({
  keyword: opts.keyword,
  limit,
  wait: () => new Promise(resolve => setTimeout(resolve, 150)),
})
const { rows } = snapshot
console.log(`已取得 ${rows.length} 条带完整 JD 的岗位`)
if (opts.replace && !snapshot.complete) {
  console.error('本次不是完整快照，不能使用 --replace 下架旧岗位。请去掉 --keyword/--limit，或去掉 --replace。')
  process.exit(1)
}

const { supabase } = opts['dry-run'] ? {} : await import('../src/lib/supabase.js')
if (!opts['dry-run']) console.log(`目标数据库: ${process.env.SUPABASE_URL || '(未设置 SUPABASE_URL)'}`)
await importJobTables([{ label: '华为招聘官网', rows, fallback: '秋招' }], {
  supabase,
  source: '华为招聘官网',
  sourceType: 'official',
  replace: opts.replace,
  minKeepRatio: 0.5,
  dryRun: opts['dry-run'],
  sample: opts.sample,
})
