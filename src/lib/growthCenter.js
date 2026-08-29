export const READINESS_DIMENSIONS = [
  {
    key: 'technical',
    keywords: ['technical', 'system design', 'architecture', 'trade-off', 'debug', 'algorithm', '技术', '系统设计', '架构', '取舍', '调试', 'technisch', 'architektur'],
  },
  {
    key: 'experience',
    keywords: ['project', 'experience', 'evidence', 'impact', 'result', 'metric', '项目', '经历', '证据', '结果', '量化', 'projekt', 'erfahrung', 'ergebnis'],
  },
  {
    key: 'structure',
    keywords: ['star', 'structure', 'clear', 'concise', 'logic', '结构', '逻辑', '清晰', '简洁', 'struktur', 'klar', 'präzise'],
  },
  {
    key: 'communication',
    keywords: ['communication', 'collaboration', 'conflict', 'stakeholder', 'listen', '沟通', '协作', '冲突', '利益相关', 'kommunikation', 'zusammenarbeit', 'konflikt'],
  },
  {
    key: 'strategy',
    keywords: ['motivation', 'role fit', 'job fit', 'strategy', 'why this', '岗位匹配', '动机', '策略', '职位匹配', 'motivation', 'rollenfit', 'strategie'],
  },
]

function clean(value, max = 2_000) {
  return String(value || '').trim().slice(0, max)
}

function clampScore(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  return Math.max(0, Math.min(100, Math.round(number)))
}

function questionIndexOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 ? number : null
}

function textIncludesAny(text, keywords) {
  const normalized = clean(text, 20_000).toLowerCase()
  return keywords.some(keyword => normalized.includes(keyword))
}

function reportEvidenceCandidates(report) {
  const candidates = []
  for (const [index, item] of (Array.isArray(report?.strengths) ? report.strengths : []).entries()) {
    const excerpt = clean(item)
    if (excerpt) candidates.push({ kind: 'strength', excerpt, questionIndex: null, order: index })
  }
  for (const [index, item] of (Array.isArray(report?.toImprove) ? report.toImprove : []).entries()) {
    const excerpt = [item?.title, item?.why, item?.how].map(value => clean(value)).filter(Boolean).join(' — ')
    if (excerpt) candidates.push({ kind: 'gap', excerpt, questionIndex: null, order: index })
  }
  for (const [index, item] of (Array.isArray(report?.qaReview) ? report.qaReview : []).entries()) {
    const excerpt = [item?.questionSummary, ...(Array.isArray(item?.gaps) ? item.gaps : []), item?.howToImprove]
      .map(value => clean(value)).filter(Boolean).join(' — ')
    if (excerpt) {
      candidates.push({
        kind: Array.isArray(item?.gaps) && item.gaps.length ? 'gap' : 'neutral',
        excerpt,
        questionIndex: questionIndexOrNull(item?.questionIndex) ?? index,
        questionText: clean(item?.questionText),
        order: index,
      })
    }
  }
  return candidates
}

function normalizeRawDimensions(raw) {
  const list = Array.isArray(raw?.dimensions)
    ? raw.dimensions
    : Object.entries(raw?.dimensions || {}).map(([key, value]) => ({ key, ...value }))
  return new Map(list.map(item => [clean(item?.key, 40), item]))
}

function fallbackTask(report, interview) {
  const qa = (Array.isArray(report?.qaReview) ? report.qaReview : [])
    .find(item => clean(item?.questionText) && (item?.gaps?.length || clean(item?.howToImprove)))
  if (qa) {
    const gap = clean(qa?.gaps?.[0] || qa?.howToImprove)
    return {
      id: `${interview?.id || 'report'}:${questionIndexOrNull(qa.questionIndex) ?? 0}`,
      interviewId: interview?.id || null,
      questionIndex: questionIndexOrNull(qa.questionIndex) ?? 0,
      questionText: clean(qa.questionText),
      title: clean(qa.questionSummary) || clean(qa.questionText, 120),
      reason: gap || clean(qa.howToImprove),
      estimatedMinutes: 8,
      dimension: null,
    }
  }
  const improvement = (Array.isArray(report?.toImprove) ? report.toImprove : []).find(item => clean(item?.title))
  if (!improvement) return null
  return {
    id: `${interview?.id || 'report'}:improvement:0`,
    interviewId: interview?.id || null,
    questionIndex: null,
    questionText: clean(improvement.how || improvement.title),
    title: clean(improvement.title),
    reason: clean(improvement.why || improvement.how),
    estimatedMinutes: 8,
    dimension: null,
  }
}

function normalizeTask(raw, fallback, interviewId) {
  const source = raw && typeof raw === 'object' ? raw : fallback
  if (!source || !clean(source.questionText || source.title)) return fallback
  const estimatedMinutes = Math.max(3, Math.min(30, Number(source.estimatedMinutes) || 8))
  return {
    id: clean(source.id, 160) || `${interviewId || 'report'}:recommended`,
    interviewId: interviewId || source.interviewId || null,
    questionIndex: questionIndexOrNull(source.questionIndex),
    questionText: clean(source.questionText || source.title),
    title: clean(source.title || source.questionText, 240),
    reason: clean(source.reason),
    estimatedMinutes,
    dimension: READINESS_DIMENSIONS.some(item => item.key === source.dimension) ? source.dimension : null,
  }
}

export function enrichReportForGrowth(reportInput, interview = {}) {
  const report = reportInput && typeof reportInput === 'object' ? reportInput : {}
  const rawReadiness = report.careerReadiness && typeof report.careerReadiness === 'object'
    ? report.careerReadiness
    : {}
  const rawDimensions = normalizeRawDimensions(rawReadiness)
  const candidates = reportEvidenceCandidates(report)

  const dimensions = READINESS_DIMENSIONS.map(definition => {
    const raw = rawDimensions.get(definition.key) || {}
    const explicitEvidence = raw.evidence && typeof raw.evidence === 'object' ? raw.evidence : null
    const matches = candidates.filter(candidate => textIncludesAny(candidate.excerpt, definition.keywords))
    const strongest = matches.find(candidate => candidate.kind === 'gap') || matches[0] || null
    let score = clampScore(raw.score)
    if (score === null && matches.length) {
      const strengths = matches.filter(candidate => candidate.kind === 'strength').length
      const gaps = matches.filter(candidate => candidate.kind === 'gap').length
      score = Math.max(35, Math.min(92, 66 + strengths * 7 - gaps * 9))
    }
    const evidenceExcerpt = clean(explicitEvidence?.excerpt || raw.evidenceExcerpt || strongest?.excerpt)
    const questionIndex = questionIndexOrNull(explicitEvidence?.questionIndex ?? raw.questionIndex ?? strongest?.questionIndex)
    const action = raw.action && typeof raw.action === 'object' ? raw.action : null
    return {
      key: definition.key,
      score,
      status: score === null ? 'insufficient' : 'scored',
      evidence: evidenceExcerpt ? {
        interviewId: interview?.id || null,
        questionIndex,
        excerpt: evidenceExcerpt,
        source: clean(explicitEvidence?.source || (strongest?.kind === 'strength' ? 'strength' : 'report')),
      } : null,
      action: action ? {
        title: clean(action.title),
        reason: clean(action.reason || evidenceExcerpt),
        estimatedMinutes: Math.max(3, Math.min(30, Number(action.estimatedMinutes) || 8)),
        questionText: clean(action.questionText || strongest?.questionText || action.title),
      } : null,
    }
  })
  const scored = dimensions.filter(item => item.score !== null)
  const overallScore = scored.length
    ? Math.round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length)
    : null
  const fallback = fallbackTask(report, interview)
  const nextPracticeTask = normalizeTask(report.nextPracticeTask, fallback, interview?.id)
  if (nextPracticeTask && !nextPracticeTask.dimension) {
    const weakest = scored.slice().sort((a, b) => a.score - b.score)[0]
    nextPracticeTask.dimension = weakest?.key || null
  }

  return {
    ...report,
    careerReadiness: {
      version: 1,
      assessment: dimensions.every(item => item.score !== null) ? 'initial' : 'partial',
      overallScore,
      dimensions,
    },
    nextPracticeTask,
  }
}

function positionSimilarity(left, right) {
  const a = clean(left, 300).toLowerCase().split(/\W+/).filter(word => word.length > 2)
  const b = new Set(clean(right, 300).toLowerCase().split(/\W+/).filter(word => word.length > 2))
  if (!a.length || !b.size) return 0
  return a.filter(word => b.has(word)).length / Math.max(a.length, b.size)
}

export function aggregateCareerReadiness(interviews = []) {
  const completed = (interviews || [])
    .filter(interview => interview?.report_json)
    .map(interview => {
      let parsed = interview.report_json
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed) } catch { parsed = null }
      }
      return parsed ? { ...interview, report: enrichReportForGrowth(parsed, interview) } : null
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at))
  const target = completed[0] || null
  if (!target) {
    return {
      assessment: 'insufficient', reportCount: 0, overallScore: null,
      dimensions: READINESS_DIMENSIONS.map(item => ({ key: item.key, score: null, trend: null, evidence: null, action: null })),
      nextPracticeTask: null, weeklyTasks: [],
    }
  }

  const dimensions = READINESS_DIMENSIONS.map(definition => {
    const values = []
    completed.slice(0, 5).forEach((interview, index) => {
      const dimension = interview.report.careerReadiness.dimensions.find(item => item.key === definition.key)
      if (!dimension || dimension.score === null) return
      const recency = 1 / (1 + index * 0.35)
      const positionWeight = positionSimilarity(target.position, interview.position) >= 0.5 ? 1.25 : 1
      const interviewerWeight = target.interviewer_type === interview.interviewer_type ? 1.15 : 1
      values.push({ interview, dimension, weight: recency * positionWeight * interviewerWeight })
    })
    if (!values.length) return { key: definition.key, score: null, trend: null, evidence: null, action: null }
    const weightTotal = values.reduce((sum, item) => sum + item.weight, 0)
    const score = Math.round(values.reduce((sum, item) => sum + item.dimension.score * item.weight, 0) / weightTotal)
    let trend = null
    if (values.length >= 2) trend = values[0].dimension.score - values[1].dimension.score
    const evidenceSource = values.find(item => item.dimension.evidence)?.dimension.evidence || null
    const actionSource = values.find(item => item.dimension.action)?.dimension.action || null
    return { key: definition.key, score, trend, evidence: evidenceSource, action: actionSource }
  })
  const scored = dimensions.filter(item => item.score !== null)
  const weeklyTasks = []
  if (target.report.nextPracticeTask) weeklyTasks.push(target.report.nextPracticeTask)
  dimensions
    .filter(item => item.action?.title)
    .sort((left, right) => (left.score ?? 101) - (right.score ?? 101))
    .forEach((item) => {
      if (weeklyTasks.length >= 5) return
      if (weeklyTasks.some(task => clean(task.title) === clean(item.action.title))) return
      weeklyTasks.push({
        id: `${target.id}:${item.key}:weekly`,
        interviewId: item.evidence?.interviewId || target.id,
        questionIndex: item.evidence?.questionIndex ?? null,
        questionText: clean(item.action.questionText || item.action.title),
        title: clean(item.action.title),
        reason: clean(item.action.reason || item.evidence?.excerpt),
        estimatedMinutes: item.action.estimatedMinutes || 8,
        dimension: item.key,
      })
    })
  return {
    assessment: completed.length < 2 ? 'initial' : 'established',
    reportCount: completed.length,
    overallScore: scored.length ? Math.round(scored.reduce((sum, item) => sum + item.score, 0) / scored.length) : null,
    dimensions,
    nextPracticeTask: target.report.nextPracticeTask,
    weeklyTasks,
    latestInterviewId: target.id,
  }
}

export function summarizeTrainingEvents(events = [], now = new Date()) {
  const days = [...new Set((events || []).map(event => clean(event?.activity_date, 10)).filter(Boolean))].sort().reverse()
  const current = new Date(now)
  current.setHours(0, 0, 0, 0)
  const weekDay = current.getDay() || 7
  const monday = new Date(current)
  monday.setDate(monday.getDate() - weekDay + 1)
  const mondayKey = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
  const weeklyDays = days.filter(day => day >= mondayKey).length
  const daySet = new Set(days)
  const cursor = new Date(current)
  const keyFor = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  if (!daySet.has(keyFor(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (daySet.has(keyFor(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return {
    effectiveDays: days.length,
    weeklyDays,
    streak,
    checkedInToday: daySet.has(keyFor(current)),
  }
}
