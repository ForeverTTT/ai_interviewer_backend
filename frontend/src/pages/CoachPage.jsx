import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { ArrowRight, Check, Clock3, ThumbsDown, ThumbsUp } from 'lucide-react'
import { BRAND_ASSETS } from '../assets/brandAssets'
import { useAuth } from '../hooks/useAuth'
import { authenticatedFetch } from '../lib/authenticatedFetch'
import { getBackendBaseUrl } from '../lib/backendBase'
import './CoachPage.css'

const CONTACT_EMAIL = 'coach@flowlab.example'
const DEV_AUTH_BYPASS = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === 'true'

const newFeedbackId = () => globalThis.crypto?.randomUUID?.()
  ?? `coach-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function readVote(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

export default function CoachPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const storageKey = useMemo(() => `fl_coach_interest_vote:v2:${user?.id || 'anonymous'}`, [user?.id])
  const [vote, setVote] = useState(() => readVote(storageKey))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    document.title = `${t('coachPage.title')} · ${t('meta.title')}`
  }, [t])

  useEffect(() => {
    setVote(readVote(storageKey))
  }, [storageKey])

  const submitVote = async (rating) => {
    if (busy || vote) return
    setBusy(true)
    setError(false)
    try {
      if (!DEV_AUTH_BYPASS) {
        const response = await authenticatedFetch(`${getBackendBaseUrl()}/api/feedback/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feedbackId: newFeedbackId(),
            source: 'help',
            message: rating === 'up' ? '[coach-interest-v1] interested' : '[coach-interest-v1] not-interested',
            rating,
            pagePath: '/coaches',
          }),
        })
        if (!response.ok) throw new Error('vote failed')
      }
      try { localStorage.setItem(storageKey, rating) } catch { /* ignore */ }
      setVote(rating)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="coach-page community-page pb-16 pt-[calc(var(--ui-nav-h)+0.75rem)]">
      <div className="community-shell">
        <section className="coach-hero">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="coach-hero-copy"
          >
            <span className="coach-kicker"><Clock3 aria-hidden="true" />{t('coachPage.kicker')}</span>
            <h1>{t('coachPage.title')}</h1>
            <p className="coach-lead">{t('coachPage.subtitle')}</p>
            <div className="coach-points" aria-label={t('coachPage.pointsLabel')}>
              {['direction', 'practice', 'review'].map((point) => (
                <span key={point}><Check />{t(`coachPage.points.${point}`)}</span>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.92, rotate: 2 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 0.55, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="coach-character-stage"
            aria-hidden="true"
          >
            <img src={BRAND_ASSETS.interviewCoachWriting} alt="" />
          </motion.div>
        </section>

        <div className="coach-actions-grid">
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: 0.12 }}
            className="coach-vote-card"
            aria-labelledby="coach-vote-title"
          >
            <div>
              <span className="coach-card-number">{t('coachPage.vote.eyebrow')}</span>
              <h2 id="coach-vote-title">{t('coachPage.vote.title')}</h2>
              <p>{t('coachPage.vote.body')}</p>
            </div>

            {vote ? (
              <div className="coach-vote-done" role="status">
                <span><Check /></span>
                <div>
                  <strong>{t('coachPage.vote.thanks')}</strong>
                  <p>{t(vote === 'up' ? 'coachPage.vote.upRecorded' : 'coachPage.vote.downRecorded')}</p>
                </div>
              </div>
            ) : (
              <div className="coach-vote-actions" role="group" aria-label={t('coachPage.vote.title')}>
                <button type="button" onClick={() => void submitVote('up')} disabled={busy} className="coach-vote-up">
                  <ThumbsUp />
                  <strong>{t('coachPage.vote.up')}</strong>
                </button>
                <button type="button" onClick={() => void submitVote('down')} disabled={busy} className="coach-vote-down">
                  <ThumbsDown />
                  <strong>{t('coachPage.vote.down')}</strong>
                </button>
              </div>
            )}
            {error && <p className="coach-vote-error" role="alert">{t('coachPage.vote.error')}</p>}
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.42, delay: 0.18 }}
            className="coach-join-card"
          >
            <div className="coach-join-copy">
              <span>{t('coachPage.join.eyebrow')}</span>
              <h2>{t('coachPage.join.title')}</h2>
              <p>{t('coachPage.join.body')}</p>
            </div>
            <div className="coach-mail-link" aria-label={`${t('coachPage.join.cta')}：${CONTACT_EMAIL}`}>
              <span>{t('coachPage.join.cta')}</span>
              <small>{CONTACT_EMAIL}</small>
              <ArrowRight />
            </div>
          </motion.section>
        </div>
      </div>
    </div>
  )
}
