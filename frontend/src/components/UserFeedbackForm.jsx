import { useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, Loader2, Send, ThumbsDown, ThumbsUp } from 'lucide-react'
import { authenticatedFetch } from '../lib/authenticatedFetch'
import { getBackendBaseUrl } from '../lib/backendBase'

const MAX_LENGTH = 2000
const savedKey = interviewId => `fl_written_feedback:${interviewId}`

function alreadySubmitted(source, interviewId) {
  if (source !== 'interview' || !interviewId) return false
  try { return localStorage.getItem(savedKey(interviewId)) === 'sent' } catch { return false }
}

/** Explicit feedback: send only on submit, keep the draft if the request fails. */
export default function UserFeedbackForm({ source, interviewId, className = '' }) {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const id = useId()
  const inFlight = useRef(false)
  const pendingSubmission = useRef(null)
  const [message, setMessage] = useState('')
  const [rating, setRating] = useState(null)
  const [status, setStatus] = useState(() => alreadySubmitted(source, interviewId) ? 'sent' : 'idle')
  const isInterview = source === 'interview'
  const sending = status === 'sending'
  const canSubmit = Boolean(message.trim() || (isInterview && rating)) && (!isInterview || interviewId)

  const submit = async event => {
    event.preventDefault()
    if (!canSubmit || inFlight.current) return
    inFlight.current = true
    setStatus('sending')
    const content = {
      source,
      message: message.trim(),
      ...(isInterview && rating ? { rating } : {}),
      ...(interviewId ? { interviewId } : {}),
      pagePath: pathname.slice(0, 160),
    }
    // Retry the exact submission with its original id. An edited draft is new.
    const signature = JSON.stringify(content)
    if (pendingSubmission.current?.signature !== signature) {
      pendingSubmission.current = {
        signature,
        feedbackId: globalThis.crypto?.randomUUID?.()
          ?? `fb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      }
    }
    try {
      const response = await authenticatedFetch(`${getBackendBaseUrl()}/api/feedback/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...content, feedbackId: pendingSubmission.current.feedbackId }),
      })
      if (!response.ok) {
        setStatus(response.status === 429 ? 'limited' : 'failed')
        return
      }
      setStatus('sent')
      setMessage('')
      if (isInterview) {
        try { localStorage.setItem(savedKey(interviewId), 'sent') } catch { /* ignore */ }
      }
    } catch (error) {
      setStatus(error?.code === 'AUTH_EXPIRED' ? 'auth' : 'failed')
    } finally {
      inFlight.current = false
    }
  }

  return (
    <section className={`rounded-2xl border border-brand-line bg-brand-inset/60 p-4 ${className}`} aria-labelledby={`${id}-title`} data-track-mask data-track-section={`user-feedback-${source}`}>
      <h3 id={`${id}-title`} className="text-[14px] font-semibold text-brand-ink">{t(isInterview ? 'userFeedback.interviewTitle' : 'userFeedback.helpTitle')}</h3>
      {status === 'sent' ? (
        <div role="status" className="mt-3 flex items-start gap-2 text-[13px] leading-6 text-brand-muted">
          <Check className="mt-1 h-4 w-4 shrink-0 text-brand-success" />
          <p>{t('userFeedback.thanks')}</p>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-2 space-y-3" aria-busy={sending}>
          <p id={`${id}-hint`} className="text-[12px] leading-5 text-brand-muted">{t(isInterview ? 'userFeedback.interviewHint' : 'userFeedback.helpHint')}</p>
          {isInterview && (
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('userFeedback.ratingLabel')}>
              {[['up', ThumbsUp, 'good'], ['down', ThumbsDown, 'improve']].map(([value, Icon, label]) => (
                <button key={value} type="button" disabled={sending} aria-pressed={rating === value}
                  onClick={() => setRating(previous => previous === value ? null : value)}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-[12px] disabled:opacity-50 ${rating === value ? 'border-brand-ink bg-brand-ink text-brand-on-ink' : 'border-brand-line bg-brand-card text-brand-muted hover:text-brand-ink'}`}>
                  <Icon className="h-4 w-4" />{t(`userFeedback.${label}`)}
                </button>
              ))}
            </div>
          )}
          <div>
            <label htmlFor={`${id}-message`} className="block text-[12px] font-medium text-brand-ink">{t(isInterview ? 'userFeedback.optionalMessage' : 'userFeedback.message')}</label>
            <textarea id={`${id}-message`} name="user-feedback-message" rows={3} maxLength={MAX_LENGTH}
              value={message} disabled={sending} required={!isInterview}
              onChange={event => setMessage(event.target.value)}
              aria-describedby={`${id}-hint ${id}-count`}
              placeholder={t(isInterview ? 'userFeedback.interviewPlaceholder' : 'userFeedback.helpPlaceholder')}
              className="mt-2 block w-full resize-y rounded-xl border border-brand-line bg-brand-card px-3 py-2.5 text-[13px] leading-6 text-brand-ink placeholder:text-brand-muted/75 disabled:opacity-60" />
            <p id={`${id}-count`} className="mt-1 text-right text-[11px] tabular-nums text-brand-muted">{message.length} / {MAX_LENGTH}</p>
          </div>
          {['failed', 'auth', 'limited'].includes(status) && <p role="alert" className="text-[12px] leading-5 text-brand-danger">{t(`userFeedback.${status}`)}</p>}
          <button type="submit" disabled={!canSubmit || sending}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-ink px-4 py-2.5 text-[13px] font-semibold text-brand-on-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t(sending ? 'userFeedback.sending' : 'userFeedback.submit')}
          </button>
        </form>
      )}
    </section>
  )
}
