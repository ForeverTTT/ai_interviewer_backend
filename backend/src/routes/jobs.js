import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { JOB_FUNCTIONS, INDUSTRIES, taxonomyOrder } from '../lib/jobTaxonomy.js'
import { STALE_AFTER_DAYS } from '../lib/feishuImport.js'
import { chinaCalendarDate, chinaCalendarDateDaysAgo } from '../lib/chinaDate.js'

const router = Router()

// 求职信息是付费汇总表导入的数据，只给登录用户看
router.use(requireAuth)

/** 多选参数：逗号分隔，去重去空，最多 20 项，每项最长 40 字 */
const listParam = z.string().max(1000).optional()
  .transform(v => [...new Set((v || '').split(',').map(s => s.trim()).filter(Boolean))])
  .refine(list => list.length <= 40 && list.every(s => s.length <= 40))

export const jobQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  category: z.string().max(40).optional(),
  companyType: listParam,
  fn: listParam,
  industry: listParam,
  year: listParam,
  city: listParam,
  open: z.enum(['true', 'false']).default('true'),
  // updated：最近更新在前；deadline_asc / deadline_desc：按截止日期，没写日期的（招满为止 …）都排最后
  sort: z.enum(['updated', 'deadline_asc', 'deadline_desc']).default('updated'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
})

/** PostgREST 的 or() 语法里逗号、括号、通配符有特殊含义，搜索词里去掉 */
export function sanitizeSearch(q) {
  return (q || '').replace(/[,()*%\\:"]/g, ' ').trim()
}

/** text[] 列的 ov（overlaps）过滤值：每项加引号，城市名里有空格 / 逗号也不会拆错 */
export function pgArrayLiteral(values) {
  return `{${values.map(v => `"${v.replace(/["\\]/g, '\\$&')}"`).join(',')}}`
}

/**
 * 「只看未截止」：有截止日期的看截止日期；没有的看更新时间是否在半年内，
 * 不然表里 2024 届「招满为止」的老岗位会一直显示成未截止。
 */
export function openFilter(now = Date.now()) {
  const today = chinaCalendarDate(now)
  const freshSince = chinaCalendarDateDaysAgo(STALE_AFTER_DAYS, now)
  return `deadline_date.gte.${today},and(deadline_date.is.null,or(source_updated_at.is.null,source_updated_at.gte.${freshSince}))`
}

export function isJobExpired(job, now = Date.now()) {
  return Boolean(job?.deadline_date && job.deadline_date < chinaCalendarDate(now))
}

export function jobHandoff(job) {
  const description = String(job.job_description || '').trim() || [
    `岗位：${job.job_title || job.positions || ''}`,
    `公司：${job.company || ''}`,
    job.department && `部门：${job.department}`,
    job.locations?.length && `地点：${job.locations.join('、')}`,
    job.education && `学历要求：${job.education}`,
    job.major_requirement && `专业要求：${job.major_requirement}`,
    job.notes && `补充信息：${job.notes}`,
  ].filter(Boolean).join('\n')
  return {
    position: job.job_title || job.positions || '',
    jobDescription: description,
    employmentType: job.employment_type || 'full_time',
    ready: description.length >= 50,
  }
}

/** 公告/详情来源与投递入口严格分开解析，避免“岗位来源”误跳到申请表。 */
export function resolveJobSourceLinks(job, sources) {
  const sourceRank = { official: 3, ats: 2, feishu: 1, user: 0 }
  const ranked = [...sources].sort((a, b) => (sourceRank[b.source_type] || 0) - (sourceRank[a.source_type] || 0)
    || String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')))
  const applicationSource = ranked.find(source => source.apply_url) || null
  const referenceSource = ranked.find(source => source.source_url) || null
  const displaySource = referenceSource || applicationSource
  const displayName = value => String(value || '').replace(/\s+·\s+[0-9a-f]{8}$/i, '')
  const publicSources = ranked.map(source => ({ ...source, source_name: displayName(source.source_name) }))
  const publicPreferred = displaySource ? { ...displaySource, source_name: displayName(displaySource.source_name) } : null
  return {
    sources: publicSources,
    preferredSource: publicPreferred,
    job: displaySource || applicationSource ? {
      ...job,
      apply_url: applicationSource?.apply_url || job.apply_url || null,
      jd_url: referenceSource?.source_url || job.jd_url || null,
      source: displayName(displaySource?.source_name || job.source),
      source_type: displaySource?.source_type || job.source_type,
    } : job,
  }
}

router.get('/', async (req, res) => {
  const parsed = jobQuerySchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query' })
  const { q, category, companyType, fn, industry, year, city, open, sort, page, pageSize } = parsed.data

  try {
    let query = supabase
      .from('job_postings')
      .select('*', { count: 'exact' })

    query = query.eq('status', 'open')

    if (category) query = query.eq('category', category)
    // 同一项里多选 = 任一满足（数组列用 overlaps），不同项之间 = 同时满足
    if (companyType.length) query = query.in('company_type', companyType)
    if (fn.length) query = query.filter('job_functions', 'ov', pgArrayLiteral(fn))
    if (industry.length) query = query.filter('industry_keys', 'ov', pgArrayLiteral(industry))
    // 「不限届」的岗位对任何届次都开放，选了届次也要带上
    if (year.length) query = query.filter('graduation_years', 'ov', pgArrayLiteral([...year, ANY_YEAR]))
    if (city.length) query = query.filter('locations', 'ov', pgArrayLiteral(city))
    if (open === 'true') query = query.or(openFilter())
    const term = sanitizeSearch(q)
    if (term) query = query.or(`company.ilike.%${term}%,job_title.ilike.%${term}%,positions.ilike.%${term}%`)

    if (sort !== 'updated') {
      query = query.order('deadline_date', { ascending: sort === 'deadline_asc', nullsFirst: false })
    }
    const from = (page - 1) * pageSize
    const { data, error, count } = await query
      .order('sort_date', { ascending: false, nullsFirst: false })
      .order('source_updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      // 最后按 id 定死顺序，「加载更多」翻页时不会重复或漏掉同一时间的岗位
      .order('id')
      .range(from, from + pageSize - 1)

    if (error) throw error
    res.json({ total: count || 0, page, pageSize, jobs: data || [] })
  } catch (err) {
    console.error('[Jobs] List error:', err)
    res.status(500).json({ error: 'Failed to load jobs' })
  }
})

const ANY_YEAR = '不限届'

/**
 * 届次筛选项：只把正在招的三届（今年起往后三届）单独列出，更早的（含海外往届）合成「earlier」，
 * 更晚的合成「later」。每组带 members（实际的届次值），前端选中一组时把 members 传回来。
 * 「不限届」不单列，计入每一组。
 */
export function graduationYearGroups(rows, now = new Date()) {
  const thisYear = now.getUTCFullYear()
  const active = [thisYear, thisYear + 1, thisYear + 2].map(y => `${y}届`)
  const groups = new Map([
    ...active.map(v => [v, { value: v, members: new Set([v]), count: 0 }]),
    ['earlier', { value: 'earlier', year: thisYear - 1, members: new Set(), count: 0 }],
    ['later', { value: 'later', year: thisYear + 3, members: new Set(), count: 0 }],
  ])
  const groupOf = (label) => {
    if (groups.has(label)) return label
    const m = label.match(/^(\d{4})届$/)
    if (m) return Number(m[1]) < thisYear ? 'earlier' : 'later'
    return 'earlier' // 海外往届、往届生 …
  }

  for (const row of rows) {
    const years = row.graduation_years || []
    const hit = new Set()
    for (const label of years) {
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
    .filter(g => g.count > 0 && g.members.size > 0)
    .map(g => ({ ...g, members: [...g.members].sort() }))
}

let facetCache = { at: 0, value: null }
const FACET_TTL_MS = 10 * 60 * 1000

function countBy(rows, pickValues) {
  const counts = new Map()
  for (const row of rows) {
    for (const v of pickValues(row)) {
      if (v) counts.set(v, (counts.get(v) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }))
}

/** 筛选项（分类 / 企业类型 / 届次 / 热门城市）及数量，10 分钟缓存一次 */
router.get('/facets', async (_req, res) => {
  try {
    if (facetCache.value && Date.now() - facetCache.at < FACET_TTL_MS) return res.json(facetCache.value)

    const rows = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('job_postings')
        .select('category,company_type,job_functions,industry_keys,graduation_years,locations,sort_date')
        .eq('status', 'open')
        .or(openFilter())
        // 分页必须有固定顺序，否则各页之间会重复 / 漏行
        .order('id')
        .range(from, from + 999)
      if (error) throw error
      rows.push(...data)
      if (data.length < 1000) break
    }

    const value = {
      total: rows.length,
      categories: countBy(rows, r => [r.category]),
      companyTypes: countBy(rows, r => [r.company_type]),
      // 按分类规则的固定顺序，「其他」放最后
      functions: countBy(rows, r => r.job_functions || []).sort(taxonomyOrder(JOB_FUNCTIONS)),
      industries: countBy(rows, r => r.industry_keys || []).sort(taxonomyOrder(INDUSTRIES)),
      years: graduationYearGroups(rows),
      cities: countBy(rows, r => r.locations || []).slice(0, 24),
      lastUpdated: rows.reduce((max, r) => (r.sort_date && (!max || r.sort_date > max) ? r.sort_date : max), null),
    }
    facetCache = { at: Date.now(), value }
    res.json(value)
  } catch (err) {
    console.error('[Jobs] Facets error:', err)
    res.status(500).json({ error: 'Failed to load filters' })
  }
})

router.get('/:id', async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id)
  if (!id.success) return res.status(400).json({ error: 'Invalid job id' })
  try {
    const { data: job, error } = await supabase
      .from('job_postings')
      .select('*')
      .eq('id', id.data)
      .maybeSingle()
    if (error) throw error
    if (!job) return res.status(404).json({ error: 'Job not found' })

    let sources = []
    const sourceResult = await supabase
      .from('job_posting_sources')
      .select('source_type,source_name,source_external_id,source_url,apply_url,last_seen_at')
      .eq('job_posting_id', id.data)
      .eq('is_active', true)
      .order('last_seen_at', { ascending: false })
    // 兼容“代码先部署、迁移稍后执行”的短窗口，详情主体仍能打开。
    if (!sourceResult.error) sources = sourceResult.data || []

    const resolved = resolveJobSourceLinks(job, sources)
    sources = resolved.sources
    const preferredSource = resolved.preferredSource
    const isExpired = isJobExpired(job)
    const isOpen = job.status === 'open' && !isExpired
    const resolvedJob = {
      ...resolved.job,
      is_expired: isExpired,
      is_open: isOpen,
      // 旧链接或收藏仍可打开详情，但已截止/已下架岗位不能继续投递。
      apply_url: isOpen ? resolved.job.apply_url : null,
    }

    res.json({ job: resolvedJob, sources, preferredSource, handoff: jobHandoff(resolvedJob) })
  } catch (err) {
    console.error('[Jobs] Detail error:', err)
    res.status(500).json({ error: 'Failed to load job' })
  }
})

export default router
