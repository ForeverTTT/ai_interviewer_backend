#!/usr/bin/env node
import { parseArgs } from 'node:util'
import '../src/config/env.js'
import { discoverCompanySources } from '../src/lib/companySourceDiscovery.js'
import { supabase } from '../src/lib/supabase.js'

const { values: opts } = parseArgs({ options: {
  source: { type: 'string', default: '飞书求职汇总表' },
  limit: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  'prune-stale': { type: 'boolean', default: false },
} })
const limit = opts.limit ? Number.parseInt(opts.limit, 10) : undefined
if (limit != null && (!Number.isInteger(limit) || limit < 1)) throw new Error('--limit 必须是正整数')

console.log(`目标数据库: ${process.env.SUPABASE_URL || '(未设置 SUPABASE_URL)'}`)
const result = await discoverCompanySources({
  supabase,
  sourceName: opts.source,
  dryRun: opts['dry-run'],
  limit,
  pruneStale: opts['prune-stale'],
})
console.log(opts['dry-run'] ? '仅分析，未写入来源目录' : `已写入 ${result.written} 个来源入口`)
