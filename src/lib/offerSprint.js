const DAY_MS = 86_400_000

function clean(value, max = 500) {
  return String(value || '').trim().slice(0, max)
}

function dateOnly(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0] || null
}

function utcDay(value) {
  const key = dateOnly(value)
  if (!key) return null
  const date = new Date(`${key}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

export function daysUntil(value, now = new Date()) {
  const target = utcDay(value)
  if (!target) return null
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return Math.round((target.getTime() - today.getTime()) / DAY_MS)
}

export function weekBounds(now = new Date()) {
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const weekday = current.getUTCDay() || 7
  const start = new Date(current)
  start.setUTCDate(start.getUTCDate() - weekday + 1)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

export function classifyOfferSprint(plan, now = new Date()) {
  if (!plan) return { stage: 'setup', interviewDays: null, offerDays: null, targetExpired: false }
  const interviewDays = daysUntil(plan.next_interview_date, now)
  const offerDays = daysUntil(plan.target_offer_date, now)
  if ((interviewDays !== null && interviewDays < 0) || (interviewDays === null && offerDays !== null && offerDays < 0)) {
    return { stage: 'renew', interviewDays, offerDays, targetExpired: true }
  }
  if (interviewDays === 0) return { stage: 'interview_day', interviewDays, offerDays, targetExpired: false }
  if (interviewDays !== null && interviewDays <= 2) return { stage: 'final48', interviewDays, offerDays, targetExpired: false }
  if (interviewDays !== null && interviewDays <= 7) return { stage: 'imminent', interviewDays, offerDays, targetExpired: false }
  if (interviewDays !== null && interviewDays <= 21) return { stage: 'focused', interviewDays, offerDays, targetExpired: false }
  return { stage: 'foundation', interviewDays, offerDays, targetExpired: false }
}

function blueprint(type, priority, estimatedMinutes, extra = {}) {
  return { taskType: type, priority, estimatedMinutes, ...extra }
}

function taskIdentity(task) {
  return [task.taskType, task.sourceInterviewId || '', task.questionIndex ?? '', task.collectionId || '', task.dimension || ''].join(':')
}

export function buildOfferSprintTasks({
  plan,
  readiness,
  recentCollections = [],
  hasFormalReport = false,
  now = new Date(),
} = {}) {
  if (!plan) return []
  const sprint = classifyOfferSprint(plan, now)
  const bounds = weekBounds(now)
  const taskLimit = Math.min(5, Number(plan.weekly_target_days) === 3 ? 3 : 5)
  const next = readiness?.nextPracticeTask
  const questionIndex = next?.questionIndex === null || next?.questionIndex === undefined ? null : Number(next.questionIndex)
  const focusTask = next && Number.isInteger(questionIndex) && questionIndex >= 0
    ? blueprint('focus_question', 20, next.estimatedMinutes || 8, {
      dimension: next.dimension || null,
      sourceInterviewId: next.interviewId || readiness?.latestInterviewId || null,
      questionIndex,
      context: { reason: clean(next.reason, 1_000), title: clean(next.title || next.questionText), questionText: clean(next.questionText, 2_000) },
    })
    : null
  const collection = recentCollections.find(item => item?.is_pinned) || recentCollections[0] || null
  const reviewTask = collection
    ? blueprint('review_collection', 35, 8, { collectionId: collection.id, context: { questionText: clean(collection.question_text, 1_000), position: clean(collection.position) } })
    : blueprint('weekly_review', 80, 6)
  const baseline = blueprint('baseline', 10, 10)
  const formal = blueprint('formal_mock', 30, sprint.stage === 'final48' || sprint.stage === 'imminent' ? 15 : 10, {
    context: { interviewerType: plan.interviewer_type || 'mixed', targetPosition: clean(plan.target_position) },
  })
  const checklist = blueprint('pre_interview_checklist', 5, 6, {
    context: {
      reviewCards: recentCollections.slice(0, 3).map(item => ({
        id: item.id,
        questionText: clean(item.question_text, 300),
        isPinned: item.is_pinned === true,
      })),
    },
  })
  const selfIntro = blueprint('self_intro', 15, 8, { context: { targetPosition: clean(plan.target_position) } })

  let candidates
  if (sprint.stage === 'interview_day') candidates = [checklist, selfIntro, reviewTask, focusTask]
  else if (sprint.stage === 'final48') candidates = [checklist, selfIntro, formal, reviewTask, focusTask]
  else if (sprint.stage === 'imminent') candidates = [formal, focusTask, reviewTask, checklist, selfIntro]
  else if (sprint.stage === 'focused') candidates = [focusTask, formal, reviewTask, selfIntro, blueprint('weekly_review', 70, 6)]
  else if (sprint.stage === 'renew') candidates = [blueprint('weekly_review', 5, 6), focusTask, reviewTask]
  else candidates = [hasFormalReport ? focusTask : baseline, focusTask, reviewTask, formal, blueprint('weekly_review', 70, 6)]

  const seen = new Set()
  return candidates.filter(Boolean).filter(task => {
    const identity = taskIdentity(task)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  }).slice(0, taskLimit).map((task, index) => ({
    ...task,
    stage: sprint.stage === 'setup' ? 'foundation' : sprint.stage,
    weekStart: bounds.start,
    priority: task.priority + index,
    taskKey: `${bounds.start}:${taskIdentity(task)}`.slice(0, 500),
  }))
}

export function buildReminderBlueprints(plan, now = new Date()) {
  if (!plan) return []
  const preferences = plan.reminder_preferences || {}
  const channels = []
  if (preferences.inApp !== false) channels.push('in_app')
  if (preferences.browser === true) channels.push('browser')
  if (preferences.email === true) channels.push('email')
  const reminders = []
  const interview = utcDay(plan.next_interview_date)
  if (interview) {
    ;[[7, 'interview_7d'], [2, 'interview_2d'], [0, 'interview_day']].forEach(([offset, type]) => {
      const scheduled = new Date(interview)
      scheduled.setUTCDate(scheduled.getUTCDate() - offset)
      scheduled.setUTCHours(8, 0, 0, 0)
      if (scheduled.getTime() < now.getTime() - DAY_MS) return
      channels.forEach(channel => reminders.push({
        reminderKey: `${plan.next_interview_date}:${type}`,
        reminderType: type,
        channel,
        scheduledFor: scheduled.toISOString(),
        payload: { targetPosition: clean(plan.target_position), interviewDays: offset },
      }))
    })
  }
  if (preferences.weeklyReport !== false) {
    const bounds = weekBounds(now)
    const sunday = utcDay(bounds.end)
    sunday.setUTCHours(17, 0, 0, 0)
    channels.forEach(channel => reminders.push({
      reminderKey: `${bounds.end}:weekly_report`,
      reminderType: 'weekly_report',
      channel,
      scheduledFor: sunday.toISOString(),
      payload: { weekStart: bounds.start, weekEnd: bounds.end },
    }))
  }
  return reminders
}

export function buildRecoveryNudge(plan, rhythm = {}) {
  if (!plan || rhythm.checkedInToday || Number(rhythm.effectiveDays) <= 0) return null
  const weeklyTarget = [3, 5, 7].includes(Number(plan.weekly_target_days))
    ? Number(plan.weekly_target_days)
    : 5
  if (Number(rhythm.weeklyDays) >= weeklyTarget) return null
  return {
    type: Number(rhythm.streak) > 0 ? 'continue' : 'restart',
    remainingDays: Math.max(0, weeklyTarget - (Number(rhythm.weeklyDays) || 0)),
    currentStreak: Math.max(0, Number(rhythm.streak) || 0),
  }
}

export function buildWeeklyGrowthReport({ events = [], tasks = [], interviews = [], readiness = null, now = new Date() } = {}) {
  const bounds = weekBounds(now)
  const eventDays = new Set(events
    .map(event => dateOnly(event?.activity_date))
    .filter(day => day && day >= bounds.start && day <= bounds.end))
  const completedTasks = tasks.filter(task => task.status === 'completed').length
  const effectiveSeconds = interviews
    .filter(interview => {
      const activityDay = dateOnly(interview.updated_at || interview.completed_at || interview.created_at)
      return activityDay && activityDay >= bounds.start && activityDay <= bounds.end
    })
    .reduce((sum, interview) => sum + Math.max(0, Number(interview.accumulated_seconds) || 0), 0)
  const changes = (readiness?.dimensions || [])
    .filter(dimension => dimension.trend !== null
      && dimension.trend !== undefined
      && Number.isFinite(Number(dimension.trend)))
    .map(dimension => ({ key: dimension.key, trend: Number(dimension.trend), evidence: dimension.evidence || null }))
  return {
    periodStart: bounds.start,
    periodEnd: bounds.end,
    effectiveDays: eventDays.size,
    effectiveMinutes: Math.floor(effectiveSeconds / 60),
    completedTasks,
    changes,
    nextTask: readiness?.nextPracticeTask || null,
    hasTraining: eventDays.size > 0 || completedTasks > 0,
  }
}
