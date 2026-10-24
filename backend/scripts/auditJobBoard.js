#!/usr/bin/env node
import { parseArgs } from 'node:util'
import '../src/config/env.js'
import { chinaCalendarDate } from '../src/lib/chinaDate.js'
import { supabase } from '../src/lib/supabase.js'

const PAGE_SIZE = 1000

const { values: opts } = parseArgs({ options: {
  json: { type: 'boolean', default: false },
  strict: { type: 'boolean', default: false },
  'stale-hours': { type: 'string', default: '36' },
} })

const staleHours = Number.parseInt(opts['stale-hours'], 10)
if (!Number.isFinite(staleHours) || staleHours < 1) throw new Error('--stale-hours 必须是正整数')

async function readAll(table, columns, configure = query => query) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select(columns).order('id').range(from, from + PAGE_SIZE - 1)
    query = configure(query)
    const { data, error } = await query
    if (error) throw error
    rows.push(...data)
    if (data.length < PAGE_SIZE) return rows
  }
}

function tally(rows, key) {
  return Object.fromEntries([...rows.reduce((counts, row) => {
    const value = row[key] ?? '(空)'
    counts.set(value, (counts.get(value) || 0) + 1)
    return counts
  }, new Map())].sort(([a], [b]) => String(a).localeCompare(String(b), 'zh-CN')))
}

function invalidHttpUrl(value) {
  if (!value) return false
  try {
    const url = new URL(value)
    return !['http:', 'https:'].includes(url.protocol)
  } catch {
    return true
  }
}

const [jobs, sources, directory] = await Promise.all([
  readAll('job_postings', 'id,status,source_type,content_quality,apply_url,jd_url,deadline_date'),
  readAll('job_posting_sources', 'id,job_posting_id,source_name,is_active,apply_url,missing_snapshot_count'),
  readAll('company_job_sources', 'id,platform,status,last_attempt_at,last_success_at,last_error'),
])

const today = chinaCalendarDate()
const staleBefore = Date.now() - staleHours * 60 * 60 * 1000
const openJobs = jobs.filter(job => job.status === 'open')
const activeSources = sources.filter(source => source.is_active)
const activeJobIds = new Set(activeSources.map(source => source.job_posting_id))
const duplicatedUrls = new Map()
for (const source of activeSources) {
  const url = String(source.apply_url || '').trim()
  if (!url) continue
  duplicatedUrls.set(url, (duplicatedUrls.get(url) || 0) + 1)
}

const platformHealth = {}
for (const source of directory) {
  const key = `${source.platform}/${source.status}`
  platformHealth[key] ||= { sources: 0, neverSucceeded: 0, withError: 0, stale: 0 }
  const health = platformHealth[key]
  health.sources++
  if (!source.last_success_at) health.neverSucceeded++
  if (source.last_error) health.withError++
  if (source.status === 'active' && source.last_success_at && new Date(source.last_success_at).getTime() < staleBefore) health.stale++
}

const report = {
  generatedAt: new Date().toISOString(),
  chinaDate: today,
  jobs: {
    total: jobs.length,
    byStatus: tally(jobs, 'status'),
    openBySourceType: tally(openJobs, 'source_type'),
    openByQuality: tally(openJobs, 'content_quality'),
  },
  integrity: {
    expiredOpen: openJobs.filter(job => job.deadline_date && job.deadline_date < today).length,
    missingApplyUrl: openJobs.filter(job => !String(job.apply_url || '').trim()).length,
    missingSourceUrl: openJobs.filter(job => !String(job.jd_url || '').trim()).length,
    malformedApplyUrl: openJobs.filter(job => invalidHttpUrl(job.apply_url)).length,
    malformedSourceUrl: openJobs.filter(job => invalidHttpUrl(job.jd_url)).length,
    legacyHotjobPostType: openJobs.filter(job => /hotjob\.cn\/.*[?&]postType=(?:1|2|12)(?:&|$)/i.test(job.apply_url || '')).length,
    openWithoutActiveSource: openJobs.filter(job => !activeJobIds.has(job.id)).length,
    duplicateActiveApplyUrls: [...duplicatedUrls.values()].filter(count => count > 1).length,
    activeSourcesMissingOnce: activeSources.filter(source => Number(source.missing_snapshot_count || 0) > 0).length,
  },
  sourceDirectory: platformHealth,
}

const criticalKeys = [
  'expiredOpen',
  'missingApplyUrl',
  'missingSourceUrl',
  'malformedApplyUrl',
  'malformedSourceUrl',
  'legacyHotjobPostType',
  'openWithoutActiveSource',
]
const criticalCount = criticalKeys.reduce((sum, key) => sum + report.integrity[key], 0)

if (opts.json) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`岗位库审计 · ${report.generatedAt}`)
  console.log(`北京时间日期 ${today}`)
  console.log(`岗位总数 ${jobs.length}；开放 ${report.jobs.byStatus.open || 0}；关闭 ${report.jobs.byStatus.closed || 0}`)
  console.log(`开放来源：${Object.entries(report.jobs.openBySourceType).map(([key, value]) => `${key} ${value}`).join('，')}`)
  console.log(`开放质量：${Object.entries(report.jobs.openByQuality).map(([key, value]) => `${key} ${value}`).join('，')}`)
  console.log('\n完整性')
  for (const [key, value] of Object.entries(report.integrity)) console.log(`  ${key}: ${value}`)
  console.log('\n来源目录')
  for (const [key, value] of Object.entries(report.sourceDirectory).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${key}: ${value.sources} 个；未成功 ${value.neverSucceeded}；有错误 ${value.withError}；超过 ${staleHours} 小时未成功 ${value.stale}`)
  }
  console.log(criticalCount ? `\n发现 ${criticalCount} 个关键完整性问题` : '\n关键完整性检查通过')
}

if (opts.strict && criticalCount) process.exitCode = 1
