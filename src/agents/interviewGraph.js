/**
 * InterviewGraph — LangGraph multi-agent interview system
 *
 * Flow (after opening):
 *   Self-intro prompt → user introduces → planned slots: explore (resume/depth),
 *   technical (role), behavioral — then closing + structured feedback.
 *
 *   route_turn → opening | analyze | feedback
 *   analyze → route_question → ask_explore | ask_technical | ask_behavioral | give_feedback
 */

import { StateGraph, Annotation, START, END } from '@langchain/langgraph'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { ChatVertexAI } from '@langchain/google-vertexai'
import { createGeminiLiveTextModel } from '../lib/geminiLive.js'
import { getInterviewerStylePrompt } from '../config/interviewerStyles.js'
import { interviewerTypeInstruction } from '../config/interviewerTypes.js'
import { difficultyInstruction } from '../lib/interviewLearning.js'
import {
  invokeWithGeminiQuotaFallback,
  supportsSamplingTemperature,
} from '../lib/geminiFallback.js'
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from '@langchain/core/messages'

import {
  loadPrompt,
  loadKnowledge,
  getMaxQuestions,
  findRelevantDomain,
  findUnusedCompetency,
  renderPrompt,
  formatConversationHistory,
} from './utils.js'

function getApiKey() {
  return process.env.GEMINI_API_KEY
}

function getInterviewerContext(roleTrack, language, interviewerStyle) {
  let roleContext
  if (roleTrack === 'school') {
    if (language === 'Deutsch') roleContext = 'ein erfahrener Professor an einer deutschen Universität'
    if (language === 'Chinese' || language === 'zh' || language === '中文') {
      roleContext = '一位负责招生面试的德国大学资深教授'
    }
    roleContext ||= 'a professor at a German university responsible for admissions'
  } else {
    if (language === 'Deutsch') roleContext = 'eine erfahrene Führungskraft bei einem deutschen Unternehmen'
    if (language === 'Chinese' || language === 'zh' || language === '中文') {
      roleContext = '一位德国企业的资深招聘经理'
    }
    roleContext ||= 'a senior hiring manager at a German company'
  }
  return `${roleContext}.\n\n${getInterviewerStylePrompt(interviewerStyle)}`
}

function timeBudgetInstruction(config, planIndex = 0, planLength = null) {
  if (config?.mode === 'practice') return ''
  const duration = Math.max(5, Math.min(60, Number(config?.duration) || 10))
  const totalQuestions = Number(planLength) || getMaxQuestions(duration)
  const remainingQuestions = Math.max(0, totalQuestions - Number(planIndex || 0))
  const deadlineMs = config?.deadlineAt ? new Date(config.deadlineAt).getTime() : NaN
  const remainingMinutes = Number.isFinite(deadlineMs)
    ? Math.max(0, Math.ceil((deadlineMs - Date.now()) / 60_000))
    : duration
  return `TIME BUDGET (mandatory): This formal interview lasts ${duration} minutes. Approximately ${remainingMinutes} minutes and ${remainingQuestions} planned question slots remain. Pace the complete route to finish before the deadline. Keep questions concise, skip optional follow-ups when time is short, and never start another question when no planned slots remain.`
}

function withDifficulty(prompt, config, pacing = {}) {
  const effective = config?.difficulty === 'adaptive'
    ? config?.currentDifficulty || 'medium'
    : config?.difficulty || 'medium'
  return `${prompt}\n\n${interviewerTypeInstruction(config?.interviewerType)}\n\nDIFFICULTY POLICY (mandatory):\n${difficultyInstruction(effective)}\n\n${timeBudgetInstruction(config, pacing.planIndex, pacing.planLength)}`
}

function makeLLM(opts = {}) {
  const apiKey = getApiKey()
  const primaryModel = opts.model
    || (apiKey ? process.env.GEMINI_MODEL : process.env.GCP_MODEL)
    || 'gemini-3.7-flash'

  const createLlm = (model) => {
    if (!apiKey) {
      const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '530979174916'
      const location = process.env.GCP_LOCATION || 'us-central1'
      const fields = {
        model,
        project: projectId,
        location,
        streaming: opts.streaming ?? true,
        maxOutputTokens: opts.maxOutputTokens ?? opts.maxTokens ?? 1024,
      }
      if (supportsSamplingTemperature(model)) fields.temperature = opts.temperature ?? 0.8
      return new ChatVertexAI(fields)
    }

    const fields = {
      model,
      apiKey,
      streaming: opts.streaming ?? true,
      maxOutputTokens: opts.maxTokens ?? 1024,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }
    if (supportsSamplingTemperature(model)) fields.temperature = opts.temperature ?? 0.8
    return new ChatGoogleGenerativeAI(fields)
  }

  const primaryLlm = createLlm(primaryModel)
  let fallbackLlm = null

  return {
    invoke: (...args) => invokeWithGeminiQuotaFallback(primaryModel, (model) => {
      if (model === primaryModel) return primaryLlm.invoke(...args)
      if (!fallbackLlm) fallbackLlm = createLlm(model)
      return fallbackLlm.invoke(...args)
    }),
  }
}

let analyzerLLM = null
let responseLLM = null
let feedbackLLM = null

function ensureLLMs() {
  if (!analyzerLLM) analyzerLLM = makeLLM({ temperature: 0.3, streaming: true, maxTokens: 1024 })
  if (!responseLLM) responseLLM = createGeminiLiveTextModel({
    model: process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview',
    timeoutMs: 45_000,
  })
  if (!feedbackLLM) feedbackLLM = makeLLM({ temperature: 0.75, streaming: true, maxTokens: 4096 })
}

const InterviewStateAnnotation = Annotation.Root({
  messages: Annotation({
    reducer: (existing, incoming) => [...existing, ...(Array.isArray(incoming) ? incoming : [incoming])],
    default: () => [],
  }),

  rawMessages: Annotation({ value: (_, v) => v, default: () => [] }),

  config: Annotation({ value: (_, v) => v, default: () => ({}) }),

  phase: Annotation({ value: (_, v) => v, default: () => 'opening' }),
  questionCount: Annotation({ value: (_, v) => v, default: () => 0 }),
  technicalCount: Annotation({ value: (_, v) => v, default: () => 0 }),
  behavioralCount: Annotation({ value: (_, v) => v, default: () => 0 }),
  exploreCount: Annotation({ value: (_, v) => v, default: () => 0 }),

  /** Ordered slots after self-intro: explore | technical | behavioral */
  plan: Annotation({ value: (_, v) => v, default: () => [] }),
  planIndex: Annotation({ value: (_, v) => v, default: () => 0 }),

  interviewerName: Annotation({ value: (_, v) => v, default: () => 'Anna Müller' }),

  nextQuestionType: Annotation({ value: (_, v) => v, default: () => 'technical' }),
  lastAnswerQuality: Annotation({ value: (_, v) => v, default: () => null }),

  analysisNotes: Annotation({
    reducer: (existing, incoming) => {
      if (!incoming) return existing
      return Array.isArray(incoming)
        ? [...existing, ...incoming]
        : [...existing, incoming]
    },
    default: () => [],
  }),
})

let _prompts = null
let _domains = null
let _competencies = null

const RESUME_SNAPSHOT_MAX = 12_000

function resumeSnapshotFromConfig(config) {
  const raw = config?.resumeSnapshot ?? config?.resumeText ?? ''
  const s = String(raw || '').trim()
  if (!s) return '(No resume text provided for this session.)'
  return s.length > RESUME_SNAPSHOT_MAX ? `${s.slice(0, RESUME_SNAPSHOT_MAX)}\n\n[…truncated…]` : s
}

export async function initInterviewGraph() {
  if (_prompts) return
  ensureLLMs()

  const [analyzer, technical, behavioral, feedback, opening, explore] = await Promise.all([
    loadPrompt('analyzer'),
    loadPrompt('technical_agent'),
    loadPrompt('behavioral_agent'),
    loadPrompt('feedback_agent'),
    loadPrompt('opening_agent'),
    loadPrompt('explore_agent'),
  ])
  _prompts = { analyzer, technical, behavioral, feedback, opening, explore }

  const [domains, competencies] = await Promise.all([
    loadKnowledge('technical_domains'),
    loadKnowledge('behavioral_competencies'),
  ])
  _domains = domains
  _competencies = competencies
}

function routeTurnNode() {
  return {}
}

function routeTurnEdge(state) {
  const { phase, config, plan, planIndex } = state
  const len = Array.isArray(plan) && plan.length > 0 ? plan.length : getMaxQuestions(config?.duration)

  if (phase === 'opening') return 'opening'

  // All planned slots filled — candidate just answered the last question → closing feedback
  if (planIndex >= len) return 'feedback'

  return 'analyze'
}

function toGeminiMessages(rawMessages, limit = 4, fallbackHuman = 'Continue.') {
  const lc = rawMessages
    .slice(-limit)
    .map(m => m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))

  const startIdx = lc.findIndex(m => m instanceof HumanMessage)
  const valid = startIdx >= 0 ? lc.slice(startIdx) : []

  return valid.length > 0 ? valid : [new HumanMessage(fallbackHuman)]
}

async function analyzeAnswerNode(state) {
  const {
    rawMessages, config, analysisNotes, questionCount,
    technicalCount, behavioralCount, exploreCount, plan, planIndex,
  } = state
  const planLen = Array.isArray(plan) && plan.length > 0 ? plan.length : getMaxQuestions(config?.duration)

  const lastUser = [...rawMessages].reverse().find(m => m.role === 'user')
  const userAnswer = lastUser?.content || ''

  const prompt = renderPrompt(_prompts.analyzer, {
    POSITION: config?.position || '',
    LANGUAGE: config?.language || 'English',
    JOB_DESCRIPTION: config?.jobDescription || '(not provided)',
    RESUME_SNAPSHOT: resumeSnapshotFromConfig(config),
    QUESTION_COUNT: String(questionCount),
    TECHNICAL_COUNT: String(technicalCount),
    BEHAVIORAL_COUNT: String(behavioralCount),
    EXPLORE_COUNT: String(exploreCount),
    PLAN_INDEX: String(planIndex),
    PLAN_LENGTH: String(planLen),
    USER_ANSWER: userAnswer,
    ANALYSIS_HISTORY: analysisNotes.slice(-3).join('\n\n---\n\n') || 'none yet',
  })

  const response = await analyzerLLM.invoke([
    new SystemMessage(prompt),
    new HumanMessage('Analyze the answer above and return your JSON assessment.'),
  ])

  let analysis = {}
  try {
    const rawContent = typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
    console.warn('[Analyzer Output]:', rawContent.slice(0, 500))
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
    if (jsonMatch) analysis = JSON.parse(jsonMatch[0])
  } catch {
    analysis = { notes: response.content, suggested_focus: '', end_interview: false }
  }

  const forceFeedback = analysis.end_interview === true

  return {
    nextQuestionType: forceFeedback ? 'feedback' : 'continue',
    lastAnswerQuality: ['strong', 'adequate', 'weak'].includes(analysis.quality) ? analysis.quality : 'adequate',
    analysisNotes: [
      `Q${planIndex + 1} Analysis: ${analysis.notes || ''} | Focus: ${analysis.suggested_focus || ''}`,
    ],
  }
}

function routeQuestionEdge(state) {
  const { nextQuestionType, plan, planIndex, config } = state
  const len = Array.isArray(plan) && plan.length > 0 ? plan.length : getMaxQuestions(config?.duration)

  if (nextQuestionType === 'feedback') return 'feedback'
  if (planIndex >= len) return 'feedback'

  const slot = plan[planIndex]
  if (slot === 'explore') return 'explore'
  if (slot === 'behavioral') return 'behavioral'
  return 'technical'
}

async function generateOpeningNode(state) {
  const { config, interviewerName } = state
  const snap = resumeSnapshotFromConfig(config)

  const systemPrompt = withDifficulty(renderPrompt(_prompts.opening, {
    INTERVIEWER_NAME: interviewerName,
    INTERVIEWER_CONTEXT: getInterviewerContext(config?.roleTrack, config?.language, config?.interviewerStyle),
    POSITION: config?.position || '',
    LANGUAGE: config?.language || 'English',
    JOB_DESCRIPTION: config?.jobDescription || '',
    RESUME_SNAPSHOT: snap,
  }), config, { planIndex: 0, planLength: state.plan?.length })

  const lang = config?.language || 'English'
  const trigger = lang === 'Deutsch'
    ? 'Kurze Begrüßung + Bitte zur Selbstvorstellung. Maximal 50 Wörter.'
    : 'Brief greeting + ask for self-introduction. 50 words max.'

  const response = await responseLLM.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(trigger),
  ])

  console.warn('[Opening] roleTrack=%s, context=%s', config?.roleTrack, getInterviewerContext(config?.roleTrack, config?.language, config?.interviewerStyle))
  console.warn('[Opening Output]:', response.content)

  return {
    messages: [response],
    phase: 'questioning',
    questionCount: 0,
    technicalCount: 0,
    behavioralCount: 0,
    exploreCount: 0,
  }
}

async function askExploreNode(state) {
  const { config, interviewerName, rawMessages, analysisNotes, planIndex } = state
  const maxQ = Array.isArray(state.plan) && state.plan.length > 0
    ? state.plan.length
    : getMaxQuestions(config?.duration)
  const lastNotes = analysisNotes.slice(-2).join('\n') || 'No prior analysis.'
  const snap = resumeSnapshotFromConfig(config)

  const systemPrompt = withDifficulty(renderPrompt(_prompts.explore, {
    INTERVIEWER_NAME: interviewerName,
    INTERVIEWER_CONTEXT: getInterviewerContext(config?.roleTrack, config?.language, config?.interviewerStyle),
    POSITION: config?.position || '',
    LANGUAGE: config?.language || 'English',
    MAX_QUESTIONS: String(maxQ),
    JOB_DESCRIPTION: config?.jobDescription || '',
    RESUME_SNAPSHOT: snap,
    ANALYSIS_NOTES: lastNotes,
    QUESTION_NUMBER: String(planIndex + 1),
    CONVERSATION_HISTORY: formatConversationHistory(rawMessages, 6),
  }), config, { planIndex, planLength: maxQ })

  const response = await responseLLM.invoke([
    new SystemMessage(systemPrompt),
    ...toGeminiMessages(rawMessages, 6, 'Next question. 50 words max.'),
  ])

  console.warn('[Explore Output]:', response.content)

  return {
    messages: [response],
    planIndex: planIndex + 1,
    questionCount: state.questionCount + 1,
    exploreCount: state.exploreCount + 1,
  }
}

async function askTechnicalNode(state) {
  const { config, interviewerName, rawMessages, analysisNotes, planIndex } = state
  const domain = findRelevantDomain(config?.position, _domains)
  const maxQ = Array.isArray(state.plan) && state.plan.length > 0
    ? state.plan.length
    : getMaxQuestions(config?.duration)
  const lastNotes = analysisNotes.slice(-2).join('\n') || 'No prior analysis.'

  const systemPrompt = withDifficulty(renderPrompt(_prompts.technical, {
    INTERVIEWER_NAME: interviewerName,
    INTERVIEWER_CONTEXT: getInterviewerContext(config?.roleTrack, config?.language, config?.interviewerStyle),
    POSITION: config?.position || '',
    LANGUAGE: config?.language || 'English',
    MAX_QUESTIONS: String(maxQ),
    JOB_DESCRIPTION: config?.jobDescription || '',
    RESUME_SNAPSHOT: resumeSnapshotFromConfig(config),
    DOMAIN_TOPICS: domain?.topics?.slice(0, 6).map(t => `• ${t}`).join('\n') || '',
    ANALYSIS_NOTES: lastNotes,
    QUESTION_NUMBER: String(planIndex + 1),
    CONVERSATION_HISTORY: formatConversationHistory(rawMessages, 6),
  }), config, { planIndex, planLength: maxQ })

  const response = await responseLLM.invoke([
    new SystemMessage(systemPrompt),
    ...toGeminiMessages(rawMessages, 6, 'Next question. 50 words max.'),
  ])

  console.warn('[Technical Output]:', response.content)

  return {
    messages: [response],
    planIndex: planIndex + 1,
    questionCount: state.questionCount + 1,
    technicalCount: state.technicalCount + 1,
  }
}

async function askBehavioralNode(state) {
  const { config, interviewerName, rawMessages, analysisNotes, planIndex } = state
  const maxQ = Array.isArray(state.plan) && state.plan.length > 0
    ? state.plan.length
    : getMaxQuestions(config?.duration)
  const usedNotes = analysisNotes.join(' ')
  const competency = findUnusedCompetency(_competencies, usedNotes)
  const lastNotes = analysisNotes.slice(-2).join('\n') || 'No prior analysis.'

  const systemPrompt = withDifficulty(renderPrompt(_prompts.behavioral, {
    INTERVIEWER_NAME: interviewerName,
    INTERVIEWER_CONTEXT: getInterviewerContext(config?.roleTrack, config?.language, config?.interviewerStyle),
    POSITION: config?.position || '',
    LANGUAGE: config?.language || 'English',
    MAX_QUESTIONS: String(maxQ),
    JOB_DESCRIPTION: config?.jobDescription || '',
    RESUME_SNAPSHOT: resumeSnapshotFromConfig(config),
    COMPETENCY_NAME: competency?.name || 'Teamwork',
    COMPETENCY_DESCRIPTION: config?.language === 'Deutsch'
      ? (competency?.description_de || competency?.description || '')
      : (competency?.description || ''),
    ANALYSIS_NOTES: lastNotes,
    QUESTION_NUMBER: String(planIndex + 1),
    CONVERSATION_HISTORY: formatConversationHistory(rawMessages, 6),
  }), config, { planIndex, planLength: maxQ })

  const response = await responseLLM.invoke([
    new SystemMessage(systemPrompt),
    ...toGeminiMessages(rawMessages, 6, 'Next question. 50 words max.'),
  ])

  console.warn('[Behavioral Output]:', response.content)

  return {
    messages: [response],
    planIndex: planIndex + 1,
    questionCount: state.questionCount + 1,
    behavioralCount: state.behavioralCount + 1,
  }
}

async function giveFeedbackNode(state) {
  const { config, rawMessages, analysisNotes, questionCount, technicalCount, behavioralCount } = state

  const systemPrompt = withDifficulty(renderPrompt(_prompts.feedback, {
    POSITION: config?.position || '',
    LANGUAGE: config?.language || 'English',
    INTERVIEWER_CONTEXT: getInterviewerContext(config?.roleTrack, config?.language, config?.interviewerStyle),
    QUESTION_COUNT: String(questionCount),
    TECHNICAL_COUNT: String(technicalCount),
    BEHAVIORAL_COUNT: String(behavioralCount),
    ANALYSIS_NOTES: analysisNotes.join('\n\n') || 'No analysis notes available.',
    CONVERSATION_HISTORY: formatConversationHistory(rawMessages, 14),
  }), config)

  const response = await feedbackLLM.invoke([
    new SystemMessage(systemPrompt),
    ...toGeminiMessages(rawMessages, 10, 'Please provide warm closing remarks then the structured feedback report.'),
  ])

  return {
    messages: [response],
    phase: 'closed',
  }
}

function buildGraph() {
  const graph = new StateGraph(InterviewStateAnnotation)

  graph.addNode('route_turn', routeTurnNode)
  graph.addNode('analyze_answer', analyzeAnswerNode)
  graph.addNode('generate_opening', generateOpeningNode)
  graph.addNode('ask_explore', askExploreNode)
  graph.addNode('ask_technical', askTechnicalNode)
  graph.addNode('ask_behavioral', askBehavioralNode)
  graph.addNode('give_feedback', giveFeedbackNode)

  graph.addEdge(START, 'route_turn')

  graph.addConditionalEdges('route_turn', routeTurnEdge, {
    opening: 'generate_opening',
    analyze: 'analyze_answer',
    feedback: 'give_feedback',
  })

  graph.addConditionalEdges('analyze_answer', routeQuestionEdge, {
    explore: 'ask_explore',
    technical: 'ask_technical',
    behavioral: 'ask_behavioral',
    feedback: 'give_feedback',
  })

  graph.addEdge('generate_opening', END)
  graph.addEdge('ask_explore', END)
  graph.addEdge('ask_technical', END)
  graph.addEdge('ask_behavioral', END)
  graph.addEdge('give_feedback', END)

  return graph.compile()
}

let _graph = null

export async function getGraph() {
  if (!_graph) {
    await initInterviewGraph()
    _graph = buildGraph()
  }
  return _graph
}

export const RESPONSE_NODES = new Set([
  'generate_opening',
  'ask_explore',
  'ask_technical',
  'ask_behavioral',
  'give_feedback',
])

export const AGENT_LABELS = {
  generate_opening: { name: 'opening', label: '面试官', emoji: '👔' },
  ask_explore: { name: 'explore', label: '经历深挖', emoji: '📎' },
  ask_technical: { name: 'technical', label: '技术面试官', emoji: '💡' },
  ask_behavioral: { name: 'behavioral', label: '行为面试官', emoji: '🤝' },
  give_feedback: { name: 'feedback', label: '面试反馈', emoji: '📋' },
  analyze_answer: { name: 'analyzer', label: '分析中...', emoji: '🔍' },
}
