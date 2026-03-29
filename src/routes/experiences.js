import { Router } from 'express'
import { supabase, supabaseForUser } from '../lib/supabase.js'

const router = Router()

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
router.post('/', async (req, res) => {
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
    res.status(201).json(data)
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

    // Only allow deletion if user_id matches
    const { error } = await supabase
      .from('interview_experiences')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', user.id)

    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    console.error('[Experiences] Delete error:', err)
    res.status(500).json({ error: err.message || 'Failed to delete experience' })
  }
})

export default router
