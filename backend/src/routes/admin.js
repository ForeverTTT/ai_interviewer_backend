import { Router } from 'express'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'

const router = Router()

const REVIEW_STATUSES = ['pending', 'approved', 'rejected']

function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Admins are listed in ADMIN_EMAILS. The email must be confirmed, so nobody can
 * register an admin's address with email/password sign-in and gain access.
 */
export function isAdminUser(user) {
  const email = user?.email?.toLowerCase()
  return Boolean(email && user.email_confirmed_at && adminEmails().includes(email))
}

function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) return res.status(403).json({ error: 'Forbidden' })
  next()
}

router.use(requireAuth)

/**
 * WHO AM I — lets the frontend decide whether to show admin navigation.
 */
router.get('/me', (req, res) => {
  res.json({ isAdmin: isAdminUser(req.user) })
})

/**
 * LIST LIBRARY SUBMISSIONS BY REVIEW STATUS (with per-status counts)
 */
router.get('/experiences', requireAdmin, async (req, res) => {
  const status = REVIEW_STATUSES.includes(req.query.status) ? req.query.status : 'pending'

  try {
    const [list, ...counts] = await Promise.all([
      supabase
        .from('interview_experiences')
        .select('*')
        .eq('visibility', 'public')
        .eq('review_status', status)
        // Oldest first for the queue, newest first for history.
        .order('created_at', { ascending: status === 'pending' }),
      ...REVIEW_STATUSES.map((s) => supabase
        .from('interview_experiences')
        .select('id', { count: 'exact', head: true })
        .eq('visibility', 'public')
        .eq('review_status', s)),
    ])

    for (const result of [list, ...counts]) {
      if (result.error) throw result.error
    }

    res.json({
      experiences: list.data || [],
      counts: Object.fromEntries(REVIEW_STATUSES.map((s, i) => [s, counts[i].count || 0])),
    })
  } catch (err) {
    console.error('[Admin] Experience list error:', err)
    res.status(500).json({ error: err.message || 'Failed to load experiences' })
  }
})

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  // Shown to the author with the rejection so they know what to fix.
  note: z.string().max(500).optional().nullable(),
})

/**
 * APPROVE / REJECT A LIBRARY SUBMISSION
 * The handle_experience_review trigger pays the +200 reward (once per post)
 * and notifies the author.
 */
router.post('/experiences/:id/review', requireAdmin, validate(reviewSchema), async (req, res) => {
  const { decision } = req.body
  const note = decision === 'rejected' ? (req.body.note || '').trim() || null : null

  try {
    const { data, error } = await supabase
      .from('interview_experiences')
      .update({ review_status: decision, review_note: note })
      .eq('id', req.params.id)
      .eq('visibility', 'public')
      .select('id, review_status, review_note, reward_granted, reviewed_at')
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Experience not found' })

    console.log(`[Admin] ${req.user.email} set experience ${data.id} to ${data.review_status}`)
    res.json(data)
  } catch (err) {
    console.error('[Admin] Review error:', err)
    res.status(500).json({ error: err.message || 'Failed to review experience' })
  }
})

/**
 * DELETE A LIBRARY SUBMISSION (any review status)
 * Authors cannot delete published posts themselves, so this is how they go away
 * for good. The author is notified; like a take-down, the reward is not clawed back.
 */
router.delete('/experiences/:id', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('interview_experiences')
      .delete()
      .eq('id', req.params.id)
      .eq('visibility', 'public')
      .select('id, user_id, company, position, review_status')
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Experience not found' })

    // Imported posts (scripts/importExperiences.js) have no author to notify.
    if (data.user_id) {
      const { error: notifyError } = await supabase.from('user_notifications').insert({
        user_id: data.user_id,
        type: 'experience_deleted',
        payload: {
          experience_id: data.id,
          company: data.company,
          position: data.position,
          previous_status: data.review_status,
        },
      })
      // The post is already gone; a failed notification should not report the delete as failed.
      if (notifyError) console.error('[Admin] Delete notification error:', notifyError)
    }

    console.log(`[Admin] ${req.user.email} deleted experience ${data.id} (${data.review_status})`)
    res.json({ success: true, previousStatus: data.review_status })
  } catch (err) {
    console.error('[Admin] Delete error:', err)
    res.status(500).json({ error: err.message || 'Failed to delete experience' })
  }
})

export default router
