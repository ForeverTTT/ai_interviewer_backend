import { readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR   = join(__dirname, '..', '..', 'data')

// ── File loaders ────────────────────────────────────────────────

/** Load a markdown prompt template from data/prompts/<name>.md */
export async function loadPrompt(name) {
  const path = join(DATA_DIR, 'prompts', `${name}.md`)
  return readFile(path, 'utf-8')
}

/** Load a JSON knowledge base from data/knowledge_base/<name>.json */
export async function loadKnowledge(name) {
  const path = join(DATA_DIR, 'knowledge_base', `${name}.json`)
  const raw  = await readFile(path, 'utf-8')
  return JSON.parse(raw)
}

// ── Interview calculations ──────────────────────────────────────

/**
 * How many questions to ask based on duration.
 * Rule: ~1 question per 2.5 minutes, capped at 3-10.
 */
export function getMaxQuestions(durationMinutes) {
  const d = Number(durationMinutes) || 10
  if (d <= 5)  return 3
  if (d <= 10) return 5
  if (d <= 15) return 7
  return 9
}

/**
 * Build ordered interview slots after self-intro: explore (resume/intro depth),
 * technical (role-related), and behavioral — interleaving explore/technical for variety.
 * @param {number} maxQ  from getMaxQuestions()
 * @returns {('explore'|'technical'|'behavioral')[]}
 */
export function buildInterviewPlan(maxQ) {
  const n = Math.max(1, Math.min(12, Number(maxQ) || 5))
  if (n === 1) return ['explore']
  if (n === 2) return ['explore', 'behavioral']

  const b = Math.max(1, Math.min(n - 2, Math.ceil(n * 0.28)))
  const rest = n - b
  let t = Math.max(1, Math.floor(rest * 0.5))
  let e = rest - t
  if (e < 1) {
    e = 1
    t = Math.max(1, rest - 1)
  }

  const inter = []
  let ei = 0
  let ti = 0
  let turn = 0
  while (ei < e || ti < t) {
    if (turn % 2 === 0 && ei < e) {
      inter.push('explore')
      ei += 1
    } else if (ti < t) {
      inter.push('technical')
      ti += 1
    } else if (ei < e) {
      inter.push('explore')
      ei += 1
    } else {
      break
    }
    turn += 1
  }
  return [...inter, ...Array(b).fill('behavioral')]
}

// ── Domain matching ─────────────────────────────────────────────

/**
 * Find the best-matching technical domain for a job position.
 * Uses keyword matching against domain keyword lists.
 */
export function findRelevantDomain(position, domainsKnowledge) {
  if (!position || !domainsKnowledge?.domains) return null

  const lower = position.toLowerCase()
  let best = null
  let bestScore = 0

  for (const domain of domainsKnowledge.domains) {
    let score = 0
    for (const kw of domain.keywords) {
      if (lower.includes(kw.toLowerCase())) score += 2
      // Partial word match bonus
      const words = kw.toLowerCase().split(' ')
      for (const w of words) {
        if (w.length > 3 && lower.includes(w)) score += 1
      }
    }
    if (score > bestScore) { bestScore = score; best = domain }
  }

  // Fallback: return software_fullstack if no match
  return best || domainsKnowledge.domains.find(d => d.id === 'software_fullstack') || domainsKnowledge.domains[0]
}

// ── Competency selection ────────────────────────────────────────

/**
 * Find a behavioral competency that hasn't been covered yet.
 * Avoids competencies whose names appear in the analysis notes.
 */
export function findUnusedCompetency(competenciesKnowledge, usedNotesText = '') {
  if (!competenciesKnowledge?.competencies) return null

  const used = usedNotesText.toLowerCase()

  // Prefer competencies not mentioned in past notes
  const unused = competenciesKnowledge.competencies.filter(c =>
    !used.includes(c.id) && !used.includes(c.name.toLowerCase())
  )

  const pool = unused.length > 0 ? unused : competenciesKnowledge.competencies

  // Pick a random one from the pool to keep variety
  return pool[Math.floor(Math.random() * pool.length)]
}

// ── Prompt rendering ────────────────────────────────────────────

/**
 * Replace all {{KEY}} placeholders in a template string.
 * @param {string} template
 * @param {Record<string, string>} vars
 */
export function renderPrompt(template, vars) {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replaceAll(`{{${k}}}`, v ?? ''),
    template
  )
}

// ── Conversation formatting ─────────────────────────────────────

/**
 * Format the messages array into a readable conversation block for LLM prompts.
 * @param {Array<{role: string, content: string}>} messages
 * @param {number} maxTurns  How many recent turns to include
 */
export function formatConversationHistory(messages, maxTurns = 6) {
  if (!messages?.length) return '(No conversation yet)'

  return messages
    .slice(-maxTurns * 2)
    .map(m => {
      const speaker = m.role === 'user'
        ? '👤 Candidate'
        : '🤖 Interviewer'
      return `${speaker}:\n${m.content}`
    })
    .join('\n\n---\n\n')
}

// ── Interviewer personas ────────────────────────────────────────

/** Return a consistent interviewer name for the session */
const INTERVIEWER_NAMES = [
  'Dr. Schmidt',
  'Ms. Müller',
  'Mr. Wagner',
  'Ms. Fischer',
  'Dr. Weber',
]

export function getInterviewerName(sessionId = '') {
  const idx = sessionId.charCodeAt(0) % INTERVIEWER_NAMES.length
  return INTERVIEWER_NAMES[idx]
}

// ── Session store (in-memory) ───────────────────────────────────

/**
 * Per-user interview session state.
 * Keyed by userId (one active session per user at a time).
 */
const _sessions = new Map()

export const sessionStore = {
  get(userId) {
    return _sessions.get(userId) || null
  },

  init(userId, config) {
    const maxQ = getMaxQuestions(config?.duration)
    const state = {
      userId,
      phase:           'opening',
      questionCount:   0,
      technicalCount:  0,
      behavioralCount: 0,
      exploreCount:    0,
      plan:            buildInterviewPlan(maxQ),
      planIndex:       0,
      analysisNotes:   [],
      config,
      interviewerName: getInterviewerName(userId),
      createdAt: Date.now(),
    }
    _sessions.set(userId, state)
    return state
  },

  update(userId, patch) {
    const existing = _sessions.get(userId)
    if (!existing) return null
    const updated = { ...existing, ...patch }
    _sessions.set(userId, updated)
    return updated
  },

  delete(userId) {
    _sessions.delete(userId)
  },
}
