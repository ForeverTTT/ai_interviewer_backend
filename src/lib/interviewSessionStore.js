import { buildInterviewPlan, getInterviewerName, getMaxQuestions } from '../agents/utils.js'
import { normalizeInterviewerStyle } from '../config/interviewerStyles.js'
import { normalizeInterviewerType } from '../config/interviewerTypes.js'

export class InterviewSessionConflictError extends Error {
  constructor(currentVersion) {
    super('Interview session changed in another request')
    this.name = 'InterviewSessionConflictError'
    this.currentVersion = currentVersion
    this.statusCode = 409
  }
}

export class InterviewSessionNotFoundError extends Error {
  constructor() {
    super('Interview not found')
    this.name = 'InterviewSessionNotFoundError'
    this.statusCode = 404
  }
}

function cleanMessage(message) {
  const content = typeof message?.content === 'string' ? message.content.trim() : ''
  if (!content) return null
  return {
    role: ['assistant', 'system'].includes(message?.role) ? message.role : 'user',
    content,
  }
}

export function sanitizeMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map(cleanMessage).filter(Boolean)
}

export function configFromInterview(interview) {
  return {
    position: interview.position || '',
    jobDescription: interview.job_description_snapshot ?? interview.job_description ?? '',
    language: interview.language || 'English',
    duration: Number(interview.duration) || 10,
    resumeSnapshot: interview.resume_snapshot || '',
    roleTrack: interview.role_track || 'work',
    interviewerStyle: normalizeInterviewerStyle(interview.interviewer_style),
    interviewerType: normalizeInterviewerType(interview.interviewer_type),
    mode: interview.mode || 'formal',
    difficulty: interview.difficulty || 'medium',
    currentDifficulty: interview.current_difficulty || (interview.difficulty === 'adaptive' ? 'medium' : interview.difficulty) || 'medium',
  }
}

export function createInitialCheckpoint(interview) {
  const config = configFromInterview(interview)
  return {
    phase: 'opening',
    questionCount: 0,
    technicalCount: 0,
    behavioralCount: 0,
    exploreCount: 0,
    plan: buildInterviewPlan(getMaxQuestions(config.duration), config.interviewerType),
    planIndex: 0,
    analysisNotes: [],
    interviewerName: getInterviewerName(interview.id),
    config,
  }
}

export function nextCheckpoint(session, responseNode) {
  const next = { ...session, config: { ...session.config } }
  switch (responseNode) {
    case 'generate_opening':
      return {
        ...next,
        phase: 'questioning',
        questionCount: 0,
        technicalCount: 0,
        behavioralCount: 0,
        exploreCount: 0,
        planIndex: 0,
      }
    case 'ask_explore':
      next.exploreCount = (next.exploreCount ?? 0) + 1
      break
    case 'ask_technical':
      next.technicalCount = (next.technicalCount ?? 0) + 1
      break
    case 'ask_behavioral':
      next.behavioralCount = (next.behavioralCount ?? 0) + 1
      break
    case 'give_feedback':
      return { ...next, phase: 'closed' }
    default:
      return next
  }
  return {
    ...next,
    phase: 'questioning',
    planIndex: (next.planIndex ?? 0) + 1,
    questionCount: (next.questionCount ?? 0) + 1,
  }
}

export function checkpointFromGraphState(session, graphState, responseNode) {
  if (!graphState || typeof graphState !== 'object') return nextCheckpoint(session, responseNode)
  const fallback = nextCheckpoint(session, responseNode)
  return {
    phase: graphState.phase ?? fallback.phase,
    questionCount: Number(graphState.questionCount ?? fallback.questionCount) || 0,
    technicalCount: Number(graphState.technicalCount ?? fallback.technicalCount) || 0,
    behavioralCount: Number(graphState.behavioralCount ?? fallback.behavioralCount) || 0,
    exploreCount: Number(graphState.exploreCount ?? fallback.exploreCount) || 0,
    plan: Array.isArray(graphState.plan) ? graphState.plan : fallback.plan,
    planIndex: Number(graphState.planIndex ?? fallback.planIndex) || 0,
    analysisNotes: Array.isArray(graphState.analysisNotes) ? graphState.analysisNotes : fallback.analysisNotes,
    interviewerName: graphState.interviewerName || fallback.interviewerName,
    currentDifficulty: graphState.config?.currentDifficulty || fallback.currentDifficulty || fallback.config?.currentDifficulty,
    lastAnswerQuality: graphState.lastAnswerQuality || fallback.lastAnswerQuality || null,
    config: { ...fallback.config },
  }
}

export async function loadInterviewSession(db, interviewId, userId) {
  const { data, error } = await db
    .from('interviews')
    .select('id,user_id,position,job_description,job_description_snapshot,language,duration,resume_snapshot,role_track,interviewer_style,interviewer_type,mode,difficulty,current_difficulty,status,current_question_id,question_index,graph_state_json,state_version,transcript_json,started_at,paused_at,active_since,accumulated_seconds,deadline_at,completed_at,reconnect_grace_seconds,last_connected_at,competency_matrix_json')
    .eq('id', interviewId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new InterviewSessionNotFoundError()

  const persisted = data.graph_state_json
  const checkpoint = persisted && typeof persisted === 'object' && Object.keys(persisted).length
    ? persisted
    : createInitialCheckpoint(data)

  // Immutable snapshots from the interview row always win over request payloads
  // and over stale checkpoint config.
  checkpoint.config = configFromInterview(data)
  checkpoint.interviewerName ||= getInterviewerName(data.id)
  checkpoint.plan ||= buildInterviewPlan(getMaxQuestions(checkpoint.config.duration), checkpoint.config.interviewerType)

  return {
    interview: data,
    checkpoint,
    stateVersion: Number(data.state_version) || 0,
    transcript: sanitizeMessages(data.transcript_json),
  }
}

export async function commitInterviewTurn(db, {
  interviewId,
  userId,
  expectedVersion,
  idempotencyKey,
  checkpoint,
  messages = [],
  transcript,
  response = {},
}) {
  const { data, error } = await db.rpc('commit_interview_turn', {
    p_interview_id: interviewId,
    p_user_id: userId,
    p_expected_version: expectedVersion,
    p_idempotency_key: idempotencyKey,
    p_graph_state: checkpoint,
    p_messages: sanitizeMessages(messages),
    p_transcript: transcript == null ? null : sanitizeMessages(transcript),
    p_response: response,
  })
  if (error) {
    if (error.code === 'P0002') throw new InterviewSessionNotFoundError()
    throw error
  }
  if (data?.conflict) throw new InterviewSessionConflictError(Number(data.currentVersion))
  return data
}

export async function claimInterviewRequest(db, { interviewId, userId, idempotencyKey }) {
  const { data, error } = await db.rpc('claim_interview_request', {
    p_interview_id: interviewId,
    p_user_id: userId,
    p_idempotency_key: idempotencyKey,
  })
  if (error) {
    if (error.code === 'P0002') throw new InterviewSessionNotFoundError()
    throw error
  }
  return data
}

export async function releaseInterviewRequest(db, { interviewId, userId, idempotencyKey }) {
  const { error } = await db.rpc('release_interview_request', {
    p_interview_id: interviewId,
    p_user_id: userId,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
}
