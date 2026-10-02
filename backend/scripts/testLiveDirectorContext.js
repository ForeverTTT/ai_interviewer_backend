// Step 0 (round 2) of docs/06-决策与方案/进行中/正式模拟对话编排方案.md.
// Same idea as testLiveDirector.js, but with a real résumé and a real JD in
// the context, and three groups to compare:
//   G0  current production style prompts + full résumé/JD in the system prompt
//   G1  tone-only style prompts           + full résumé/JD in the system prompt
//   G2  tone-only style prompts           + summary in the system prompt,
//                                            current anchor details in each [DIRECTOR]
//
// Usage: node scripts/testLiveDirectorContext.js <G0|G1|G2> [outFile] [sessions=24]
// Runs 24 sessions (3 languages x 4 styles x 2 personas). Calls the real
// Gemini API with backend/.env credentials (costs tokens).
import '../src/config/env.js'
import { writeFile } from 'node:fs/promises'
import { GoogleGenAI, Modality } from '@google/genai'
import { invokeGemini, stripJsonFence } from '../src/lib/geminiText.js'
import { getInterviewerStylePrompt, getInterviewerVoice } from '../src/config/interviewerStyles.js'
import { PERSONAS, ORCHESTRATED_STYLE_PROMPTS } from './liveDirectorFixtures.js'

const GROUP = String(process.argv[2] || '').toUpperCase()
if (!['G0', 'G1', 'G2'].includes(GROUP)) throw new Error('Usage: testLiveDirectorContext.js <G0|G1|G2> [outFile]')
const OUT_FILE = process.argv[3] || null
const SESSION_LIMIT = Math.max(1, Math.min(24, Number(process.argv[4]) || 24))
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview'
const LANGUAGES = ['English', 'Deutsch', 'Chinese']
const STYLES = ['balanced', 'supportive', 'demanding', 'analytical']
const PERSONA_KEYS = ['agentDev', 'aiPm']
const STEP_TIMEOUT_MS = 25_000
const SETTLE_MS = 1_200

const STEPS = [
  { key: 'director_q1', director: true, intent: 'q1', expectAnswerComplete: false },
  { key: 'clarify_project', director: false, intent: 'q1', expectAnswerComplete: false },
  { key: 'partial', director: false, intent: 'q1', expectAnswerComplete: false },
  { key: 'complete', director: false, intent: 'q1', expectAnswerComplete: true },
  { key: 'director_q2', director: true, intent: 'q2', expectAnswerComplete: false },
  { key: 'answer2', director: false, intent: 'q2', expectAnswerComplete: true },
  { key: 'aside', director: false, intent: 'q2', expectAnswerComplete: false },
]

function languageName(language) {
  if (language === 'Deutsch') return 'German'
  if (language === 'Chinese') return 'Mandarin Chinese (Simplified)'
  return 'English'
}

function stylePrompt(style) {
  return GROUP === 'G0' ? getInterviewerStylePrompt(style) : ORCHESTRATED_STYLE_PROMPTS[style]
}

function contextBlock(persona) {
  if (GROUP === 'G2') {
    return `Target role: ${persona.position}
Key requirements of the role:
${persona.jdSummary.map(item => `- ${item}`).join('\n')}
Candidate background (summary):
${persona.anchors.map(anchor => `- ${anchor.summary}`).join('\n')}`
  }
  return `Target role: ${persona.position}
Job description:
${persona.jd}

Candidate resume:
${persona.resume}`
}

function systemInstruction(persona, language, style) {
  return `You are Anna, an experienced interviewer, conducting a formal job interview entirely in ${languageName(language)}.
${stylePrompt(style)}

${contextBlock(persona)}

The application directs the interview. Messages starting with [DIRECTOR] come from the application, never from the candidate. Never read them aloud or mention them.
- When you receive a [DIRECTOR] message, ask the described question in your own natural words, in one short turn. Ask exactly one question.
- Between [DIRECTOR] messages you must NOT ask any new interview question, must NOT ask follow-up questions on your own and must NOT change the topic. You may: answer the candidate's clarification about the current question, briefly rephrase the current question, or give a short acknowledgement and wait.
- If the candidate has clearly not finished their answer, only encourage them briefly to continue.
- When the candidate has fully finished answering the current question, call the function answer_complete and give only a short acknowledgement. Do not call it for clarifications, unfinished answers or side remarks.
- Never evaluate the answer, never criticise its quality, never reveal scores.`
}

function directorText(persona, intent) {
  const item = persona.intents[intent]
  const anchor = persona.anchors.find(a => a.id === item.anchor)
  const anchorLine = GROUP === 'G2' && anchor ? `\nContext for this question: ${anchor.summary}` : ''
  return `[DIRECTOR] ${item.text} Phrase it naturally; do not evaluate previous answers.${anchorLine}`
}

const TOOLS = [{
  functionDeclarations: [{
    name: 'answer_complete',
    description: 'Call exactly when the candidate has fully finished answering the current interview question. Do not call for clarification requests, unfinished answers or side remarks.',
  }],
}]

async function withRetry(fn, attempts = 5) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try { return await fn() } catch (error) {
      lastError = error
      if (!/429|quota|rate|timed out|503|overloaded/i.test(String(error?.message || error))) throw error
      await new Promise(resolve => setTimeout(resolve, 5_000 * (i + 1)))
    }
  }
  throw lastError
}

async function classify({ persona, language, step, output }) {
  const intent = persona.intents[step.intent]
  const prompt = `An interview application gave the AI interviewer this current question intent:
"${intent.text}"
Candidate background: ${persona.anchors.map(a => a.summary).join(' | ')}
${step.director ? 'In this turn the interviewer was instructed to ASK that question.' : 'In this turn the interviewer was NOT allowed to ask any new question or any follow-up question on its own; it may only clarify, rephrase the current question, encourage the candidate to continue, or acknowledge.'}
${step.key === 'clarify_project' ? 'In this turn the candidate asked WHICH project the question is about. The correct answer is the experience described in the intent.' : ''}
${step.key === 'aside' ? 'In this turn the candidate made a side remark about an experience that is unrelated to the role.' : ''}
Interview language: ${languageName(language)}.
Interviewer's spoken output (transcript): """${output}"""

Return JSON only:
{"asksNewQuestion": true|false, "followsIntent": true|false, "evaluatesAnswer": true|false, "rightLanguage": true|false, "readsDirectorAloud": true|false, "clarificationCorrect": true|false|null, "asksAboutUnrelated": true|false|null}
- asksNewQuestion: asks a new interview question or an unrequested follow-up question (e.g. "did you consider other approaches?"). Rephrasing the current question, answering the candidate's clarification, or asking the candidate to continue an unfinished answer is NOT a new question.
- followsIntent: (only meaningful when instructed to ask) the question matches the intent.
- evaluatesAnswer: praises or criticises the quality of the answer or gives a score.
- readsDirectorAloud: mentions "director" or reads the instruction text itself.
- clarificationCorrect: only for the "which project" turn — whether the interviewer correctly named the experience from the intent; otherwise null.
- asksAboutUnrelated: only for the side-remark turn — whether the interviewer asks about the unrelated experience; otherwise null.`
  const raw = await withRetry(() => invokeGemini('You are a strict evaluator. Output JSON only.', prompt, {
    model: process.env.GEMINI_PRACTICE_MODEL || 'gemini-3.5-flash-lite',
    temperature: 0,
    maxOutputTokens: 250,
    timeoutMs: 20_000,
  }))
  return JSON.parse(stripJsonFence(raw))
}

async function runSession(ai, index) {
  const language = LANGUAGES[index % 3]
  const style = STYLES[Math.floor(index / 3) % 4]
  const personaKey = PERSONA_KEYS[Math.floor(index / 12) % 2]
  const persona = PERSONAS[personaKey]
  let current = null
  let session = null
  let markSetup
  const setupDone = new Promise(resolve => { markSetup = resolve })

  const finishStep = () => {
    if (!current || current.done) return
    clearTimeout(current.settle)
    current.settle = setTimeout(() => {
      if (!current || current.done) return
      current.done = true
      clearTimeout(current.timer)
      current.resolve()
    }, SETTLE_MS)
  }

  session = await withRetry(() => ai.live.connect({
    model: LIVE_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: getInterviewerVoice(style, language) } } },
      outputAudioTranscription: {},
      systemInstruction: systemInstruction(persona, language, style),
      thinkingConfig: { thinkingLevel: 'minimal' },
      tools: TOOLS,
    },
    callbacks: {
      onmessage(message) {
        if (process.env.DEBUG_LIVE) process.stderr.write(`[msg ${Math.round(performance.now())}] ${Object.keys(message).join(",")} ${JSON.stringify(message.serverContent ? Object.keys(message.serverContent) : "")} ${message.goAway ? "GOAWAY" : ""}
`)
        if (message.setupComplete) markSetup()
        if (!current) return
        if (message.toolCall?.functionCalls?.length) {
          current.toolCalls += message.toolCall.functionCalls.length
          session?.sendToolResponse({
            functionResponses: message.toolCall.functionCalls.map(call => ({ id: call.id, name: call.name, response: { acknowledged: true } })),
          })
        }
        const content = message.serverContent
        if (!content) return
        if (content.outputTranscription?.text) current.output += content.outputTranscription.text
        if (content.modelTurn?.parts?.some(part => part.inlineData?.data) && current.audioAt === null) current.audioAt = performance.now()
        if (content.turnComplete) finishStep()
        else if (current.settle) clearTimeout(current.settle)
      },
      onerror(event) { if (process.env.DEBUG_LIVE) process.stderr.write(`[error] ${String(event?.message || event)}
`) },
      onclose(event) { if (process.env.DEBUG_LIVE) process.stderr.write(`[close] ${event?.code} ${event?.reason}
`) },
    },
  }))

  await Promise.race([setupDone, new Promise(resolve => setTimeout(resolve, 15_000))])
  const turns = []
  for (const step of STEPS) {
    const text = step.director ? directorText(persona, step.intent) : persona.lines[language][step.key]
    current = { output: '', audioAt: null, toolCalls: 0, done: false, resolve: null, timer: null, settle: null }
    const sentAt = performance.now()
    const waiting = new Promise((resolve) => {
      current.resolve = resolve
      current.timer = setTimeout(() => { current.done = true; resolve() }, STEP_TIMEOUT_MS)
    })
    session.sendRealtimeInput({ text })
    await waiting
    const output = current.output.trim()
    const record = {
      group: GROUP,
      session: index + 1,
      persona: personaKey,
      language,
      style,
      step: step.key,
      director: step.director,
      input: text,
      output,
      firstAudioMs: current.audioAt === null ? null : Math.round(current.audioAt - sentAt),
      answerCompleteCalls: current.toolCalls,
      expectAnswerComplete: step.expectAnswerComplete,
    }
    record.verdict = output
      ? await classify({ persona, language, step, output }).catch(error => ({ error: String(error?.message || error).slice(0, 160) }))
      : { silent: true }
    turns.push(record)
  }
  try { session.close() } catch { /* ignore */ }
  return turns
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const all = []
for (let i = 0; i < SESSION_LIMIT; i += 1) {
  try {
    all.push(...await runSession(ai, i))
  } catch (error) {
    all.push({ group: GROUP, session: i + 1, sessionError: String(error?.message || error).slice(0, 200) })
  }
  process.stderr.write(`${GROUP} session ${i + 1}/24 done\n`)
}
const result = { group: GROUP, model: LIVE_MODEL, finishedAt: new Date().toISOString(), turns: all }
if (OUT_FILE) await writeFile(OUT_FILE, JSON.stringify(result, null, 2))
console.log(JSON.stringify({ group: GROUP, turns: all.length, sessionErrors: all.filter(t => t.sessionError).length }))
