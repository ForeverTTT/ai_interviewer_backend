import { Router } from 'express'
import { z } from 'zod'
import { supabase, supabaseForUser } from '../lib/supabase.js'
import { validate } from '../middleware/validate.js'
import { deductTokens } from '../middleware/tokens.js'
import { trackServerEvent } from '../lib/analytics.js'
import { normalizeCompany, tagExperience } from '../lib/jobTaxonomy.js'

const router = Router()

const experienceSchema = z.object({
  type: z.enum(['internship', 'campus', 'experienced']),
  company: z.string().min(1).max(100),
  location: z.string().max(100).optional().nullable(),
  position: z.string().min(1).max(100),
  department: z.string().max(100).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}$/, "Format must be YYYY-MM"),
  language: z.string().max(50).optional().nullable(),
  rounds: z.array(z.object({
    round: z.number().optional(),
    format: z.string().max(200).optional().nullable(),
    duration_min: z.number().optional().nullable(),
    questions: z.array(z.string().max(2000)).optional(),
    // Optional answer per question, same index as `questions`.
    answers: z.array(z.string().max(5000)).optional(),
  })).optional(),
  result: z.string().max(50).optional().nullable(),
  salary: z.string().max(100).optional().nullable(),
  reflection: z.string().max(5000).optional().nullable(),
  // private: only the author sees it. public: submitted to the library for review.
  visibility: z.enum(['private', 'public']).optional(),
})

const EXPERIENCE_REWARD = 200

let companyIndustryCache = { at: 0, value: new Map() }
const COMPANY_INDUSTRY_TTL_MS = 10 * 60 * 1000

/**
 * Company name -> industry keys, taken from job_postings, so an experience at a
 * company that is on the job board gets the same industry. Cached for 10 minutes.
 * Failures (e.g. the job_postings migration has not run yet) fall back to
 * keyword rules on the company name instead of breaking the library.
 */
async function loadCompanyIndustries() {
  if (Date.now() - companyIndustryCache.at < COMPANY_INDUSTRY_TTL_MS) return companyIndustryCache.value
  const map = new Map()
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('job_postings')
        .select('company,industry_keys')
        // 分页必须有固定顺序，否则各页之间会重复 / 漏行
        .order('id')
        .range(from, from + 999)
      if (error) throw error
      for (const row of data) {
        const key = normalizeCompany(row.company)
        const merged = new Set([...(map.get(key) || []), ...(row.industry_keys || [])])
        if (merged.size > 1) merged.delete('other')
        map.set(key, [...merged])
      }
      if (data.length < 1000) break
    }
  } catch (err) {
    console.error('[Experiences] Company industry lookup failed:', err.message)
  }
  companyIndustryCache = { at: Date.now(), value: map }
  return map
}

/** Adds job_functions / industry_keys (computed, not stored) for the library filters. */
async function withTags(rows) {
  const companies = await loadCompanyIndustries()
  return (rows || []).map(row => tagExperience(row, companies))
}

/**
 * GET LIBRARY EXPERIENCES (public + approved only)
 */
router.get('/', async (_req, res) => {
  try {
    const { data, error, count } = await supabase
      .from('interview_experiences')
      .select('*', { count: 'exact' })
      .eq('visibility', 'public')
      .eq('review_status', 'approved')
      .order('created_at', { ascending: false })

    if (error) throw error

    res.json({
      total: count || 0,
      experiences: await withTags(data),
    })
  } catch (err) {
    console.error('[Experiences] Database load error:', err)
    res.status(500).json({ error: err.message || 'Failed to load experiences' })
  }
})

/**
 * GET MY EXPERIENCES (all of the author's posts, including private / pending / rejected)
 */
router.get('/mine', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const token = authHeader.split(' ')[1]
    const userClient = supabaseForUser(token)
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { data, error } = await supabase
      .from('interview_experiences')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (error) throw error
    res.json({ experiences: await withTags(data) })
  } catch (err) {
    console.error('[Experiences] Mine error:', err)
    res.status(500).json({ error: err.message || 'Failed to load your experiences' })
  }
})

/**
 * POST NEW EXPERIENCE
 */
router.post('/', validate(experienceSchema), async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const token = authHeader.split(' ')[1]
    const userClient = supabaseForUser(token)
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { type, company, location, position, department, date, language, rounds, result, salary, reflection } = req.body
    const visibility = req.body.visibility === 'public' ? 'public' : 'private'

    const { data, error } = await supabase
      .from('interview_experiences')
      .insert([{
        type,
        company,
        location,
        position,
        department,
        date,
        language,
        rounds: rounds || [],
        result,
        salary,
        reflection,
        visibility,
        review_status: visibility === 'public' ? 'pending' : 'none',
        user_id: user.id,
        publisher: user.user_metadata?.full_name || user.email.split('@')[0]
      }])
      .select()
      .single()

    if (error) throw error

    // The +200 reward is granted only after review approval (DB trigger
    // handle_experience_review), not at submission time.
    trackServerEvent(req, 'experience_shared', { userId: user.id, props: { type, visibility } })

    res.status(201).json(data)
  } catch (err) {
    console.error('[Experiences] Post error:', err)
    res.status(500).json({ error: err.message || 'Failed to save experience' })
  }
})

/**
 * EDIT EXPERIENCE
 * Only private and rejected posts can be edited, so approved / pending content
 * never changes behind the reviewer's back. Saving with visibility 'public'
 * (re)submits the post for review.
 */
router.put('/:id', validate(experienceSchema), async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const token = authHeader.split(' ')[1]
    const userClient = supabaseForUser(token)
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { type, company, location, position, department, date, language, rounds, result, salary, reflection } = req.body
    const visibility = req.body.visibility === 'public' ? 'public' : 'private'

    const { data, error } = await supabase
      .from('interview_experiences')
      .update({
        type,
        company,
        location,
        position,
        department,
        date,
        language,
        rounds: rounds || [],
        result,
        salary,
        reflection,
        visibility,
        review_status: visibility === 'public' ? 'pending' : 'none',
      })
      .eq('id', req.params.id)
      .eq('user_id', user.id)
      .in('review_status', ['none', 'rejected'])
      .select()
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(409).json({ error: 'NOT_EDITABLE', message: 'Only private or rejected experiences can be edited.' })

    if (visibility === 'public') {
      trackServerEvent(req, 'experience_shared', { userId: user.id, props: { type, visibility } })
    }
    res.json(data)
  } catch (err) {
    console.error('[Experiences] Edit error:', err)
    res.status(500).json({ error: err.message || 'Failed to update experience' })
  }
})

/**
 * SUBMIT A PRIVATE EXPERIENCE TO THE LIBRARY (goes to review)
 */
router.post('/:id/submit', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const token = authHeader.split(' ')[1]
    const userClient = supabaseForUser(token)
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { data, error } = await supabase
      .from('interview_experiences')
      .update({ visibility: 'public', review_status: 'pending' })
      .eq('id', req.params.id)
      .eq('user_id', user.id)
      .eq('visibility', 'private')
      .select()
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Private experience not found' })

    trackServerEvent(req, 'experience_shared', { userId: user.id, props: { type: data.type, visibility: 'public' } })
    res.json(data)
  } catch (err) {
    console.error('[Experiences] Submit error:', err)
    res.status(500).json({ error: err.message || 'Failed to submit experience' })
  }
})

/**
 * DELETE EXPERIENCE
 * Authors can delete posts that are not published (private, pending, rejected).
 * Published (approved) posts can only be removed by an admin.
 */
router.delete('/:id', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const token = authHeader.split(' ')[1]
    const userClient = supabaseForUser(token)
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { data: deleted, error } = await supabase
      .from('interview_experiences')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', user.id)
      .neq('review_status', 'approved')
      .select('reward_granted')
      .maybeSingle()

    if (error) throw error
    if (!deleted) {
      const { data: existing, error: lookupError } = await supabase
        .from('interview_experiences')
        .select('review_status')
        .eq('id', req.params.id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (existing?.review_status === 'approved') {
        return res.status(409).json({ error: 'NOT_DELETABLE', message: 'Published experiences can only be removed by an admin.' })
      }
      return res.status(404).json({ error: 'Experience not found' })
    }

    // Only claw back the reward if this post actually earned it.
    const tokensDeducted = deleted.reward_granted ? EXPERIENCE_REWARD : 0
    await deductTokens(user.id, tokensDeducted, { req, feature: 'experience_delete' })
    trackServerEvent(req, 'experience_deleted', { userId: user.id })

    res.json({ success: true, tokensDeducted })
  } catch (err) {
    console.error('[Experiences] Delete error:', err)
    res.status(500).json({ error: err.message || 'Failed to delete experience' })
  }
})

export default router
