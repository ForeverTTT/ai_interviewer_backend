#!/usr/bin/env node
import '../src/config/env.js'
import { companySourceDisplayName } from '../src/lib/companySourceDiscovery.js'
import { fetchHotjobJobFromUrl } from '../src/lib/hotjobImport.js'
import { importJobTables } from '../src/lib/jobImport.js'
import { fetchMokaJobsSnapshot } from '../src/lib/mokaJobImport.js'
import { supabase } from '../src/lib/supabase.js'

async function allRows(table, columns, apply) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(columns).order('id').range(from, from + 999)
    query = apply ? apply(query) : query
    const { data, error } = await query
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

const activeLinks = await allRows(
  'job_posting_sources',
  'job_posting_id,source_url,source_name',
  query => query.eq('is_active', true).eq('source_type', 'ats').not('source_url', 'is', null),
)
const duplicateGroups = Object.values(Object.groupBy(activeLinks, row => `${row.source_name}|${row.source_url}`))
  .filter(group => new Set(group.map(row => row.job_posting_id)).size > 1)
const duplicateUrlsBySource = Object.groupBy(duplicateGroups, group => group[0].source_name)
if (!duplicateGroups.length) {
  console.log('没有需要修复的 ATS 职位 URL')
  process.exit(0)
}

const registry = await allRows(
  'company_job_sources',
  'source_key,company_name,platform,seed_url,options,status,adapter',
  query => query.eq('status', 'active').not('adapter', 'is', null),
)
const registryByName = new Map(registry.map(row => [companySourceDisplayName(row), row]))
let repairedUrls = 0
for (const [sourceName, groups] of Object.entries(duplicateUrlsBySource)) {
  const source = registryByName.get(sourceName)
  if (!source) {
    console.warn(`跳过无活跃目录配置的来源：${sourceName}`)
    continue
  }
  const wanted = new Set(groups.map(group => group[0].source_url))
  let rows
  if (source.platform === 'hotjob') {
    rows = []
    for (const sourceUrl of wanted) {
      rows.push(await fetchHotjobJobFromUrl({ companyName: source.company_name, sourceUrl }))
    }
  } else if (source.platform === 'moka') {
    const snapshot = await fetchMokaJobsSnapshot({
      companyName: source.company_name,
      startUrl: source.seed_url,
      ...(source.options || {}),
    })
    if (!snapshot.complete) throw new Error(`${sourceName} Moka 快照不完整，停止修复`)
    rows = snapshot.rows.filter(row => wanted.has(row.职位详情链接))
  } else {
    console.warn(`跳过未支持的平台 ${source.platform}：${sourceName}`)
    continue
  }
  if (rows.length !== wanted.size) throw new Error(`${sourceName} 需修复 ${wanted.size} 个 URL，仅找到 ${rows.length} 个`)
  await importJobTables([{ label: sourceName, rows, fallback: '其他' }], {
    supabase,
    source: sourceName,
    sourceType: 'ats',
  })
  const { data: deactivated, error: dedupeError } = await supabase.rpc('dedupe_active_job_source_urls', {
    p_source_name: sourceName,
  })
  if (dedupeError) throw dedupeError
  repairedUrls += rows.length
  console.log(`✓ ${sourceName}: 修复 ${rows.length} 个 URL，停用 ${deactivated} 个旧拆分来源`)
}

console.log(`修复完成：${repairedUrls} 个 ATS 官方职位 URL`)
