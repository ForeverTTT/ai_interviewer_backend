import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { JOB_FUNCTIONS, INDUSTRIES, taxonomyOrder } from '../lib/jobTaxonomy.js'
import { STALE_AFTER_DAYS } from '../lib/feishuImport.js'

const router = Router()

// 求职信息是付费汇总表导入的数据，只给登录用户看
router.use(requireAuth)

/** 多选参数：逗号分隔，去重去空，最多 20 项，每项最长 40 字 */
const listParam = z.string().max(1000).optional()
  .transform(v => [...new Set((v || '').split(',').map(s => s.trim()).filter(Boolean))])
  .refine(list => list.length <= 20 && list.every(s => s.length <= 40))

export const jobQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  category: z.string().max(40).optional(),
  companyType: listParam,
  fn: listParam,
  industry: listParam,
  year: listParam,
  city: listParam,
  open: z.enum(['true', 'false']).default('true'),
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

function isoDaysAgo(days, now = Date.now()) {
  return new Date(now - days * 86400000).toISOString().slice(0, 10)
}

/**
 * 「只看未截止」：有截止日期的看截止日期；没有的看更新时间是否在半年内，
 * 不然表里 2024 届「招满为止」的老岗位会一直显示成未截止。
 */
export function openFilter(now = Date.now()) {
  const today = isoDaysAgo(0, now)
  const freshSince = isoDaysAgo(STALE_AFTER_DAYS, now)
  return `deadline_date.gte.${today},and(deadline_date.is.null,or(source_updated_at.is.null,source_updated_at.gte.${freshSince}))`
}

router.get('/', async (req, res) => {
  const parsed = jobQuerySchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid query' })
  const { q, category, companyType, fn, industry, year, city, open, page, pageSize } = parsed.data

  try {
    let query = supabase
      .from('job_postings')
      .select('*', { count: 'exact' })

    if (category) query = query.eq('category', category)
    // 同一项里多选 = 任一满足（数组列用 overlaps），不同项之间 = 同时满足
    if (companyType.length) query = query.in('company_type', companyType)
    if (fn.length) query = query.filter('job_functions', 'ov', pgArrayLiteral(fn))
    if (industry.length) query = query.filter('industry_keys', 'ov', pgArrayLiteral(industry))
    if (year.length) query = query.filter('graduation_years', 'ov', pgArrayLiteral(year))
    if (city.length) query = query.filter('locations', 'ov', pgArrayLiteral(city))
    if (open === 'true') query = query.or(openFilter())
    const term = sanitizeSearch(q)
    if (term) query = query.or(`company.ilike.%${term}%,positions.ilike.%${term}%`)

    const from = (page - 1) * pageSize
    const { data, error, count } = await query
      .order('source_updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (error) throw error
    res.json({ total: count || 0, page, pageSize, jobs: data || [] })
  } catch (err) {
    console.error('[Jobs] List error:', err)
    res.status(500).json({ error: 'Failed to load jobs' })
  }
})

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
        .select('category,company_type,job_functions,industry_keys,graduation_years,locations,source,source_updated_at')
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
      years: countBy(rows, r => r.graduation_years || []).sort((a, b) => a.value.localeCompare(b.value)),
      cities: countBy(rows, r => r.locations || []).slice(0, 24),
      sources: countBy(rows, r => [r.source]).map(s => s.value),
      lastUpdated: rows.reduce((max, r) => (r.source_updated_at && (!max || r.source_updated_at > max) ? r.source_updated_at : max), null),
    }
    facetCache = { at: Date.now(), value }
    res.json(value)
  } catch (err) {
    console.error('[Jobs] Facets error:', err)
    res.status(500).json({ error: 'Failed to load filters' })
  }
})

export default router
