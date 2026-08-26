import test from 'node:test'
import assert from 'node:assert/strict'
import {
  adaptDifficulty,
  analyzePracticeAnswer,
  buildFallbackInterviewQuestion,
  buildCompetencyMatrix,
  difficultyInstruction,
  generateInterviewQuestion,
  generatePracticeHint,
  limitedReconnectContext,
  nextHintLevel,
  practiceLimitState,
  rankExperienceDocuments,
  summarizePracticeProgress,
} from '../src/lib/interviewLearning.js'
import { buildInterviewPlan, getPracticeCoreQuestions } from '../src/agents/utils.js'
import {
  isQuestionTypeAllowed,
  normalizeInterviewerType,
} from '../src/config/interviewerTypes.js'

test('easy, medium, and hard produce materially different question policies', () => {
  const easy = difficultyInstruction('easy')
  const medium = difficultyInstruction('medium')
  const hard = difficultyInstruction('hard')
  assert.match(easy, /foundational/i)
  assert.match(medium, /applied judgment/i)
  assert.match(hard, /failure modes/i)
  assert.equal(new Set([easy, medium, hard]).size, 3)
})

test('adaptive difficulty follows deterministic score thresholds and bounds', () => {
  assert.equal(adaptDifficulty('medium', 90), 'hard')
  assert.equal(adaptDifficulty('medium', 50), 'easy')
  assert.equal(adaptDifficulty('medium', 70), 'medium')
  assert.equal(adaptDifficulty('hard', 99), 'hard')
  assert.equal(adaptDifficulty('easy', 10), 'easy')
})

test('question generation includes effective difficulty, RAG provenance, and competency rubric', async () => {
  let capturedPrompt = ''
  const result = await generateInterviewQuestion({
    config: {
      mode: 'practice',
      difficulty: 'adaptive',
      currentDifficulty: 'hard',
      language: 'English',
      position: 'Backend Engineer',
      jobDescription: 'Design cloud APIs and databases',
      resumeSnapshot: 'Built a Node API',
    },
    checkpoint: { currentDifficulty: 'hard' },
    priorQuestions: ['Tell me about yourself'],
    recentAnswerContext: [{
      question: 'Tell me about yourself',
      answer: 'I built a Node API and improved its reliability.',
      feedback: { gaps: ['Explain the measured impact'] },
    }],
    ragDocuments: [{ id: 'rag-1', company: 'Example GmbH' }],
    invoke: async (_system, prompt) => {
      capturedPrompt = prompt
      return JSON.stringify({
        questionText: 'How would you contain a cascading database failure?',
        questionType: 'case',
        competency: 'technical_depth',
        source: 'experience_rag',
        rubric: { criteria: ['failure isolation'] },
      })
    },
  })
  assert.equal(result.difficulty, 'hard')
  assert.deepEqual(result.sourceMetadata.ragDocumentIds, ['rag-1'])
  assert.deepEqual(result.rubric.criteria, ['failure isolation'])
  assert.match(capturedPrompt, /HARD/)
  assert.match(capturedPrompt, /Example GmbH/)
  assert.match(capturedPrompt, /improved its reliability/)
  assert.match(capturedPrompt, /measured impact/)
})

test('progressive hints advance through all four levels', async () => {
  assert.equal(nextHintLevel([]), 'nudge')
  assert.equal(nextHintLevel([{ level: 'nudge' }]), 'structure')
  assert.equal(nextHintLevel([{ level: 'nudge' }, { level: 'structure' }]), 'key_points')
  assert.equal(nextHintLevel([
    { level: 'nudge' }, { level: 'structure' }, { level: 'key_points' },
  ]), 'example')
  assert.equal(nextHintLevel([
    { level: 'nudge' }, { level: 'structure' }, { level: 'key_points' }, { level: 'example' },
  ]), null)
  const hint = await generatePracticeHint({
    config: { language: 'English' },
    question: { question_text: 'Describe an incident.' },
    attempts: [],
    existingHints: [],
    invoke: async () => '{"content":"Think about the first observable symptom."}',
  })
  assert.equal(hint.level, 'nudge')
  assert.match(hint.content, /observable symptom/)
})

test('interviewer type policies constrain plans and generated question types', async () => {
  assert.equal(normalizeInterviewerType('unknown'), 'mixed')
  assert.ok(buildInterviewPlan(9, 'hr').every(slot => slot !== 'technical'))
  assert.ok(buildInterviewPlan(9, 'technical').every(slot => slot !== 'behavioral'))
  assert.equal(isQuestionTypeAllowed('hr', 'motivation'), true)
  assert.equal(isQuestionTypeAllowed('hr', 'technical'), false)
  assert.equal(isQuestionTypeAllowed('technical', 'case'), true)
  assert.equal(isQuestionTypeAllowed('technical', 'behavioral'), false)

  await assert.rejects(generateInterviewQuestion({
    config: { interviewerType: 'hr', mode: 'practice', difficulty: 'medium', language: 'English' },
    checkpoint: {},
    priorQuestions: [],
    ragDocuments: [],
    invoke: async () => JSON.stringify({
      questionText: 'Design a distributed cache.',
      questionType: 'technical',
      competency: 'technical_depth',
      rubric: {},
    }),
  }), /disallowed type/i)
})

test('practice is untimed and ends after the complete opening plus interview plan', () => {
  const active = practiceLimitState({
    difficulty: 'easy',
    duration: 10,
    question_index: 2,
    accumulated_seconds: 120,
    active_since: '2026-08-24T10:00:00.000Z',
    status: 'active',
  }, Date.parse('2026-08-24T10:03:00.000Z'))
  assert.equal(active.elapsedSeconds, 300)
  assert.equal(active.remainingSeconds, null)
  assert.equal(active.timeLimitReached, false)
  assert.equal(active.questionLimit, 6)

  const paused = practiceLimitState({
    difficulty: 'easy',
    duration: 10,
    question_index: 6,
    accumulated_seconds: 120,
    active_since: '2026-08-24T10:00:00.000Z',
    status: 'paused',
  }, Date.parse('2026-08-24T10:30:00.000Z'))
  assert.equal(paused.elapsedSeconds, 120)
  assert.equal(paused.questionLimitReached, true)

  assert.equal(practiceLimitState({ difficulty: 'easy', question_index: 5 }).questionLimit, 6)
  assert.equal(practiceLimitState({ difficulty: 'medium', question_index: 9 }).questionLimit, 10)
  assert.equal(practiceLimitState({ difficulty: 'hard', question_index: 18 }).questionLimit, 19)
  assert.equal(practiceLimitState({ difficulty: 'adaptive', question_index: 9 }).questionLimit, 10)
  assert.equal(getPracticeCoreQuestions('easy'), 5)
  assert.equal(getPracticeCoreQuestions('medium'), 9)
  assert.equal(getPracticeCoreQuestions('hard'), 18)
  assert.equal(buildInterviewPlan(getPracticeCoreQuestions('hard'), 'mixed').length, 18)
})

test('practice feedback remains evidence-grounded and score-normalized', async () => {
  const feedback = await analyzePracticeAnswer({
    config: { language: 'English' },
    question: { question_text: 'What changed?', competency: 'delivery', difficulty: 'medium', rubric_json: {} },
    attempts: [],
    answerText: 'I reduced build time from 20 to 8 minutes.',
    invoke: async () => JSON.stringify({
      score: 105,
      strengths: ['Quantified result'],
      gaps: [],
      nextSteps: [],
      evidence: [{ claim: 'Reduced build time', answerExcerpt: '20 to 8 minutes' }],
    }),
  })
  assert.equal(feedback.score, 100)
  assert.equal(feedback.evidence[0].answerExcerpt, '20 to 8 minutes')
})

test('experience retrieval ranks matching position and content ahead of unrelated rows', () => {
  const ranked = rankExperienceDocuments({
    position: 'Backend Engineer',
    jobDescription: 'Node API database cloud',
    rows: [
      { id: 'unrelated', company: 'A', position: 'Designer', rounds: ['portfolio'] },
      { id: 'matching', company: 'B', position: 'Backend Engineer', rounds: ['Node API system design'] },
    ],
  })
  assert.equal(ranked[0].id, 'matching')
  assert.ok(ranked[0].relevanceScore > 0)
})

test('competency matrix maps JD requirements to resume evidence', () => {
  const matrix = buildCompetencyMatrix('Cloud backend architecture and stakeholder communication', 'Built backend APIs and presented to stakeholders')
  const technical = matrix.find(item => item.competency === 'technical_depth')
  const communication = matrix.find(item => item.competency === 'communication')
  assert.equal(technical.required, true)
  assert.ok(technical.resumeEvidence.length > 0)
  assert.equal(communication.required, true)
})

test('long-term practice report compares first and latest evidence across interviews', () => {
  const report = summarizePracticeProgress([
    { interview_id: 'a', competency: 'delivery', score: 50, created_at: '2026-01-01' },
    { interview_id: 'b', competency: 'delivery', score: 80, created_at: '2026-02-01' },
    { interview_id: 'b', competency: 'technical_depth', score: 60, created_at: '2026-02-02' },
  ])
  const delivery = report.competencies.find(item => item.competency === 'delivery')
  assert.equal(delivery.change, 30)
  assert.equal(report.interviewCount, 2)
  assert.equal(report.totalAttempts, 3)
})

test('Gemini failure does not produce a question payload that could be committed', async () => {
  await assert.rejects(generateInterviewQuestion({
    config: { mode: 'practice', difficulty: 'medium', language: 'English', position: 'Engineer' },
    checkpoint: {},
    priorQuestions: [],
    ragDocuments: [],
    invoke: async () => { throw new Error('quota exhausted') },
  }), /quota exhausted/)
})

test('practice question fallback preserves the mandatory route stage and language', () => {
  const question = buildFallbackInterviewQuestion({
    config: { position: 'Backend Engineer', language: 'Chinese', difficulty: 'medium' },
    checkpoint: {},
    routeStage: 'technical',
  })
  assert.equal(question.questionType, 'technical')
  assert.equal(question.difficulty, 'medium')
  assert.equal(question.sourceMetadata.fallback, true)
  assert.match(question.questionText, /Backend Engineer/)
})

test('reconnect context contains only the requested interview and bounded recent messages', () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `turn-${index}`,
  }))
  const context = limitedReconnectContext({
    interview: {
      id: 'interview-a',
      mode: 'formal',
      status: 'active',
      deadline_at: '2026-08-24T12:00:00Z',
      current_question_id: 'question-a',
    },
    checkpoint: { phase: 'questioning', secretFromOtherInterview: undefined },
    questions: [
      { id: 'question-a', interview_id: 'interview-a', question_text: 'Current A' },
      { id: 'question-b', interview_id: 'interview-b', question_text: 'Other B' },
    ],
    transcript: messages,
  })
  assert.equal(context.interviewId, 'interview-a')
  assert.equal(context.currentQuestion.id, 'question-a')
  assert.equal(context.messages.length, 12)
  assert.equal(context.messages[0].content, 'turn-8')
  assert.doesNotMatch(JSON.stringify(context), /Other B/)
})
