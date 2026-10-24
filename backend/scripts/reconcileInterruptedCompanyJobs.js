#!/usr/bin/env node
// 同步进程被中断时，已完整导入的来源可能还没来得及回写目录状态。
// 该脚本只恢复能找到活跃 job_posting_sources 的来源，不会把半截或空快照标成成功。
import { parseArgs } from 'node:util'
import '../src/config/env.js'
import { companySourceDisplayName } from '../src/lib/companySourceDiscovery.js'
import { supabase } from '../src/lib/supabase.js'

const { values: opts } = parseArgs({ options: {
  platform: { type: 'string' },
  limit: { type: 'string' },
  offset: { type: 'string' },
} })

const offset = Number.parseInt(opts.offset || '0', 10)
const limit = Number.parseInt(opts.limit || '50', 10)
let query = supabase
  .from('company_job_sources')
  .select('*')
  .eq('status', 'active')
  .not('adapter', 'is', null)
  .order('company_name')
  .range(offset, offset + limit - 1)
if (opts.platform) query = query.eq('platform', opts.platform)
const { data, error } = await query
if (error) throw error

let recovered = 0
for (const source of data) {
  const sourceName = companySourceDisplayName(source)
  const { count, error: countError } = await supabase
    .from('job_posting_sources')
    .select('id', { count: 'exact', head: true })
    .eq('source_name', sourceName)
    .eq('is_active', true)
  if (countError) throw countError
  if (!count) continue

  const { error: dedupeError } = await supabase.rpc('dedupe_active_job_source_urls', {
    p_source_name: sourceName,
  })
  if (dedupeError) throw dedupeError

  if (source.options?.previousSourceNames?.length) {
    const { error: retireError } = await supabase.rpc('retire_job_source_snapshots', {
      p_source_names: source.options.previousSourceNames,
    })
    if (retireError) throw retireError
  }
  const now = new Date().toISOString()
  const options = Object.fromEntries(Object.entries(source.options || {}).filter(([key]) => key !== 'previousSourceNames'))
  const { error: updateError } = await supabase.from('company_job_sources').update({
    last_attempt_at: now,
    last_success_at: now,
    last_error: null,
    updated_at: now,
    options,
  }).eq('source_key', source.source_key)
  if (updateError) throw updateError
  recovered++
  console.log(`✓ ${sourceName}: 恢复 ${count} 个活跃岗位来源`)
}

console.log(`已检查 ${data.length} 个目录来源，恢复 ${recovered} 个已完整导入的来源`)
