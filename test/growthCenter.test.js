import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateCareerReadiness,
  enrichReportForGrowth,
  summarizeTrainingEvents,
} from '../src/lib/growthCenter.js'

function reportWithScores(scores) {
  const keys = ['technical', 'experience', 'structure', 'communication', 'strategy']
  return {
    summary: ['Evidence-backed report'],
    strengths: ['Clear communication and structured reasoning'],
    toImprove: [{ title: 'Add technical depth', why: 'The architecture trade-off lacked evidence', how: 'Explain one concrete decision' }],
    qaReview: [{
      questionIndex: 2,
      questionText: 'Describe a difficult architecture decision.',
      questionSummary: 'Architecture decision',
      yourAnswerSummary: 'I compared two approaches.',
      gaps: ['The result was not quantified.'],
      howToImprove: 'State the metric and result.',
    }],
    careerReadiness: {
      dimensions: keys.map((key, index) => ({
        key,
        score: scores[index],
        evidence: { questionIndex: 2, excerpt: `${key} evidence`, source: 'qaReview' },
        action: { title: `${key} drill`, reason: `${key} gap`, estimatedMinutes: 8, questionText: 'Describe a difficult architecture decision.' },
      })),
    },
    nextPracticeTask: {
      id: 'task-1',
      questionIndex: 2,
      questionText: 'Describe a difficult architecture decision.',
      title: 'Rebuild the architecture answer',
      reason: 'Make the trade-off and result explicit.',
      estimatedMinutes: 8,
      dimension: 'technical',
    },
  }
}

test('report readiness exposes five traceable dimensions and one executable task', () => {
  const enriched = enrichReportForGrowth(reportWithScores([62, 70, 74, 81, 68]), { id: 'interview-1' })
  assert.equal(enriched.careerReadiness.dimensions.length, 5)
  assert.equal(enriched.careerReadiness.overallScore, 71)
  for (const dimension of enriched.careerReadiness.dimensions) {
    assert.equal(dimension.status, 'scored')
    assert.equal(dimension.evidence.interviewId, 'interview-1')
    assert.equal(dimension.evidence.questionIndex, 2)
    assert.ok(dimension.action.title)
  }
  assert.equal(enriched.nextPracticeTask.questionIndex, 2)
  assert.equal(enriched.nextPracticeTask.estimatedMinutes, 8)
})

test('one report is labeled initial and never fabricates a trend', () => {
  const readiness = aggregateCareerReadiness([{
    id: 'interview-1',
    position: 'Backend Engineer',
    interviewer_type: 'technical',
    completed_at: '2026-08-27T08:00:00Z',
    report_json: reportWithScores([60, 70, 80, 75, 65]),
  }])
  assert.equal(readiness.assessment, 'initial')
  assert.equal(readiness.reportCount, 1)
  assert.ok(readiness.dimensions.every(dimension => dimension.trend === null))
  assert.equal(readiness.weeklyTasks.length, 5)
  assert.equal(readiness.nextPracticeTask.title, 'Rebuild the architecture answer')
})

test('multiple comparable reports produce evidence-backed trends', () => {
  const readiness = aggregateCareerReadiness([
    {
      id: 'new', position: 'Backend Engineer', interviewer_type: 'technical',
      completed_at: '2026-08-27T08:00:00Z', report_json: reportWithScores([72, 74, 82, 79, 70]),
    },
    {
      id: 'old', position: 'Backend Engineer', interviewer_type: 'technical',
      completed_at: '2026-08-20T08:00:00Z', report_json: reportWithScores([62, 70, 76, 75, 66]),
    },
  ])
  assert.equal(readiness.assessment, 'established')
  assert.equal(readiness.dimensions.find(item => item.key === 'technical').trend, 10)
  assert.equal(readiness.dimensions.find(item => item.key === 'technical').evidence.interviewId, 'new')
})

test('training rhythm counts each calendar date once across effective event types', () => {
  const rhythm = summarizeTrainingEvents([
    { activity_date: '2026-08-27', event_type: 'valid_answer' },
    { activity_date: '2026-08-27', event_type: 'interview_completed' },
    { activity_date: '2026-08-26', event_type: 'effective_duration' },
    { activity_date: '2026-08-25', event_type: 'system_task_completed' },
  ], new Date('2026-08-27T12:00:00Z'))
  assert.deepEqual(rhythm, {
    effectiveDays: 3,
    weeklyDays: 3,
    streak: 3,
    checkedInToday: true,
  })
})
