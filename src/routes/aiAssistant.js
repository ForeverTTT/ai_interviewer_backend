import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { loadPrompt, renderPrompt } from '../agents/utils.js'
import { invokeGemini } from '../lib/geminiText.js'

import { checkTokens, deductTokens } from '../middleware/tokens.js'

const router = Router()

/**
 * POST /api/ai-assistant/generate-motivation-letter
 * Body: { position, jobDescription, resumeText, targetLength, language }
 */
router.post('/generate-motivation-letter', requireAuth, (req, res, next) => {
  req.tokenCost = 100
  next()
}, checkTokens, async (req, res) => {
  const {
    position = '',
    jobDescription = '',
    resumeText = '',
    targetLength = 200,
    language = 'English'
  } = req.body

  if (!position || !jobDescription) {
    return res.status(400).json({ error: 'Position and Job Description are required' })
  }

  try {
    const template = await loadPrompt('motivation_letter')
    const prompt = renderPrompt(template, {
      POSITION: position,
      JOB_DESCRIPTION: jobDescription,
      RESUME_TEXT: resumeText || '(Not provided)',
      TARGET_LENGTH: String(targetLength),
      LANGUAGE: language
    })

    const text = await invokeGemini(prompt, `Please write my motivation letter for the ${position} position.`, {
      temperature: 0.8,
      maxOutputTokens: 4096
    })

    // Deduct tokens
    await deductTokens(req.user.id, 100)

    res.json({ text: text.trim() })
  } catch (err) {
    console.error('[MotivationLetter] Error:', err)
    res.status(500).json({ error: 'Failed to generate motivation letter' })
  }
})

export default router
