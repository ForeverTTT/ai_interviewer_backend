import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase, supabaseForUser } from '../lib/supabase.js'
import { normalizeRequestId } from '../lib/observability.js'
import { normalizeInterviewerType } from '../config/interviewerTypes.js'
import { buildCompetencyMatrix, applyInterviewAction } from '../lib/interviewLearning.js'
import { aggregateCareerReadiness, summarizeTrainingEvents } from '../lib/growthCenter.js'
import {
  buildOfferSprintTasks,
  buildRecoveryNudge,
  buildReminderBlueprints,
  buildWeeklyGrowthReport,
  classifyOfferSprint,
  weekBounds,
} from '../lib/offerSprint.js'

const router = Router()

function dbFor(req) {
  return req.accessToken ? supabaseForUser(req.accessToken) : supabase
}

function clean(value, max = 20_000) {
  return String(value || '').trim().slice(0, max)
}

function parseReport(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { return null }
}

function normalizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .map(tag => clean(tag, 40).toLowerCase())
    .filter(Boolean))].slice(0, 12)
}

function validDate(value) {
  if (value === null || value === undefined || value === '') return null
  const text = String(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined
  const parsed = new Date(`${text}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text ? undefined : text
}

function normalizeReminderPreferences(value = {}, emailConfigured = false) {
  return {
    inApp: value.inApp !== false,
    browser: value.browser === true,
    email: emailConfigured && value.email === true,
    weeklyReport: value.weeklyReport !== false,
  }
}

function emailReminderOutboxEnabled() {
  return String(process.env.GROWTH_REMINDER_EMAIL_OUTBOX_ENABLED || '').toLowerCase() === 'true'
}

function taskRow(plan, userId, task) {
  return {
    user_id: userId,
    plan_id: plan.id,
    week_start: task.weekStart,
    task_key: task.taskKey,
    task_type: task.taskType,
    stage: task.stage,
    priority: task.priority,
    estimated_minutes: task.estimatedMinutes,
    dimension: task.dimension || null,
    source_interview_id: task.sourceInterviewId || null,
    question_index: task.questionIndex ?? null,
    collection_id: task.collectionId || null,
    context: task.context || {},
    status: 'pending',
  }
}

async function syncMilestones(userId, reportInterviews, readiness, rhythm) {
  const rows = []
  const formalReports = reportInterviews.filter(interview => interview.mode === 'formal')
  const firstFormal = formalReports[formalReports.length - 1] || null
  if (firstFormal) rows.push({
    user_id: userId, milestone_key: 'first-formal-report', milestone_type: 'first_formal_report',
    evidence: { interviewId: firstFormal.id, completedAt: firstFormal.completed_at },
  })
  if (rhythm.streak >= 5) rows.push({
    user_id: userId, milestone_key: 'effective-streak-5', milestone_type: 'streak_5',
    evidence: { streak: rhythm.streak },
  })
  const improved = (readiness.dimensions || []).find(item => Number(item.trend) >= 15)
  if (improved) rows.push({
    user_id: userId, milestone_key: `readiness-gain-15:${improved.key}`, milestone_type: 'readiness_gain_15',
    evidence: { dimension: improved.key, trend: improved.trend, report: improved.evidence },
  })
  if (rows.length) {
    const { error } = await supabase.from('growth_milestones')
      .upsert(rows, { onConflict: 'user_id,milestone_key', ignoreDuplicates: true })
    if (error) throw error
  }
  const { data, error } = await supabase.from('growth_milestones').select('*')
    .eq('user_id', userId).order('earned_at', { ascending: false })
  if (error) throw error
  return data || []
}

async function syncOfferSprint({ userId, plan, readiness, recentCollections, reportInterviews, recentInterviews, events, rhythm }) {
  const emailConfigured = emailReminderOutboxEnabled()
  const bounds = weekBounds()
  if (!plan) return {
    plan: null,
    sprint: classifyOfferSprint(null),
    tasks: [], todayTask: null,
    progress: { completed: 0, total: 0, percent: 0, effectiveDays: rhythm.weeklyDays, weeklyTargetDays: 5 },
    reminders: [], milestones: [],
    recoveryNudge: null,
    weeklyReport: buildWeeklyGrowthReport({ events, interviews: recentInterviews, readiness }),
    reminderCapabilities: { inApp: true, browser: true, emailConfigured },
    premiumPreview: { visible: readiness.reportCount >= 2, existingDataAlwaysAccessible: true },
  }

  const desired = buildOfferSprintTasks({
    plan,
    readiness,
    recentCollections,
    hasFormalReport: reportInterviews.some(interview => interview.mode === 'formal'),
  })
  const { data: existing, error: existingError } = await supabase.from('growth_offer_tasks').select('*')
    .eq('user_id', userId).eq('plan_id', plan.id).eq('week_start', bounds.start)
  if (existingError) throw existingError
  const terminalRows = (existing || []).filter(task => ['completed', 'skipped'].includes(task.status))
  const terminal = new Set(terminalRows.map(task => task.task_key))
  const completedCount = terminalRows.filter(task => task.status === 'completed').length
  const maxTasks = Number(plan.weekly_target_days) === 3 ? 3 : 5
  const selectedDesired = desired.filter(task => !terminal.has(task.taskKey)).slice(0, Math.max(0, maxTasks - completedCount))
  const activeKeys = new Set([...terminal, ...selectedDesired.map(task => task.taskKey)])
  const staleIds = (existing || []).filter(task => task.status === 'pending' && !activeKeys.has(task.task_key)).map(task => task.id)
  if (staleIds.length) {
    const { error } = await supabase.from('growth_offer_tasks').update({ status: 'expired' })
      .eq('user_id', userId).in('id', staleIds)
    if (error) throw error
  }
  const desiredRows = selectedDesired.map(task => taskRow(plan, userId, task))
  if (desiredRows.length) {
    const { error } = await supabase.from('growth_offer_tasks')
      .upsert(desiredRows, { onConflict: 'user_id,task_key' })
    if (error) throw error
  }

  const reminderBlueprints = buildReminderBlueprints(plan)
  if (reminderBlueprints.length) {
    const reminderRows = reminderBlueprints.map(reminder => ({
      user_id: userId,
      plan_id: plan.id,
      reminder_key: reminder.reminderKey,
      reminder_type: reminder.reminderType,
      channel: reminder.channel,
      scheduled_for: reminder.scheduledFor,
      payload: reminder.payload,
    }))
    const { error } = await supabase.from('growth_offer_reminders')
      .upsert(reminderRows, { onConflict: 'user_id,reminder_key,channel', ignoreDuplicates: true })
    if (error) throw error
  }
  const enabledReminders = new Set(reminderBlueprints.map(item => `${item.reminderKey}:${item.channel}`))
  const { data: pendingReminders, error: pendingError } = await supabase.from('growth_offer_reminders').select('id,channel,reminder_key')
    .eq('user_id', userId).eq('plan_id', plan.id).eq('status', 'pending')
  if (pendingError) throw pendingError
  const disabledIds = (pendingReminders || [])
    .filter(item => !enabledReminders.has(`${item.reminder_key}:${item.channel}`)).map(item => item.id)
  if (disabledIds.length) {
    const { error } = await supabase.from('growth_offer_reminders').update({ status: 'dismissed' })
      .eq('user_id', userId).in('id', disabledIds)
    if (error) throw error
  }

  const [{ data: tasks, error: taskError }, { data: reminders, error: reminderError }] = await Promise.all([
    supabase.from('growth_offer_tasks').select('*').eq('user_id', userId).eq('plan_id', plan.id)
      .eq('week_start', bounds.start).in('status', ['pending', 'completed']).order('priority'),
    supabase.from('growth_offer_reminders').select('*').eq('user_id', userId).eq('plan_id', plan.id)
      .eq('status', 'pending').lte('scheduled_for', new Date().toISOString()).order('scheduled_for'),
  ])
  if (taskError) throw taskError
  if (reminderError) throw reminderError
  const visibleTasks = tasks || []
  const completed = visibleTasks.filter(task => task.status === 'completed').length
  const milestones = await syncMilestones(userId, reportInterviews, readiness, rhythm)
  return {
    plan,
    sprint: classifyOfferSprint(plan),
    tasks: visibleTasks,
    todayTask: visibleTasks.find(task => task.status === 'pending') || null,
    progress: {
      completed,
      total: visibleTasks.length,
      percent: visibleTasks.length ? Math.round((completed / visibleTasks.length) * 100) : 0,
      effectiveDays: rhythm.weeklyDays,
      weeklyTargetDays: plan.weekly_target_days,
    },
    reminders: reminders || [],
    recoveryNudge: buildRecoveryNudge(plan, rhythm),
    milestones,
    weeklyReport: buildWeeklyGrowthReport({ events, tasks: visibleTasks, interviews: recentInterviews, readiness }),
    reminderCapabilities: { inApp: true, browser: true, emailConfigured },
    premiumPreview: { visible: readiness.reportCount >= 2 || completed > 0, existingDataAlwaysAccessible: true },
  }
}

async function ownedInterview(db, interviewId, userId) {
  const { data, error } = await db.from('interviews').select('*')
    .eq('id', interviewId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

async function snapshotPracticeCollection(db, interview, questionId, personalNote) {
  const { data: question, error: questionError } = await db.from('interview_questions')
    .select('*').eq('id', questionId).eq('interview_id', interview.id).maybeSingle()
  if (questionError) throw questionError
  if (!question) return null
  const { data: attempts, error: attemptError } = await db.from('interview_attempts')
    .select('*').eq('question_id', questionId).order('attempt_number', { ascending: false }).limit(1)
  if (attemptError) throw attemptError
  const attempt = attempts?.[0] || null
  return {
    user_id: interview.user_id,
    interview_id: interview.id,
    question_id: question.id,
    question_index: Number(question.sequence) || null,
    origin_key: `practice:${interview.id}:${question.id}`,
    question_text: clean(question.question_text),
    answer_text: clean(attempt?.answer_text),
    feedback_snapshot: attempt?.feedback_json || {},
    position: clean(interview.position, 500),
    language: clean(interview.language, 80) || 'English',
    interviewer_type: normalizeInterviewerType(interview.interviewer_type),
    source: 'practice',
    personal_note: clean(personalNote) || null,
  }
}

function snapshotReportCollection(interview, questionIndex) {
  const report = parseReport(interview.report_json)
  const review = (Array.isArray(report?.qaReview) ? report.qaReview : []).find(
    (item, index) => Number(item?.questionIndex) === Number(questionIndex) || index === Number(questionIndex),
  )
  if (!review) return null
  const normalizedIndex = review.questionIndex !== null && review.questionIndex !== undefined
    && Number.isInteger(Number(review.questionIndex)) && Number(review.questionIndex) >= 0
    ? Number(review.questionIndex)
    : Number(questionIndex)
  const readinessDimension = (Array.isArray(report?.careerReadiness?.dimensions) ? report.careerReadiness.dimensions : [])
    .find(item => Number(item?.evidence?.questionIndex) === normalizedIndex)
  return {
    user_id: interview.user_id,
    interview_id: interview.id,
    question_id: null,
    question_index: normalizedIndex,
    origin_key: `report:${interview.id}:${normalizedIndex}`,
    question_text: clean(review.questionText || review.questionSummary),
    answer_text: clean(review.yourAnswerSummary),
    feedback_snapshot: {
      questionSummary: clean(review.questionSummary),
      gaps: Array.isArray(review.gaps) ? review.gaps.map(item => clean(item)).filter(Boolean) : [],
      howToImprove: clean(review.howToImprove),
      referenceExample: clean(review.referenceExample),
      dimension: clean(readinessDimension?.key, 40) || null,
      action: readinessDimension?.action || null,
    },
    position: clean(interview.position, 500),
    language: clean(interview.language, 80) || 'English',
    interviewer_type: normalizeInterviewerType(interview.interviewer_type),
    source: 'report',
    personal_note: null,
  }
}

router.get('/overview', requireAuth, async (req, res) => {
  const db = dbFor(req)
  try {
    const [interviewResult, collectionResult, eventResult, planResult, recentInterviewResult] = await Promise.all([
      db.from('interviews')
        .select('id,position,language,interviewer_type,mode,status,report_json,created_at,completed_at,accumulated_seconds')
        .eq('user_id', req.user.id).eq('status', 'completed')
        .not('report_json', 'is', null).order('completed_at', { ascending: false }).limit(20),
      db.from('interview_question_collections').select('*')
        .eq('user_id', req.user.id).eq('review_status', 'to_review')
        .order('is_pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(3),
      db.from('interview_training_events').select('activity_date,event_type,created_at')
        .eq('user_id', req.user.id).order('activity_date', { ascending: false }).limit(400),
      db.from('growth_offer_plans').select('*').eq('user_id', req.user.id).maybeSingle(),
      db.from('interviews').select('id,status,mode,created_at,updated_at,completed_at,accumulated_seconds')
        .eq('user_id', req.user.id).order('updated_at', { ascending: false }).limit(100),
    ])
    if (interviewResult.error) throw interviewResult.error
    if (collectionResult.error) throw collectionResult.error
    if (eventResult.error) throw eventResult.error
    if (planResult.error) throw planResult.error
    if (recentInterviewResult.error) throw recentInterviewResult.error
    const readiness = aggregateCareerReadiness(interviewResult.data || [])
    const rhythm = summarizeTrainingEvents(eventResult.data || [])
    const offerSprint = await syncOfferSprint({
      userId: req.user.id,
      plan: planResult.data || null,
      readiness,
      recentCollections: collectionResult.data || [],
      reportInterviews: interviewResult.data || [],
      recentInterviews: recentInterviewResult.data || [],
      events: eventResult.data || [],
      rhythm,
    })
    return res.json({
      readiness,
      recentCollections: collectionResult.data || [],
      rhythm,
      offerSprint,
    })
  } catch (error) {
    console.error('[GET /growth-center/overview]', error)
    return res.status(500).json({ error: 'Failed to load growth center overview' })
  }
})

router.put('/offer-plan', requireAuth, async (req, res) => {
  const targetPosition = clean(req.body?.targetPosition, 300)
  if (!targetPosition) return res.status(400).json({ error: 'targetPosition is required' })
  const nextInterviewDate = validDate(req.body?.nextInterviewDate)
  const targetOfferDate = validDate(req.body?.targetOfferDate)
  if (nextInterviewDate === undefined || targetOfferDate === undefined) {
    return res.status(400).json({ error: 'Dates must use YYYY-MM-DD' })
  }
  const weeklyTargetDays = Number(req.body?.weeklyTargetDays)
  if (![3, 5, 7].includes(weeklyTargetDays)) {
    return res.status(400).json({ error: 'weeklyTargetDays must be 3, 5, or 7' })
  }
  const emailConfigured = emailReminderOutboxEnabled()
  const row = {
    user_id: req.user.id,
    target_position: targetPosition,
    target_job_description: clean(req.body?.targetJobDescription, 20_000),
    next_interview_date: nextInterviewDate,
    target_offer_date: targetOfferDate,
    interviewer_type: normalizeInterviewerType(req.body?.interviewerType),
    weekly_target_days: weeklyTargetDays,
    timezone: clean(req.body?.timezone, 80) || 'Europe/Berlin',
    reminder_preferences: normalizeReminderPreferences(req.body?.reminderPreferences, emailConfigured),
  }
  try {
    const { data, error } = await dbFor(req).from('growth_offer_plans')
      .upsert(row, { onConflict: 'user_id' }).select('*').single()
    if (error) throw error
    return res.json({ plan: data, emailConfigured })
  } catch (error) {
    console.error('[PUT /growth-center/offer-plan]', error)
    return res.status(500).json({ error: 'Failed to save Offer sprint plan' })
  }
})

router.delete('/offer-plan', requireAuth, async (req, res) => {
  try {
    const { data, error } = await dbFor(req).from('growth_offer_plans')
      .delete().eq('user_id', req.user.id).select('id').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Offer sprint plan not found' })
    return res.json({ success: true })
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete Offer sprint plan' })
  }
})

router.patch('/offer-plan/tasks/:taskId', requireAuth, async (req, res) => {
  const status = clean(req.body?.status, 20)
  if (!['completed', 'skipped'].includes(status)) return res.status(400).json({ error: 'Unsupported task status' })
  const db = supabase
  try {
    const { data: existing, error: findError } = await db.from('growth_offer_tasks').select('*')
      .eq('id', req.params.taskId).eq('user_id', req.user.id).maybeSingle()
    if (findError) throw findError
    if (!existing) return res.status(404).json({ error: 'Offer task not found' })
    if (!['pending', 'completed'].includes(existing.status)) {
      return res.status(409).json({ error: 'Offer task is no longer active', code: 'OFFER_TASK_INACTIVE' })
    }
    let data = existing
    if (existing.status !== 'completed') {
      const updateResult = await db.from('growth_offer_tasks').update({
        status,
        completed_at: status === 'completed' ? new Date().toISOString() : null,
      }).eq('id', existing.id).eq('user_id', req.user.id).select('*').single()
      if (updateResult.error) throw updateResult.error
      data = updateResult.data
    }
    if (status === 'completed') {
      const { error: eventError } = await supabase.from('interview_training_events').upsert({
        user_id: req.user.id,
        interview_id: existing.source_interview_id || null,
        event_type: 'system_task_completed',
        dedupe_key: `offer-task:${existing.id}`,
        metadata: { taskId: existing.id, taskType: existing.task_type, planId: existing.plan_id },
      }, { onConflict: 'user_id,dedupe_key' })
      if (eventError) throw eventError
    }
    return res.json({ task: data, reused: existing.status === 'completed' })
  } catch (error) {
    console.error('[PATCH /growth-center/offer-plan/tasks/:taskId]', error)
    return res.status(500).json({ error: 'Failed to update Offer task' })
  }
})

router.patch('/offer-plan/reminders/:reminderId', requireAuth, async (req, res) => {
  const status = req.body?.status === 'read' ? 'read' : req.body?.status === 'dismissed' ? 'dismissed' : null
  if (!status) return res.status(400).json({ error: 'Reminder status must be read or dismissed' })
  try {
    const { data, error } = await supabase.from('growth_offer_reminders').update({ status })
      .eq('id', req.params.reminderId).eq('user_id', req.user.id).select('*').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Reminder not found' })
    return res.json({ reminder: data })
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update reminder' })
  }
})

router.get('/collections', requireAuth, async (req, res) => {
  const db = dbFor(req)
  try {
    let query = db.from('interview_question_collections').select('*')
      .eq('user_id', req.user.id)
      .order('is_pinned', { ascending: false }).order('updated_at', { ascending: false })
      .limit(Math.min(Math.max(Number(req.query.limit) || 200, 1), 500))
    if (req.query.source) query = query.eq('source', clean(req.query.source, 20))
    if (req.query.interviewerType) query = query.eq('interviewer_type', normalizeInterviewerType(req.query.interviewerType))
    if (req.query.reviewStatus) query = query.eq('review_status', clean(req.query.reviewStatus, 20))
    if (req.query.position) query = query.eq('position', clean(req.query.position, 500))
    if (req.query.interviewId) query = query.eq('interview_id', clean(req.query.interviewId, 80))
    if (req.query.dateFrom) query = query.gte('updated_at', clean(req.query.dateFrom, 32))
    if (req.query.dateTo) query = query.lte('updated_at', clean(req.query.dateTo, 32))
    const { data, error } = await query
    if (error) throw error
    const search = clean(req.query.search, 200).toLowerCase()
    const tag = clean(req.query.tag, 40).toLowerCase()
    const collections = (data || []).filter(item => {
      if (tag && !(item.tags || []).includes(tag)) return false
      if (!search) return true
      return [item.question_text, item.answer_text, item.personal_note, item.position, JSON.stringify(item.feedback_snapshot)]
        .some(value => clean(value).toLowerCase().includes(search))
    })
    return res.json({ collections })
  } catch (error) {
    console.error('[GET /growth-center/collections]', error)
    return res.status(500).json({ error: 'Failed to load question collections' })
  }
})

router.post('/collections', requireAuth, async (req, res) => {
  const db = dbFor(req)
  try {
    const interview = await ownedInterview(db, req.body?.interviewId, req.user.id)
    if (!interview) return res.status(404).json({ error: 'Interview not found' })
    const source = req.body?.source === 'practice' ? 'practice' : 'report'
    const snapshot = source === 'practice'
      ? await snapshotPracticeCollection(db, interview, req.body?.questionId, req.body?.personalNote)
      : snapshotReportCollection(interview, req.body?.questionIndex)
    if (!snapshot) return res.status(404).json({ error: 'Question review not found' })
    if (!snapshot.answer_text) return res.status(409).json({ error: 'A saved answer is required before collecting this question' })
    const { data: existing, error: existingError } = await db.from('interview_question_collections')
      .select('*').eq('user_id', req.user.id).eq('origin_key', snapshot.origin_key).maybeSingle()
    if (existingError) throw existingError
    if (existing) return res.json({ collection: existing, reused: true })
    const row = {
      ...snapshot,
      tags: normalizeTags(req.body?.tags),
      is_pinned: req.body?.isPinned === true,
      review_status: req.body?.reviewStatus === 'reviewed' ? 'reviewed' : 'to_review',
    }
    const { data, error } = await db.from('interview_question_collections').insert(row).select('*').single()
    if (error?.code === '23505') {
      const { data: raced, error: racedError } = await db.from('interview_question_collections')
        .select('*').eq('user_id', req.user.id).eq('origin_key', snapshot.origin_key).single()
      if (racedError) throw racedError
      return res.json({ collection: raced, reused: true })
    }
    if (error) throw error
    return res.status(201).json({ collection: data })
  } catch (error) {
    console.error('[POST /growth-center/collections]', error)
    return res.status(500).json({ error: 'Failed to save question collection' })
  }
})

router.patch('/collections/:id', requireAuth, async (req, res) => {
  const patch = {}
  if (typeof req.body?.personalNote === 'string') patch.personal_note = clean(req.body.personalNote) || null
  if (Array.isArray(req.body?.tags)) patch.tags = normalizeTags(req.body.tags)
  if (typeof req.body?.isPinned === 'boolean') patch.is_pinned = req.body.isPinned
  if (['to_review', 'reviewed'].includes(req.body?.reviewStatus)) patch.review_status = req.body.reviewStatus
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No supported fields supplied' })
  try {
    const { data, error } = await dbFor(req).from('interview_question_collections')
      .update(patch).eq('id', req.params.id).eq('user_id', req.user.id).select('*').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Collection not found' })
    return res.json({ collection: data })
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update question collection' })
  }
})

router.delete('/collections/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await dbFor(req).from('interview_question_collections')
      .delete().eq('id', req.params.id).eq('user_id', req.user.id).select('id').maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Collection not found' })
    return res.json({ success: true })
  } catch {
    return res.status(500).json({ error: 'Failed to delete question collection' })
  }
})

router.post('/collections/:id/practice', requireAuth, async (req, res) => {
  const db = dbFor(req)
  try {
    const { data: collection, error: collectionError } = await db.from('interview_question_collections')
      .select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle()
    if (collectionError) throw collectionError
    if (!collection) return res.status(404).json({ error: 'Collection not found' })
    const idempotencyKey = normalizeRequestId(req.body?.idempotencyKey || req.requestId)
    const { data: created, error: createError } = await db.rpc('create_interview_session', {
      p_user_id: req.user.id,
      p_idempotency_key: idempotencyKey,
      p_position: collection.position || 'Focused practice',
      p_job_description: '',
      p_language: collection.language || 'English',
      p_duration: 10,
      p_resume_snapshot: '',
      p_interviewer_style: 'balanced',
      p_interviewer_type: normalizeInterviewerType(collection.interviewer_type),
      p_role_track: 'work',
      p_mode: 'practice',
      p_difficulty: 'medium',
      p_competency_matrix: buildCompetencyMatrix('', ''),
      p_token_cost: 300,
    })
    if (createError) throw createError
    const interview = created?.interview
    if (!interview) throw new Error('Interview creation returned no interview')
    if (!created?.replay) {
      await applyInterviewAction(db, {
        interviewId: interview.id,
        userId: req.user.id,
        expectedVersion: Number(interview.state_version || 0),
        idempotencyKey: normalizeRequestId(`${idempotencyKey}:focus`),
        action: 'question',
        payload: {
          questionText: collection.question_text,
          questionType: collection.interviewer_type === 'technical' ? 'technical' : 'behavioral',
          difficulty: 'medium',
          competency: collection.feedback_snapshot?.dimension || 'focused_review',
          source: 'question_collection',
          sourceMetadata: { collectionId: collection.id, sourceInterviewId: collection.interview_id },
          rubric: {},
        },
      })
    }
    return res.status(created?.replay ? 200 : 201).json({ interviewId: interview.id, replay: created?.replay === true })
  } catch (error) {
    console.error('[POST /growth-center/collections/:id/practice]', error)
    if (error.code === 'P0001' && /insufficient tokens/i.test(error.message || '')) {
      return res.status(403).json({ error: 'Insufficient tokens', code: 'INSUFFICIENT_TOKENS' })
    }
    return res.status(500).json({ error: 'Failed to start focused practice' })
  }
})

router.post('/tasks/:taskId/complete', requireAuth, async (req, res) => {
  const taskId = clean(req.params.taskId, 160)
  if (!taskId) return res.status(400).json({ error: 'taskId is required' })
  try {
    let interviewId = null
    if (req.body?.interviewId) {
      const interview = await ownedInterview(dbFor(req), req.body.interviewId, req.user.id)
      if (!interview) return res.status(404).json({ error: 'Interview not found' })
      interviewId = interview.id
    }
    const { data, error } = await supabase.from('interview_training_events').upsert({
      user_id: req.user.id,
      interview_id: interviewId,
      event_type: 'system_task_completed',
      dedupe_key: `task:${taskId}`,
      metadata: { taskId },
    }, { onConflict: 'user_id,dedupe_key' }).select('*').single()
    if (error) throw error
    return res.json({ event: data })
  } catch {
    return res.status(500).json({ error: 'Failed to complete growth task' })
  }
})

export default router
