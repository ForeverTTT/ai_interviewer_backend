#!/usr/bin/env node
import { parseArgs } from 'node:util'
import '../src/config/env.js'
import { syncCompanyJobSources } from '../src/lib/companyJobSync.js'
import { companySourceDisplayName } from '../src/lib/companySourceDiscovery.js'
import { supabase } from '../src/lib/supabase.js'

const { values: opts } = parseArgs({ options: {
  platform: { type: 'string' },
  company: { type: 'string' },
  source: { type: 'string', multiple: true, default: [] },
  'limit-sources': { type: 'string' },
  'offset-sources': { type: 'string' },
  'job-limit': { type: 'string' },
  'failed-only': { type: 'boolean', default: false },
  'never-attempted': { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  sample: { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
} })

// 每轮优先处理从未尝试或最久没有尝试的来源。配合 --limit-sources 可滚动覆盖整个目录，
// 某个持续失败的租户也不会永远挡住后面的公司。
let query = supabase
  .from('company_job_sources')
  .select('*')
  .eq('status', 'active')
  .not('adapter', 'is', null)
  .order('last_attempt_at', { ascending: true, nullsFirst: true })
  .order('company_name')
  .order('source_key')
if (opts.platform) query = query.eq('platform', opts.platform)
if (opts.company) query = query.eq('company_name', opts.company)
if (opts.source.length) query = query.in('source_key', opts.source)
if (opts['failed-only']) query = query.not('last_error', 'is', null)
if (opts['never-attempted']) query = query.is('last_attempt_at', null)
const sourceOffset = opts['offset-sources'] ? Number.parseInt(opts['offset-sources'], 10) : 0
if (opts['limit-sources']) {
  const sourceLimit = Number.parseInt(opts['limit-sources'], 10)
  query = query.range(sourceOffset, sourceOffset + sourceLimit - 1)
} else if (sourceOffset) {
  query = query.range(sourceOffset, sourceOffset + 999)
}
const { data, error } = await query
if (error) throw error

const sources = data.map(row => ({
  id: row.source_key,
  // source_name 也是快照下架的隔离键；短哈希避免同一公司多个校招/社招租户互相下架。
  name: companySourceDisplayName(row),
  companyName: row.company_name,
  adapter: row.adapter,
  seedUrl: row.seed_url,
  options: row.options || {},
  sourceType: ['moka', 'hotjob', 'feishu-career', 'zhiye'].includes(row.platform) ? 'ats' : 'official',
  fallbackCategory: '其他',
  requiredMissingRuns: 2,
  minKeepRatio: 0.55,
  // Moka 的公共接口会对连续跨租户请求限流；站点之间留出间隔，单站点内部仍使用较短分页间隔。
  sourceDelayMs: row.platform === 'moka' ? 1200 : row.platform === 'hotjob' ? 1200 : 350,
  enabled: true,
}))
if (!sources.length) throw new Error('没有符合条件且可同步的企业来源')

const jobLimit = opts['job-limit'] ? Number.parseInt(opts['job-limit'], 10) : undefined
const recordResult = opts['dry-run'] ? undefined : async (result, source) => {
  const attemptedAt = new Date().toISOString()
  if (result.ok && source.sourceType === 'ats') {
    const { error: dedupeError } = await supabase.rpc('dedupe_active_job_source_urls', {
      p_source_name: source.name,
    })
    if (dedupeError) console.error(`ATS 职位链接去重失败 ${result.id}: ${dedupeError.message}`)
  }
  if (result.ok && source?.options?.previousSourceNames?.length) {
    const { error: retireError } = await supabase.rpc('retire_job_source_snapshots', {
      p_source_names: source.options.previousSourceNames,
    })
    if (retireError) console.error(`旧来源快照停用失败 ${result.id}: ${retireError.message}`)
  }
  const patch = result.ok
    ? {
        last_attempt_at: attemptedAt,
        last_success_at: attemptedAt,
        last_error: null,
        updated_at: attemptedAt,
        ...(source?.options?.previousSourceNames?.length
          ? { options: Object.fromEntries(Object.entries(source.options).filter(([key]) => key !== 'previousSourceNames')) }
          : {}),
      }
    : { last_attempt_at: attemptedAt, last_error: result.error, updated_at: attemptedAt }
  const { error: updateError } = await supabase.from('company_job_sources').update(patch).eq('source_key', result.id)
  if (updateError) console.error(`来源状态回写失败 ${result.id}: ${updateError.message}`)
}
const results = await syncCompanyJobSources(sources, {
  supabase,
  dryRun: opts['dry-run'],
  sample: opts.sample,
  force: opts.force,
  limit: jobLimit,
  onResult: recordResult,
})
for (const result of results) console.log(result.ok
  ? `✓ ${result.name}: ${result.rows} 条，写入 ${result.written}，关闭 ${result.deleted}`
  : `✗ ${result.name}: ${result.error}`)
if (results.some(result => !result.ok)) process.exitCode = 1
