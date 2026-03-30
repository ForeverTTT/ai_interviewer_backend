import { Router } from 'express'
import { z } from 'zod'
import { supabase, supabaseForUser } from '../lib/supabase.js'
import { validate } from '../middleware/validate.js'
import { addTokens, deductTokens } from '../middleware/tokens.js'

const router = Router()

const experienceSchema = z.object({
  type: z.string().min(1).max(50),
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
  })).optional(),
  result: z.string().max(50).optional().nullable(),
  salary: z.string().max(100).optional().nullable(),
  reflection: z.string().max(5000).optional().nullable(),
})

/**
 * GET ALL EXPERIENCES
 */
router.get('/', async (_req, res) => {
  try {
    const { data, error, count } = await supabase
      .from('interview_experiences')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (error) throw error

    res.json({
      total: count || 0,
      experiences: data || [],
    })
  } catch (err) {
    console.error('[Experiences] Database load error:', err)
    res.status(500).json({ error: err.message || 'Failed to load experiences' })
  }
})

/**
 * GET MY EXPERIENCES
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
    res.json({ experiences: data || [] })
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
        user_id: user.id,
        publisher: user.user_metadata?.full_name || user.email.split('@')[0]
      }])
      .select()
      .single()

    if (error) throw error
    
    // Reward for community contribution
    await addTokens(user.id, 200)
    
    res.status(201).json({ ...data, tokensAwarded: 200 })
  } catch (err) {
    console.error('[Experiences] Post error:', err)
    res.status(500).json({ error: err.message || 'Failed to save experience' })
  }
})

/**
 * DELETE EXPERIENCE
 */
router.delete('/:id', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const token = authHeader.split(' ')[1]
    const userClient = supabaseForUser(token)
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { error } = await supabase
      .from('interview_experiences')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', user.id)

    if (error) throw error

    await deductTokens(user.id, 200)

    res.json({ success: true, tokensDeducted: 200 })
  } catch (err) {
    console.error('[Experiences] Delete error:', err)
    res.status(500).json({ error: err.message || 'Failed to delete experience' })
  }
})

export default router
