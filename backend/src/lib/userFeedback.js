import { z } from 'zod'

export const feedbackMessageSchema = z.object({
  feedbackId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
  source: z.enum(['help', 'interview']),
  message: z.string().trim().max(2000).default(''),
  rating: z.enum(['up', 'down']).optional(),
  interviewId: z.uuid().optional(),
  pagePath: z.string().max(160).regex(/^\/(?!\/)[^?#\s]*$/).optional(),
}).superRefine((value, ctx) => {
  if (!value.message && (value.source === 'help' || !value.rating)) {
    ctx.addIssue({ code: 'custom', path: ['message'], message: 'Feedback is required' })
  }
  if (value.source === 'interview' && !value.interviewId) {
    ctx.addIssue({ code: 'custom', path: ['interviewId'], message: 'Interview is required' })
  }
})

// Text belongs in the feedback table, never in analytics or application logs.
export function createFeedbackMessageHandler(dbForUser) {
  return async (req, res) => {
    const parsed = feedbackMessageSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Invalid feedback' })
    const { feedbackId, source, message, rating, interviewId, pagePath } = parsed.data

    try {
      const db = dbForUser(req.accessToken)
      if (interviewId) {
        const { data, error } = await db.from('interviews').select('id')
          .eq('id', interviewId).eq('user_id', req.user.id).maybeSingle()
        if (error) return res.status(503).json({ error: 'Feedback temporarily unavailable' })
        if (!data) return res.status(404).json({ error: 'Interview not found' })
      }

      const { error } = await db.from('user_feedback').insert({
        feedback_id: feedbackId,
        user_id: req.user.id,
        source,
        message,
        rating: rating || null,
        interview_id: interviewId || null,
        page_path: pagePath || null,
      })
      // A retry after a lost response must not create a second feedback entry.
      if (error && error.code !== '23505') {
        return res.status(503).json({ error: 'Feedback temporarily unavailable' })
      }
      return res.status(204).end()
    } catch {
      return res.status(503).json({ error: 'Feedback temporarily unavailable' })
    }
  }
}
