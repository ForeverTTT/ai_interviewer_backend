import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ThumbsDown, ThumbsUp } from 'lucide-react'
import { authenticatedFetch } from '../lib/authenticatedFetch'
import { getBackendBaseUrl } from '../lib/backendBase'

/** 与 backend/src/lib/analytics.js 的 FEEDBACK_REASONS 保持一致 */
const REASONS = {
  up: ['accurate', 'actionable', 'clear', 'saves_time'],
  down: ['inaccurate', 'too_generic', 'hard_to_understand', 'missing_info', 'too_slow'],
}
const STORAGE_PREFIX = 'fl_feedback:'

const newFeedbackId = () => globalThis.crypto?.randomUUID?.()
  ?? `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function readSaved(key) {
  if (!key) return null
  try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + key) || 'null') } catch { return null }
}

function send(body) {
  // 反馈失败不打扰用户：照常显示感谢。
  return authenticatedFetch(`${getBackendBaseUrl()}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {})
}

/**
 * AI 结果下方的轻反馈：👍 / 👎，可选预设原因，没有自由输入框。
 * feature：interview_report / resume_tailor / cover_letter / resume_diagnose / gallup
 * targetKey：标识这一次结果（面试 ID、生成时间等）；变化时重新询问，同一结果刷新后不再重复询问。
 */
export default function FeedbackPrompt({ feature, targetKey, interviewId, className = '' }) {
  const { t } = useTranslation()
  const storageKey = targetKey ? `${feature}:${targetKey}` : null
  const [state, setState] = useState(() => readSaved(storageKey))
  const [reasons, setReasons] = useState([])

  useEffect(() => {
    setState(readSaved(storageKey))
    setReasons([])
  }, [storageKey])

  const save = (next) => {
    setState(next)
    if (!storageKey) return
    try { localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const rate = (rating) => {
    const feedbackId = state?.feedbackId || newFeedbackId()
    setReasons([])
    save({ feedbackId, rating, stage: 'reasons' })
    void send({ feedbackId, feature, rating, interviewId })
  }

  const finish = (withReasons) => {
    if (withReasons && reasons.length) {
      void send({ feedbackId: state.feedbackId, feature, rating: state.rating, reasons, interviewId })
    }
    save({ ...state, stage: 'done' })
  }

  const toggleReason = (reason) => {
    setReasons((prev) => (prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]))
  }

  const thumb = (rating, Icon) => {
    const active = state?.rating === rating
    return (
      <button
        type="button"
        onClick={() => rate(rating)}
        aria-pressed={active}
        aria-label={t(rating === 'up' ? 'feedback.helpful' : 'feedback.notHelpful')}
        data-track={`feedback-${rating}`}
        className={`grid h-9 w-9 place-items-center rounded-xl border transition-colors ${
          active
            ? 'border-brand-ink bg-brand-ink text-brand-on-ink'
            : 'border-brand-line bg-brand-card text-brand-muted hover:border-brand-ink/30 hover:text-brand-ink'
        }`}
      >
        <Icon className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div
      data-track-section={`feedback-${feature}`}
      className={`rounded-2xl border border-brand-line bg-brand-inset px-5 py-4 ${className}`}
    >
      {state?.stage === 'done' ? (
        <p className="flex items-center gap-2 text-[13px] text-brand-muted" role="status">
          <Check className="h-4 w-4 text-brand-success" />
          {t('feedback.thanks')}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] font-medium text-brand-ink">{t(`feedback.prompt.${feature}`)}</p>
            <div className="flex items-center gap-2">
              {thumb('up', ThumbsUp)}
              {thumb('down', ThumbsDown)}
            </div>
          </div>

          {state?.stage === 'reasons' && (
            <div className="space-y-3 border-t border-brand-line pt-3">
              <p className="text-[12px] text-brand-muted">
                {t(state.rating === 'up' ? 'feedback.reasonsUp' : 'feedback.reasonsDown')}
              </p>
              <div className="flex flex-wrap gap-2">
                {REASONS[state.rating].map((reason) => {
                  const selected = reasons.includes(reason)
                  return (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => toggleReason(reason)}
                      aria-pressed={selected}
                      data-track={`feedback-reason-${reason}`}
                      className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
                        selected
                          ? 'border-brand-ink bg-brand-ink text-brand-on-ink'
                          : 'border-brand-line bg-brand-card text-brand-muted hover:text-brand-ink'
                      }`}
                    >
                      {t(`feedback.reason.${reason}`)}
                    </button>
                  )
                })}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => finish(true)}
                  disabled={!reasons.length}
                  data-track="feedback-submit"
                  className="rounded-xl bg-brand-ink px-4 py-1.5 text-[12px] font-semibold text-brand-on-ink transition-opacity disabled:opacity-40"
                >
                  {t('feedback.submit')}
                </button>
                <button
                  type="button"
                  onClick={() => finish(false)}
                  data-track="feedback-skip"
                  className="text-[12px] text-brand-muted hover:text-brand-ink"
                >
                  {t('feedback.skip')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
