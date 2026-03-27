import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { loadPrompt, renderPrompt } from '../agents/utils.js'

const router = Router()

/**
 * POST /api/ai-assistant/generate-motivation-letter
 * Body: { position, jobDescription, resumeText, targetLength, language }
 */
router.post('/generate-motivation-letter', requireAuth, async (req, res) => {
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

    const llm = new ChatGoogleGenerativeAI({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0.8,
      maxOutputTokens: 4096
    })

    const response = await llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage(`Please write my motivation letter for the ${position} position.`)
    ])

    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
    
    res.json({ text: text.trim() })
  } catch (err) {
    console.error('[MotivationLetter] Error:', err)
    res.status(500).json({ error: 'Failed to generate motivation letter' })
  }
})

export default router
