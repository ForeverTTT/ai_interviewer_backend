// Step 0 of docs/06-决策与方案/进行中/正式模拟对话编排方案.md:
// 1. Does Gemini Live follow server-injected [DIRECTOR] instructions without
//    asking new questions on its own ("越权提问率", target <= 5%)?
// 2. Does the Live model support function calling (answer_complete), and does
//    it call it only when the candidate has actually finished?
//
// Candidate turns are sent as text, so voice activity detection is not
// exercised here. Each Live output is classified by the practice model.
//
// Usage: node scripts/testLiveDirector.js [sessions=20] [outFile]
// Calls the real Gemini API with backend/.env credentials (costs tokens).
import '../src/config/env.js'
import { writeFile } from 'node:fs/promises'
import { GoogleGenAI, Modality } from '@google/genai'
import { invokeGemini, stripJsonFence } from '../src/lib/geminiText.js'
import { getInterviewerStylePrompt, getInterviewerVoice } from '../src/config/interviewerStyles.js'

const SESSIONS = Math.max(1, Number(process.argv[2]) || 20)
const OUT_FILE = process.argv[3] || null
const LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview'
const LANGUAGES = ['English', 'Deutsch', 'Chinese']
const STYLES = ['balanced', 'supportive', 'demanding', 'analytical']
const STEP_TIMEOUT_MS = 25_000
const SETTLE_MS = 1_200

const INTENTS = {
  q1: 'Ask how the candidate made the payment webhook handler in their Shop Backend project idempotent, and what their own contribution was.',
  q2: 'Follow-up on the same project: ask how they handled concurrent duplicate webhook deliveries (race conditions).',
}

const SCRIPT = {
  English: {
    clarify: 'Sorry, do you mean the webhook that the payment provider calls, or our own notifications?',
    partial: 'So, first we stored the event id, and then',
    complete: 'we put a unique constraint on that id and processed everything in one transaction, so duplicates returned 200 without side effects. I designed and implemented that part myself.',
    answer2: 'We relied on the database unique constraint, so the second insert failed and we treated that as already processed. I also added a test that fired two identical requests in parallel.',
  },
  Deutsch: {
    clarify: 'Entschuldigung, meinen Sie den Webhook, den der Zahlungsanbieter aufruft, oder unsere eigenen Benachrichtigungen?',
    partial: 'Also, zuerst haben wir die Event-ID gespeichert, und dann',
    complete: 'haben wir eine Unique-Constraint auf die ID gelegt und alles in einer Transaktion verarbeitet, sodass Duplikate einfach 200 zurückgaben. Diesen Teil habe ich selbst entworfen und umgesetzt.',
    answer2: 'Wir haben uns auf die Unique-Constraint der Datenbank verlassen: Der zweite Insert schlug fehl und wurde als bereits verarbeitet behandelt. Außerdem habe ich einen Test geschrieben, der zwei identische Requests parallel sendet.',
  },
  Chinese: {
    clarify: '不好意思，您说的是支付平台回调我们的那个 webhook，还是我们自己发出的通知？',
    partial: '嗯，首先我们把事件 ID 存下来，然后',
    complete: '在这个 ID 上加了唯一约束，并且在同一个事务里处理，所以重复的请求直接返回 200，不会产生副作用。这部分是我自己设计和实现的。',
    answer2: '我们依赖数据库的唯一约束，第二次插入会失败，我们就当作已经处理过。我还写了一个测试，同时并发发送两个完全相同的请求。',
  },
}

// Steps without a director message are where unauthorized questions count.
const STEPS = [
  { key: 'director_q1', director: true, intent: 'q1', expectAnswerComplete: false },
  { key: 'clarify', director: false, intent: 'q1', expectAnswerComplete: false },
  { key: 'partial', director: false, intent: 'q1', expectAnswerComplete: false },
  { key: 'complete', director: false, intent: 'q1', expectAnswerComplete: true },
  { key: 'director_q2', director: true, intent: 'q2', expectAnswerComplete: false },
  { key: 'answer2', director: false, intent: 'q2', expectAnswerComplete: true },
]

function languageName(language) {
  if (language === 'Deutsch') return 'German'
  if (language === 'Chinese') return 'Mandarin Chinese (Simplified)'
  return 'English'
}

function systemInstruction(language, style) {
  return `You are Anna, an experienced interviewer at a German company, conducting a formal technical interview entirely in ${languageName(language)}.
${getInterviewerStylePrompt(style)}

The application directs the interview. Messages starting with [DIRECTOR] come from the application, never from the candidate. Never read them aloud or mention them.
- When you receive a [DIRECTOR] message, ask the described question in your own natural words, in one short turn. Ask exactly one question.
- Between [DIRECTOR] messages you must NOT ask any new interview question and must NOT change the topic. You may: answer the candidate's clarification about the current question, briefly rephrase the current question, or give a short neutral acknowledgement and wait.
- If the candidate has clearly not finished their answer, only encourage them briefly to continue.
- When the candidate has fully finished answering the current question, call the function answer_complete and give only a short acknowledgement. Do not call it for clarifications or unfinished answers.
- Never evaluate the answer, never praise or criticise its quality, never reveal scores.`
}

function directorText(intent) {
  return `[DIRECTOR] ${INTENTS[intent]} Phrase it naturally; do not evaluate previous answers.`
}

const TOOLS = [{
  functionDeclarations: [{
    name: 'answer_complete',
    description: 'Call exactly when the candidate has fully finished answering the current interview question. Do not call for clarification requests or unfinished answers.',
  }],
}]

async function withRetry(fn, attempts = 4) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try { return await fn() } catch (error) {
      lastError = error
      const retryable = /429|quota|rate|timed out/i.test(String(error?.message || error))
      if (!retryable) throw error
      await new Promise(resolve => setTimeout(resolve, 4_000 * (i + 1)))
    }
  }
  throw lastError
}

async function classify({ language, intent, output, director }) {
  const prompt = `An interview application gave the AI interviewer this current question intent:
"${INTENTS[intent]}"
${director ? 'In this turn the interviewer was instructed to ASK that question.' : 'In this turn the interviewer was NOT allowed to ask any new question; it may only clarify, rephrase the current question, encourage, or acknowledge.'}
Interview language: ${languageName(language)}.
Interviewer's spoken output (transcript): """${output}"""

Return JSON only:
{"asksNewQuestion": true|false, "followsIntent": true|false, "evaluatesAnswer": true|false, "rightLanguage": true|false, "readsDirectorAloud": true|false}
- asksNewQuestion: asks a question about a different topic or a new interview question beyond clarifying/rephrasing the current intent.
- followsIntent: (only meaningful when instructed to ask) the question matches the intent.
- evaluatesAnswer: praises or criticises the quality of the candidate's answer or gives a score.
- readsDirectorAloud: mentions "director" or reads the instruction text itself.`
  const raw = await withRetry(() => invokeGemini('You are a strict evaluator. Output JSON only.', prompt, {
    model: process.env.GEMINI_PRACTICE_MODEL || 'gemini-3.5-flash-lite',
    temperature: 0,
    maxOutputTokens: 200,
    timeoutMs: 20_000,
  }))
  return JSON.parse(stripJsonFence(raw))
}

async function runSession(ai, index) {
  const language = LANGUAGES[index % LANGUAGES.length]
  const style = STYLES[index % STYLES.length]
  const lines = SCRIPT[language]
  let current = null
  let toolSupported = true
  let connectError = null

  const createListener = () => ({ output: '', audioAt: null, toolCalls: 0, done: false, resolve: null, timer: null, settle: null })
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

  let session
  const connect = (withTools) => ai.live.connect({
    model: LIVE_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: getInterviewerVoice(style, language) } } },
      outputAudioTranscription: {},
      systemInstruction: systemInstruction(language, style),
      thinkingConfig: { thinkingLevel: 'minimal' },
      ...(withTools ? { tools: TOOLS } : {}),
    },
    callbacks: {
      onmessage(message) {
        if (!current) return
        if (message.toolCall?.functionCalls?.length) {
          current.toolCalls += message.toolCall.functionCalls.length
          session?.sendToolResponse({
            functionResponses: message.toolCall.functionCalls.map(call => ({
              id: call.id, name: call.name, response: { acknowledged: true },
            })),
          })
        }
        const content = message.serverContent
        if (!content) return
        const delta = content.outputTranscription?.text
        if (delta) current.output += delta
        if (content.modelTurn?.parts?.some(part => part.inlineData?.data) && current.audioAt === null) {
          current.audioAt = performance.now()
        }
        if (content.turnComplete) finishStep()
        else if (current.settle) clearTimeout(current.settle)
      },
      onerror(event) { connectError = String(event?.message || event).slice(0, 200) },
      onclose() {},
    },
  })

  try {
    session = await connect(true)
  } catch (error) {
    toolSupported = false
    connectError = String(error?.message || error).slice(0, 200)
    session = await connect(false)
  }

  const turns = []
  for (const step of STEPS) {
    const text = step.director ? directorText(step.intent) : lines[step.key]
    current = createListener()
    const sentAt = performance.now()
    const waiting = new Promise((resolve) => {
      current.resolve = resolve
      current.timer = setTimeout(() => { current.done = true; resolve() }, STEP_TIMEOUT_MS)
    })
    session.sendRealtimeInput({ text })
    await waiting
    const output = current.output.trim()
    const record = {
      session: index + 1,
      language,
      style,
      step: step.key,
      director: step.director,
      output,
      firstAudioMs: current.audioAt === null ? null : Math.round(current.audioAt - sentAt),
      answerCompleteCalls: current.toolCalls,
      expectAnswerComplete: step.expectAnswerComplete,
    }
    record.verdict = output
      ? await classify({ language, intent: step.intent, output, director: step.director }).catch(error => ({ error: String(error?.message || error).slice(0, 160) }))
      : { silent: true }
    turns.push(record)
  }
  try { session.close() } catch { /* ignore */ }
  return { turns, toolSupported, connectError }
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
const all = []
let toolSupported = true
let connectError = null
for (let i = 0; i < SESSIONS; i += 1) {
  const result = await runSession(ai, i)
  all.push(...result.turns)
  toolSupported &&= result.toolSupported
  connectError ||= result.connectError
  process.stderr.write(`session ${i + 1}/${SESSIONS} done\n`)
}

const free = all.filter(t => !t.director && t.verdict && !t.verdict.error && !t.verdict.silent)
const directed = all.filter(t => t.director && t.verdict && !t.verdict.error && !t.verdict.silent)
const rate = (items, pick) => items.length ? Math.round((items.filter(pick).length / items.length) * 1000) / 10 : null
const latencies = all.map(t => t.firstAudioMs).filter(Number.isFinite).sort((a, b) => a - b)
const pct = p => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil((p / 100) * latencies.length) - 1)] : null
const toolTurns = all.filter(t => t.expectAnswerComplete !== undefined)

const summary = {
  model: LIVE_MODEL,
  sessions: SESSIONS,
  turns: all.length,
  functionCallingAccepted: toolSupported,
  connectError,
  unauthorizedQuestionRatePct: rate(free, t => t.verdict.asksNewQuestion),
  evaluatesAnswerRatePct: rate(all.filter(t => t.verdict && !t.verdict.error && !t.verdict.silent), t => t.verdict.evaluatesAnswer),
  readsDirectorAloudRatePct: rate(all.filter(t => t.verdict && !t.verdict.error && !t.verdict.silent), t => t.verdict.readsDirectorAloud),
  directorFollowRatePct: rate(directed, t => t.verdict.followsIntent),
  wrongLanguageRatePct: rate(all.filter(t => t.verdict && !t.verdict.error && !t.verdict.silent), t => t.verdict.rightLanguage === false),
  silentTurns: all.filter(t => !t.output).length,
  classifierErrors: all.filter(t => t.verdict?.error).length,
  answerCompleteCalledWhenExpectedPct: rate(toolTurns.filter(t => t.expectAnswerComplete), t => t.answerCompleteCalls > 0),
  answerCompleteCalledWhenNotExpectedPct: rate(toolTurns.filter(t => !t.expectAnswerComplete), t => t.answerCompleteCalls > 0),
  textToFirstAudioMedianMs: pct(50),
  textToFirstAudioP90Ms: pct(90),
}
console.log(JSON.stringify(summary, null, 2))
if (OUT_FILE) await writeFile(OUT_FILE, JSON.stringify({ summary, turns: all }, null, 2))
