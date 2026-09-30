export const INTERVIEWER_TYPES = ['hr', 'technical', 'mixed']

const POLICIES = {
  hr: {
    label: 'HR / Recruiter',
    allowedQuestionTypes: ['behavioral', 'experience', 'motivation'],
    planPattern: ['experience', 'behavioral', 'motivation', 'behavioral'],
    prompt: 'Act as an HR/recruiting interviewer. Focus on motivation, role fit, career direction, communication, collaboration, conflict, leadership, failure learning, and evidence-based STAR answers. Do not ask coding, algorithm, or deep system-design questions.',
    evaluation: 'Evaluate motivation, communication, STAR evidence, consistency, self-awareness, collaboration, and role/culture fit. Do not invent a technical score.',
  },
  technical: {
    label: 'Technical',
    allowedQuestionTypes: ['technical', 'case', 'experience'],
    planPattern: ['technical', 'experience', 'technical', 'case', 'technical'],
    prompt: 'Act as a technical interviewer for the target role. Focus on role knowledge, project ownership, implementation depth, debugging, system or case analysis, constraints, risks, and technical trade-offs. Keep generic HR and culture-fit questions to the opening only.',
    evaluation: 'Evaluate technical correctness, depth, assumptions, alternatives, trade-offs, operational risks, validation, and the candidate’s actual contribution. Do not invent culture-fit conclusions.',
  },
  mixed: {
    label: 'Mixed',
    allowedQuestionTypes: ['technical', 'case', 'behavioral', 'experience', 'motivation'],
    planPattern: ['experience', 'technical', 'behavioral', 'technical', 'experience'],
    prompt: 'Act as a balanced interview panel representative. Cover relevant experience, technical or role-specific depth, and behavioral evidence in a coherent interview.',
    evaluation: 'Evaluate role-specific depth, experience evidence, communication, behavioral competencies, and overall role fit, keeping each conclusion tied to transcript evidence.',
  },
}

export function normalizeInterviewerType(value, fallback = 'mixed') {
  const normalized = String(value || '').trim().toLowerCase()
  return INTERVIEWER_TYPES.includes(normalized) ? normalized : fallback
}

export function getInterviewerTypePolicy(value) {
  return POLICIES[normalizeInterviewerType(value)]
}

export function interviewerTypeInstruction(value) {
  const type = normalizeInterviewerType(value)
  const policy = POLICIES[type]
  return [
    `INTERVIEWER TYPE (mandatory): ${type.toUpperCase()} — ${policy.label}.`,
    policy.prompt,
    `Allowed question types: ${policy.allowedQuestionTypes.join(', ')}.`,
    `Evaluation focus: ${policy.evaluation}`,
  ].join('\n')
}

export function isQuestionTypeAllowed(interviewerType, questionType) {
  return getInterviewerTypePolicy(interviewerType).allowedQuestionTypes.includes(
    String(questionType || '').trim().toLowerCase(),
  )
}

