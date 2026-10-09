import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { JOB_FUNCTIONS, INDUSTRIES, taxonomyOrder } from '../lib/jobTaxonomy.js'

const router = Router()

// 求职信息是付费汇总表导入的数据，只给登录用户看
router.use(requireAuth)

export const jobQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  category: z.string().max(40).optional(),
  companyType: z.string().max(40).optional(),
  fn: z.string().max(20).optional(),
  industry: z.string().max(20).optional(),
  year: z.string().max(20).optional(),
  city: z.string().max(40).optional(),
  open: z.enum(['true', 'false']).default('true'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
})

/** PostgREST 的 or() 语法里逗号、括号、通配符有特殊含义，搜索词里去掉 */
export function sanitizeSearch(q) {
  return (q || '').replace(/[,()*%\\:"]/g, ' ').trim()
}

function today() {
  return new Date().toISOString().slice(0, 10)
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
    if (companyType) query = query.eq('company_type', companyType)
    if (fn) query = query.contains('job_functions', [fn])
    if (industry) query = query.contains('industry_keys', [industry])
    if (year) query = query.contains('graduation_years', [year])
    if (city) query = query.contains('locations', [city])
    if (open === 'true') query = query.or(`deadline_date.is.null,deadline_date.gte.${today()}`)
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
