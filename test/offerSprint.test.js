import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildOfferSprintTasks,
  buildRecoveryNudge,
  buildReminderBlueprints,
  buildWeeklyGrowthReport,
  classifyOfferSprint,
} from '../src/lib/offerSprint.js'

const NOW = new Date('2026-08-27T12:00:00.000Z')

function plan(overrides = {}) {
  return {
    id: 'plan-1',
    target_position: 'Backend Engineer',
    next_interview_date: '2026-09-03',
    target_offer_date: '2026-10-15',
    interviewer_type: 'technical',
    weekly_target_days: 5,
    reminder_preferences: { inApp: true, browser: false, email: false, weeklyReport: true },
    ...overrides,
  }
}

test('Offer sprint stage changes at 21, 7, 2, and 0 day boundaries', () => {
  assert.equal(classifyOfferSprint(plan({ next_interview_date: '2026-09-18' }), NOW).stage, 'foundation')
  assert.equal(classifyOfferSprint(plan({ next_interview_date: '2026-09-17' }), NOW).stage, 'focused')
  assert.equal(classifyOfferSprint(plan({ next_interview_date: '2026-09-04' }), NOW).stage, 'focused')
  assert.equal(classifyOfferSprint(plan({ next_interview_date: '2026-09-03' }), NOW).stage, 'imminent')
  assert.equal(classifyOfferSprint(plan({ next_interview_date: '2026-08-30' }), NOW).stage, 'imminent')
  assert.equal(classifyOfferSprint(plan({ next_interview_date: '2026-08-29' }), NOW).stage, 'final48')
  assert.equal(classifyOfferSprint(plan({ next_interview_date: '2026-08-27' }), NOW).stage, 'interview_day')
  assert.equal(classifyOfferSprint(plan({ next_interview_date: '2026-08-26' }), NOW).stage, 'renew')
})

test('weekly plan respects 3-day and 5-task limits and prioritizes imminent preparation', () => {
  const readiness = {
    latestInterviewId: 'interview-1',
    nextPracticeTask: {
      interviewId: 'interview-1', questionIndex: 2, dimension: 'technical',
      title: 'Architecture trade-offs', reason: 'Evidence lacked a result.', estimatedMinutes: 8,
    },
  }
  const light = buildOfferSprintTasks({ plan: plan({ weekly_target_days: 3 }), readiness, hasFormalReport: true, now: NOW })
  assert.equal(light.length, 3)
  assert.equal(light[0].taskType, 'formal_mock')
  const standard = buildOfferSprintTasks({ plan: plan(), readiness, hasFormalReport: true, now: NOW })
  assert.ok(standard.length <= 5)
  assert.ok(standard.some(task => task.taskType === 'focus_question'))
  assert.ok(standard.every(task => task.estimatedMinutes >= 3))
})

test('final 48-hour checklist carries the latest pinned review evidence', () => {
  const tasks = buildOfferSprintTasks({
    plan: plan({ next_interview_date: '2026-08-29' }),
    readiness: { nextPracticeTask: null },
    recentCollections: [
      { id: 'card-1', question_text: 'Explain the architecture trade-off', is_pinned: true },
      { id: 'card-2', question_text: 'Describe a conflict', is_pinned: false },
    ],
    hasFormalReport: true,
    now: NOW,
  })
  const checklist = tasks.find(task => task.taskType === 'pre_interview_checklist')
  assert.deepEqual(checklist.context.reviewCards, [
    { id: 'card-1', questionText: 'Explain the architecture trade-off', isPinned: true },
    { id: 'card-2', questionText: 'Describe a conflict', isPinned: false },
  ])
})

test('reminders are created only for explicitly enabled channels', () => {
  const reminders = buildReminderBlueprints(plan({
    reminder_preferences: { inApp: true, browser: true, email: false, weeklyReport: true },
  }), NOW)
  assert.ok(reminders.some(item => item.reminderType === 'interview_7d' && item.channel === 'in_app'))
  assert.ok(reminders.some(item => item.reminderType === 'interview_7d' && item.channel === 'browser'))
  assert.ok(reminders.every(item => item.channel !== 'email'))
})

test('recovery nudge is gentle, evidence-based, and disappears after today is active', () => {
  assert.deepEqual(buildRecoveryNudge(plan(), {
    effectiveDays: 8, weeklyDays: 1, streak: 0, checkedInToday: false,
  }), { type: 'restart', remainingDays: 4, currentStreak: 0 })
  assert.deepEqual(buildRecoveryNudge(plan(), {
    effectiveDays: 8, weeklyDays: 2, streak: 2, checkedInToday: false,
  }), { type: 'continue', remainingDays: 3, currentStreak: 2 })
  assert.equal(buildRecoveryNudge(plan(), {
    effectiveDays: 8, weeklyDays: 2, streak: 2, checkedInToday: true,
  }), null)
})

test('weekly report never invents readiness changes without a trend', () => {
  const report = buildWeeklyGrowthReport({
    events: [
      { activity_date: '2026-08-27', event_type: 'valid_answer' },
      { activity_date: '2026-08-27', event_type: 'interview_completed' },
    ],
    tasks: [{ status: 'completed' }],
    interviews: [{ updated_at: '2026-08-27T10:00:00Z', accumulated_seconds: 600 }],
    readiness: { dimensions: [{ key: 'technical', trend: null }], nextPracticeTask: null },
    now: NOW,
  })
  assert.equal(report.effectiveDays, 1)
  assert.equal(report.effectiveMinutes, 10)
  assert.equal(report.completedTasks, 1)
  assert.deepEqual(report.changes, [])
})
