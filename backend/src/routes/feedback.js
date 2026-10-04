import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { FEEDBACK_FEATURES, FEEDBACK_REASONS, trackServerEvent } from '../lib/analytics.js'

/**
 * POST /api/feedback — explicit 👍/👎 on an AI-generated result.
 * Users submit it deliberately, so it does not depend on cookie consent.
 * Only predefined reason codes are accepted; there is no free text.
 */
const router = Router()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const feedbackSchema = z.object({
  feedbackId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  feature: z.enum(FEEDBACK_FEATURES),
  rating: z.enum(['up', 'down']),
  reasons: z.array(z.string()).max(5).optional(),
  interviewId: z.string().regex(UUID).optional().nullable(),
}).refine(
  ({ rating, reasons = [] }) => reasons.every((reason) => FEEDBACK_REASONS[rating].includes(reason)),
  { message: 'Unknown reason for this rating', path: ['reasons'] },
)

router.post('/', requireAuth, (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid feedback' })

  const { feedbackId, feature, rating, reasons = [], interviewId } = parsed.data
  trackServerEvent(req, 'feedback_submitted', {
    interviewId: interviewId || undefined,
    props: {
      feedbackId,
      feature,
      rating,
      reasons: reasons.length ? [...new Set(reasons)].join(',') : undefined,
    },
  })
  return res.status(204).end()
})

export default router
