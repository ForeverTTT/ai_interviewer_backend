import { chinaCalendarDate, chinaCalendarDateDaysAgo } from './chinaDate.js'
import { STALE_AFTER_DAYS } from './feishuImport.js'
import { JOB_FUNCTIONS, INDUSTRIES, taxonomyOrder } from './jobTaxonomy.js'

const ANY_YEAR = '不限届'
const DEFAULT_PAGE_SIZE = 1000

/** 当前仍可投递的岗位范围，与岗位列表使用完全相同的北京时间规则。 */
export function openFilter(now = Date.now()) {
  const today = chinaCalendarDate(now)
  const freshSince = chinaCalendarDateDaysAgo(STALE_AFTER_DAYS, now)
  return `deadline_date.gte.${today},and(deadline_date.is.null,or(source_updated_at.is.null,source_updated_at.gte.${freshSince}))`
}

export function graduationYearGroups(rows, now = new Date()) {
  const thisYear = now.getUTCFullYear()
  const active = [thisYear, thisYear + 1, thisYear + 2].map(year => `${year}届`)
  const groups = new Map([
    ...active.map(value => [value, { value, members: new Set([value]), count: 0 }]),
    ['earlier', { value: 'earlier', year: thisYear - 1, members: new Set(), count: 0 }],
    ['later', { value: 'later', year: thisYear + 3, members: new Set(), count: 0 }],
  ])
  const groupOf = (label) => {
    if (groups.has(label)) return label
    const match = label.match(/^(\d{4})届$/)
    if (match) return Number(match[1]) < thisYear ? 'earlier' : 'later'
    return 'earlier'
  }

  for (const row of rows) {
    const hit = new Set()
    for (const label of row.graduation_years || []) {
      if (label === ANY_YEAR) {
        for (const key of groups.keys()) hit.add(key)
        continue
      }
      const key = groupOf(label)
      groups.get(key).members.add(label)
      hit.add(key)
    }
    for (const key of hit) groups.get(key).count++
  }

  return [...groups.values()]
    .filter(group => group.count > 0 && group.members.size > 0)
    .map(group => ({ ...group, members: [...group.members].sort() }))
}

function countBy(rows, pickValues) {
  const counts = new Map()
  for (const row of rows) {
    for (const value of pickValues(row)) {
      if (value) counts.set(value, (counts.get(value) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }))
}

/** 只在后台刷新任务或快照缺失时扫描完整岗位库。 */
export async function buildJobFacets(db, { now = Date.now(), pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('job_postings')
      .select('category,company_type,job_functions,industry_keys,graduation_years,locations,sort_date')
      .eq('status', 'open')
      .or(openFilter(now))
      .order('id')
      .range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < pageSize) break
  }

  return {
    total: rows.length,
    categories: countBy(rows, row => [row.category]),
    companyTypes: countBy(rows, row => [row.company_type]),
    functions: countBy(rows, row => row.job_functions || []).sort(taxonomyOrder(JOB_FUNCTIONS)),
    industries: countBy(rows, row => row.industry_keys || []).sort(taxonomyOrder(INDUSTRIES)),
    years: graduationYearGroups(rows, new Date(now)),
    cities: countBy(rows, row => row.locations || []).slice(0, 24),
    lastUpdated: rows.reduce((max, row) => (row.sort_date && (!max || row.sort_date > max) ? row.sort_date : max), null),
  }
}

export async function readJobFacetsSnapshot(db) {
  const { data, error } = await db
    .from('job_facets_snapshot')
    .select('payload,job_count,generated_at,schema_version')
    .eq('snapshot_key', 'current')
    .maybeSingle()
  if (error) throw error
  if (!data?.payload || typeof data.payload !== 'object') return null
  return { ...data.payload, generatedAt: data.generated_at }
}

export async function writeJobFacetsSnapshot(db, value, generatedAt = new Date().toISOString()) {
  const payload = { ...value }
  delete payload.generatedAt
  const { error } = await db.from('job_facets_snapshot').upsert({
    snapshot_key: 'current',
    payload,
    job_count: Number(payload.total || 0),
    generated_at: generatedAt,
    schema_version: 1,
  }, { onConflict: 'snapshot_key' })
  if (error) throw error
  return { ...payload, generatedAt }
}
