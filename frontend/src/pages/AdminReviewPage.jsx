import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Building2, CheckCircle2, Clock, Globe2, Layers,
  Loader2, MapPin, MessageSquareQuote, ShieldAlert, Trash2, XCircle, Zap,
} from 'lucide-react'
import { getBackendBaseUrl } from '../lib/backendBase'
import { authenticatedFetch } from '../lib/authenticatedFetch'
import { useAuth } from '../hooks/useAuth'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { roundSummary } from '../lib/experienceRounds'
import { experienceType } from '../lib/experienceTypes'
import './CommunityPages.css'

const TABS = ['pending', 'approved', 'rejected']

function formatDateTime(value, locale) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

function Meta({ icon: Icon, children }) {
  if (!children) return null
  return (
    <span className="flex items-center gap-1">
      <Icon className="h-3.5 w-3.5" />
      {children}
    </span>
  )
}

function ReviewCard({ exp, status, busy, onReview, onDelete, t, locale }) {
  // Rejecting asks for an optional reason first; it is sent to the author.
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  // Deleting is permanent, so it asks for confirmation inline.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const typeMeta = experienceType(exp.type)

  const actions = {
    pending: [
      { decision: 'approved', label: t('adminReview.approve'), tone: 'primary' },
      { decision: 'rejected', label: t('adminReview.reject'), tone: 'danger' },
    ],
    approved: [{ decision: 'rejected', label: t('adminReview.takeDown'), tone: 'danger' }],
    rejected: [{ decision: 'approved', label: t('adminReview.reapprove'), tone: 'primary' }],
  }[status]

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16 }}
      className="rounded-[22px] border border-brand-line bg-brand-card p-6 sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            {typeMeta && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-brand-line bg-brand-inset px-2.5 py-1 text-brand-ink">
                <typeMeta.icon className="h-3 w-3" />
                {t(typeMeta.labelKey)}
              </span>
            )}
            {roundSummary(exp.rounds) && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-brand-line bg-brand-inset px-2.5 py-1 text-brand-ink">
                <Layers className="h-3 w-3" />
                {roundSummary(exp.rounds)}
              </span>
            )}
            {exp.salary && (
              <span className="rounded-lg border border-brand-line bg-brand-card px-2.5 py-1 text-brand-ink">{exp.salary}</span>
            )}
            {exp.reward_granted && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-brand-success/30 bg-brand-success/[0.10] px-2.5 py-1 text-brand-success">
                <Zap className="h-3 w-3" />
                {t('adminReview.rewardGranted')}
              </span>
            )}
          </div>

          <div>
            <h3 className="font-brand text-[18px] font-semibold leading-tight tracking-[-0.01em] text-brand-ink">{exp.position}</h3>
            <p className="mt-1 text-[13.5px] font-bold text-brand-muted">{exp.company}</p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-brand-muted">
            <Meta icon={Building2}>{exp.department}</Meta>
            <Meta icon={MapPin}>{exp.location}</Meta>
            <Meta icon={Clock}>{exp.date}</Meta>
            <Meta icon={Globe2}>{exp.language}</Meta>
          </div>

          <p className="text-[12px] text-brand-muted">
            {t('adminReview.submittedBy')}: <span className="font-bold text-brand-ink">{exp.publisher || exp.user_id}</span>
            {' · '}
            {t('adminReview.submittedAt')}: {formatDateTime(exp.created_at, locale)}
            {exp.reviewed_at && <> · {t('adminReview.reviewedAt')}: {formatDateTime(exp.reviewed_at, locale)}</>}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {!rejecting && !confirmingDelete && actions.map(({ decision, label, tone }) => (
            <button
              key={decision}
              type="button"
              disabled={busy}
              onClick={() => (decision === 'rejected' ? setRejecting(true) : onReview(exp.id, decision))}
              className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-opacity disabled:opacity-50 ${
                tone === 'primary'
                  ? 'bg-brand-ink text-brand-on-ink hover:opacity-90'
                  : 'border border-brand-danger/30 text-brand-danger hover:bg-brand-danger/[0.08]'
              }`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : tone === 'primary' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {label}
            </button>
          ))}
          {!rejecting && !confirmingDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
              aria-label={t('adminReview.delete')}
              title={t('adminReview.delete')}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-brand-muted transition-colors hover:bg-brand-danger/[0.08] hover:text-brand-danger disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {t('adminReview.delete')}
            </button>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-danger/25 bg-brand-danger/[0.04] p-4">
          <p className="flex-1 text-[12.5px] font-bold text-brand-ink">{t('adminReview.confirmDeleteText')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(exp.id)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-danger px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t('adminReview.confirmDelete')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmingDelete(false)}
            className="rounded-xl px-4 py-2.5 text-[13px] font-semibold text-brand-muted transition-colors hover:bg-brand-inset"
          >
            {t('adminReview.cancel')}
          </button>
        </div>
      )}

      {exp.review_note && !rejecting && (
        <p className="mt-4 rounded-xl border border-brand-danger/25 bg-brand-danger/[0.06] px-4 py-2.5 text-[12.5px] text-brand-ink">
          <span className="font-bold text-brand-danger">{t('exp.rejectReason')}</span>
          {exp.review_note}
        </p>
      )}

      {rejecting && (
        <div className="mt-5 space-y-3 rounded-2xl border border-brand-danger/25 bg-brand-danger/[0.04] p-4">
          <label htmlFor={`reject-note-${exp.id}`} className="block text-[12.5px] font-bold text-brand-ink">
            {t('adminReview.rejectNoteLabel')}
          </label>
          <textarea
            id={`reject-note-${exp.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t('adminReview.rejectNotePlaceholder')}
            className="w-full rounded-xl border border-brand-line bg-brand-card px-4 py-3 text-[13px] text-brand-ink placeholder:text-brand-muted/70 focus:border-brand-ink focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onReview(exp.id, 'rejected', note)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-danger px-4 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              {t('adminReview.confirmReject')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setRejecting(false); setNote('') }}
              className="rounded-xl px-4 py-2.5 text-[13px] font-semibold text-brand-muted transition-colors hover:bg-brand-inset"
            >
              {t('adminReview.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-6 border-t border-brand-line pt-6">
        {exp.rounds?.length ? exp.rounds.map((round, ri) => (
          <div key={ri} className="space-y-3">
            {/* Single-round posts show the round as a badge above. */}
            {exp.rounds.length > 1 && (
              <div className="flex items-center gap-3">
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-ink text-[12px] font-semibold text-brand-on-ink">
                  {round.round ?? ri + 1}
                </span>
                <h4 className="text-[13.5px] font-semibold text-brand-ink">{round.format}</h4>
                {round.duration_min && <span className="text-[11px] text-brand-muted">{round.duration_min} min</span>}
              </div>
            )}
            <div className={`space-y-2 ${exp.rounds.length > 1 ? 'pl-10' : ''}`}>
              {/* Keep the original index: answers[i] belongs to questions[i]. */}
              {(round.questions || []).map((q, qi) => ({ q, a: round.answers?.[qi], qi })).filter(({ q }) => q).map(({ q, a, qi }, n) => (
                <div key={qi} className="flex gap-3 rounded-xl border border-brand-line bg-brand-inset px-4 py-2.5">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-brand-line bg-brand-card text-[11px] font-semibold text-brand-ink">
                    {n + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-brand-ink">{q}</p>
                    {a && (
                      <div className="mt-2 border-l-2 border-brand-line pl-3">
                        <p className="text-[11px] font-bold text-brand-muted">{t('exp.authorAnswer')}</p>
                        <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-brand-ink">{a}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )) : (
          <p className="text-[12.5px] text-brand-muted">{t('adminReview.noRounds')}</p>
        )}

        {exp.reflection && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquareQuote className="h-4 w-4 text-brand-muted" />
              <p className="text-[12.5px] font-bold text-brand-ink">{t('exp.reflectionTitle')}</p>
            </div>
            <div className="rounded-2xl border border-brand-line bg-brand-inset p-5">
              <p className="whitespace-pre-line text-[13.5px] leading-[1.8] text-brand-ink">{exp.reflection}</p>
            </div>
          </div>
        )}
      </div>
    </motion.article>
  )
}

export default function AdminReviewPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const isAdmin = useIsAdmin(user)
  const [status, setStatus] = useState('pending')
  const [experiences, setExperiences] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    document.title = t('adminReview.title')
  }, [t])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await authenticatedFetch(`${getBackendBaseUrl()}/api/admin/experiences?status=${status}`)
      if (!res.ok) throw new Error(`Status ${res.status}`)
      const data = await res.json()
      setExperiences(data.experiences || [])
      setCounts(data.counts || {})
    } catch {
      setError(t('adminReview.loadError'))
    } finally {
      setLoading(false)
    }
  }, [status, t])

  useEffect(() => {
    if (isAdmin) load()
  }, [isAdmin, load])

  const handleDelete = async (id) => {
    setBusyId(id)
    try {
      const res = await authenticatedFetch(`${getBackendBaseUrl()}/api/admin/experiences/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Status ${res.status}`)
      }
      setExperiences(prev => prev.filter(e => e.id !== id))
      setCounts(prev => ({ ...prev, [status]: Math.max(0, (prev[status] || 0) - 1) }))
    } catch (err) {
      setError(t('adminReview.actionFailed', { message: err.message }))
    } finally {
      setBusyId(null)
    }
  }

  const handleReview = async (id, decision, note = '') => {
    setBusyId(id)
    try {
      const res = await authenticatedFetch(`${getBackendBaseUrl()}/api/admin/experiences/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Status ${res.status}`)
      }
      setExperiences(prev => prev.filter(e => e.id !== id))
      setCounts(prev => ({
        ...prev,
        [status]: Math.max(0, (prev[status] || 0) - 1),
        [decision]: (prev[decision] || 0) + 1,
      }))
    } catch (err) {
      setError(t('adminReview.actionFailed', { message: err.message }))
    } finally {
      setBusyId(null)
    }
  }

  if (isAdmin === null) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-brand-muted" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32 text-center">
        <ShieldAlert className="h-8 w-8 text-brand-muted" />
        <p className="text-[13.5px] font-bold text-brand-muted">{t('adminReview.forbidden')}</p>
      </div>
    )
  }

  const tabLabels = {
    pending: t('adminReview.tabPending'),
    approved: t('adminReview.tabApproved'),
    rejected: t('adminReview.tabRejected'),
  }

  return (
    <div className="community-page pb-16 pt-[calc(var(--ui-nav-h)+1.5rem)]">
      <div className="community-shell">
        <header className="mb-6">
          <h1 className="community-title">{t('adminReview.title')}</h1>
          <p className="community-subtitle">{t('adminReview.subtitle')}</p>
        </header>

        <div className="community-toolbar">
          <div className="community-filters" role="group">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatus(key)}
                aria-pressed={status === key}
                className={`community-filter ${status === key ? 'is-active' : ''}`}
              >
                {tabLabels[key]}
                <span className="community-filter-count">{counts[key] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="mb-4 rounded-2xl border border-brand-danger/30 bg-brand-danger/[0.06] p-4 text-[13px] font-bold text-brand-danger">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-brand-muted" />
            <span className="ml-3 text-[13px] font-bold text-brand-muted">{t('adminReview.loading')}</span>
          </div>
        ) : experiences.length === 0 ? (
          <div className="community-empty px-10 py-20 text-center">
            <p className="text-[13.5px] font-bold text-brand-muted">{t('adminReview.empty')}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <AnimatePresence mode="popLayout">
              {experiences.map((exp) => (
                <ReviewCard
                  key={exp.id}
                  exp={exp}
                  status={status}
                  busy={busyId === exp.id}
                  onReview={handleReview}
                  onDelete={handleDelete}
                  t={t}
                  locale={i18n.language}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
