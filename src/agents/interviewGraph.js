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

function makeLLM(opts = {}) {
  const isVertex = !!(process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || true)

  if (isVertex) {
    const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'aiinterviewer-491711'
    const location = process.env.GCP_LOCATION || 'us-central1'
    // Enterprise stable (Vertex AI)
    return new ChatVertexAI({
      model: opts.model || process.env.GCP_MODEL || 'gemini-1.5-flash',
      project: projectId,
      location: location,
      temperature: opts.temperature ?? 0.8,
      streaming: opts.streaming ?? true,
      maxOutputTokens: opts.maxOutputTokens ?? opts.maxTokens ?? 1024,
    })
  } else {
    // Consumer / Free tier (AI Studio)
    return new ChatGoogleGenerativeAI({
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      apiKey: process.env.GEMINI_API_KEY,
      temperature: opts.temperature ?? 0.8,
      streaming: opts.streaming ?? true,
      maxOutputTokens: opts.maxTokens ?? 1024,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    })
  }
}

let analyzerLLM = null
let responseLLM = null
let feedbackLLM = null

function ensureLLMs() {
  if (!analyzerLLM) analyzerLLM = makeLLM({ temperature: 0.3, streaming: true, maxTokens: 1024 })
  if (!responseLLM) responseLLM = makeLLM({ temperature: 0.85, streaming: true, maxTokens: 1024 })
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

  const systemPrompt = renderPrompt(_prompts.opening, {
    INTERVIEWER_NAME: interviewerName,
    POSITION: config?.position || '',
    LANGUAGE: config?.language || 'English',
    JOB_DESCRIPTION: config?.jobDescription || '',
    RESUME_SNAPSHOT: snap,
  })

  const lang = config?.language || 'English'
  const trigger = lang === 'Deutsch'
    ? 'Kurze Begrüßung + Bitte zur Selbstvorstellung. Maximal 50 Wörter.'
    : 'Brief greeting + ask for self-introduction. 50 words max.'

  const response = await responseLLM.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(trigger),
  ])

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

  const systemPrompt = renderPrompt(_prompts.explore, {
    INTERVIEWER_NAME: interviewerName,
    POSITION: config?.position || '',
    LANGUAGE: config?.language || 'English',
    MAX_QUESTIONS: String(maxQ),
    JOB_DESCRIPTION: config?.jobDescription || '',
    RESUME_SNAPSHOT: snap,
    ANALYSIS_NOTES: lastNotes,
    QUESTION_NUMBER: String(planIndex + 1),
    CONVERSATION_HISTORY: formatConversationHistory(rawMessages, 6),
  })

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

  const systemPrompt = renderPrompt(_prompts.technical, {
    INTERVIEWER_NAME: interviewerName,
    POSITION: config?.position || '',
    LANGUAGE: config?.language || 'English',
    MAX_QUESTIONS: String(maxQ),
    JOB_DESCRIPTION: config?.jobDescription || '',
    RESUME_SNAPSHOT: resumeSnapshotFromConfig(config),
    DOMAIN_TOPICS: domain?.topics?.slice(0, 6).map(t => `• ${t}`).join('\n') || '',
    ANALYSIS_NOTES: lastNotes,
    QUESTION_NUMBER: String(planIndex + 1),
    CONVERSATION_HISTORY: formatConversationHistory(rawMessages, 6),
  })

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

  const systemPrompt = renderPrompt(_prompts.behavioral, {
    INTERVIEWER_NAME: interviewerName,
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
  })

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

  const systemPrompt = renderPrompt(_prompts.feedback, {
    POSITION: config?.position || '',
    LANGUAGE: config?.language || 'English',
    QUESTION_COUNT: String(questionCount),
    TECHNICAL_COUNT: String(technicalCount),
    BEHAVIORAL_COUNT: String(behavioralCount),
    ANALYSIS_NOTES: analysisNotes.join('\n\n') || 'No analysis notes available.',
    CONVERSATION_HISTORY: formatConversationHistory(rawMessages, 14),
  })

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
