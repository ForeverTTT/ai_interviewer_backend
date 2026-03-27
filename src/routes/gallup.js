import express from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'

const router = express.Router()

// GET /api/gallup/results - Fetch existing results or progress
router.get('/results', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gallup_responses')
      .select('*')
      .eq('user_id', req.user.id)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows found"
      throw error
    }

    res.json(data || { answers: {}, results: [], status: 'not_started' })
  } catch (error) {
    console.error('[Gallup Get Error]', error)
    res.status(500).json({ error: 'Failed to fetch gallup results' })
  }
})

// POST /api/gallup/save - Save progress or final results
router.post('/save', requireAuth, async (req, res) => {
  const { answers, results, status } = req.body
  
  try {
    const { data, error } = await supabase
      .from('gallup_responses')
      .upsert({
        user_id: req.user.id,
        answers,
        results,
        status,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select()
      .single()

    if (error) throw error

    res.json(data)
  } catch (error) {
    console.error('[Gallup Save Error]', error)
    res.status(500).json({ error: 'Failed to save gallup results' })
  }
})

export default router
