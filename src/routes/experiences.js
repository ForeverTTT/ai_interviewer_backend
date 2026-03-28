import { Router } from 'express'
import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, '..', '..', 'data', 'knowledge_base', 'interview_experiences.json')

const router = Router()

let _cache = null
let _cacheTime = 0
const CACHE_TTL = 5 * 60 * 1000

async function loadExperiences() {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache
  const raw = await readFile(DATA_PATH, 'utf-8')
  _cache = JSON.parse(raw)
  _cacheTime = Date.now()
  return _cache
}

router.get('/', async (_req, res) => {
  try {
    const data = await loadExperiences()
    res.json({
      total: data.experiences.length,
      experiences: data.experiences,
    })
  } catch (err) {
    console.error('[Experiences] Load error:', err)
    res.status(500).json({ error: 'Failed to load experiences' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const data = await loadExperiences()
    const entry = data.experiences.find(e => e.id === req.params.id)
    if (!entry) return res.status(404).json({ error: 'Experience not found' })
    res.json(entry)
  } catch (err) {
    console.error('[Experiences] Load error:', err)
    res.status(500).json({ error: 'Failed to load experience' })
  }
})

export default router
