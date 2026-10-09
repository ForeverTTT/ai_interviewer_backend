import { useState, useEffect, useMemo, useRef, forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { BRAND_ASSETS } from '../assets/brandAssets'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { getBackendBaseUrl } from '../lib/backendBase'
import { supabase } from '../lib/supabase'
import { authenticatedFetch } from '../lib/authenticatedFetch'
import { roundSummary } from '../lib/experienceRounds'
import { EXPERIENCE_TYPES, experienceType } from '../lib/experienceTypes'
import { useAuth } from '../hooks/useAuth'
import FilterSelect from '../components/FilterSelect'
import './CommunityPages.css'
import {
  Search, Building2, MapPin,
  Clock, ChevronDown, ChevronUp, MessageSquareQuote,
  Globe2, Loader2,
  Trash2, Plus, X, Send, Zap, AlertTriangle, Lock, Library, Pencil, Layers
} from 'lucide-react'

const COMMUNITY_EGG = BRAND_ASSETS.communityAvatar

function TypeBadge({ type, t }) {
  const meta = experienceType(type)
  if (!meta) return null
  const Icon = meta.icon
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-brand-line bg-brand-inset px-2.5 py-1 text-[11px] font-bold text-brand-ink">
      <Icon className="w-3 h-3" />
      {t(meta.labelKey)}
    </span>
  )
}

function RoundBadge({ rounds }) {
  const summary = roundSummary(rounds)
  if (!summary) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border border-brand-line bg-brand-inset px-2.5 py-1 text-[11px] font-bold text-brand-ink">
      <Layers className="w-3 h-3" />
      {summary}
    </span>
  )
}

const REVIEW_STATUS_STYLES = {
  pending: 'border-brand-ochre/40 bg-brand-ochre/[0.10] text-brand-ink',
  approved: 'border-brand-success/30 bg-brand-success/[0.10] text-brand-success',
  rejected: 'border-brand-danger/30 bg-brand-danger/[0.08] text-brand-danger',
}

function ReviewStatusBadge({ exp, t }) {
  if (exp.visibility !== 'public') {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-brand-line bg-brand-inset px-2.5 py-1 text-[11px] font-bold text-brand-muted">
        <Lock className="w-3 h-3" />
        {t('exp.statusPrivate')}
      </span>
    )
  }
  const style = REVIEW_STATUS_STYLES[exp.review_status]
  if (!style) return null
  const label = {
    pending: t('exp.statusPending'),
    approved: t('exp.statusApproved'),
    rejected: t('exp.statusRejected'),
  }[exp.review_status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-bold ${style}`}>
      <Library className="w-3 h-3" />
      {label}
    </span>
  )
}

function CustomDropdown({ label, value, options, onChange, t }) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedOption = options.find(o => o.value === value)

  return (
    <div className="relative" ref={containerRef}>
      <label className="mb-2 ml-1 block text-[12.5px] font-bold text-brand-ink">{label}</label>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={`flex h-[54px] w-full items-center justify-between rounded-xl border bg-brand-inset px-5 text-[13.5px] font-bold transition-colors ${isOpen ? 'border-brand-ink ring-1 ring-brand-ink' : 'border-brand-line hover:border-brand-muted/40'
          }`}
      >
        <div className="flex items-center gap-3">
          {selectedOption?.icon && <selectedOption.icon className="h-4 w-4 text-brand-muted" />}
          <span className="text-brand-ink">{selectedOption?.label || t('exp.selectPlaceholder')}</span>
        </div>
        <ChevronDown className={`h-4 w-4 text-brand-muted transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="brand-float absolute z-[100] mt-2 w-full overflow-hidden rounded-[20px] border border-brand-line p-2"
          >
            {options.map((opt) => {
              const Icon = opt.icon
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value)
                    setIsOpen(false)
                  }}
                  className={`group relative flex w-full items-center gap-3 rounded-xl px-4 py-3 text-[13px] font-bold transition-colors ${
                    value === opt.value
                      ? 'bg-brand-ink text-brand-on-ink'
                      : 'text-brand-muted hover:bg-brand-inset hover:text-brand-ink'
                  }`}
                >
                  <div className={`rounded-lg p-1.5 transition-colors ${
                    value === opt.value
                      ? 'bg-brand-on-ink/15'
                      : 'bg-brand-inset group-hover:bg-brand-card'
                  }`}>
                    {Icon && <Icon className={`h-3.5 w-3.5 ${value === opt.value ? 'text-current' : 'text-brand-muted group-hover:text-brand-ink'}`} />}
                  </div>
                  <span className="flex-1 text-left">{opt.label}</span>
                  {value === opt.value && (
                    <motion.div layoutId="activeOption" className="absolute right-4 w-1.5 h-1.5 rounded-full bg-current" />
                  )}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DeleteConfirmModal({ isOpen, onClose, onConfirm, rewardGranted }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-brand-ink/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        transition={{ type: 'spring', duration: 0.35, bounce: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="brand-float relative w-full max-w-sm overflow-hidden rounded-[22px] border border-brand-line"
      >
        <div className="flex flex-col items-center px-8 pt-8 pb-6 text-center">
          <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-brand-danger/25 bg-brand-danger/[0.08]">
            <AlertTriangle className="h-7 w-7 text-brand-danger" />
          </div>
          <h3 className="font-brand text-[17px] font-semibold tracking-[-0.01em] text-brand-ink">
            确定要删除这条面经吗？
          </h3>
          {rewardGranted && (
            <p className="mt-2.5 flex items-center gap-1.5 text-[13px] text-brand-muted">
              删除后能量值
              <span className="inline-flex items-center gap-0.5 font-semibold text-brand-danger">
                <Zap className="w-3.5 h-3.5" />-200
              </span>
            </p>
          )}
        </div>
        <div className="flex border-t border-brand-line">
          <button
            onClick={onClose}
            className="flex-1 py-4 text-[13px] font-bold text-brand-muted transition-colors hover:bg-brand-inset"
          >
            取消
          </button>
          <div className="w-px bg-brand-line" />
          <button
            onClick={onConfirm}
            className="flex-1 py-4 text-[13px] font-semibold text-brand-danger transition-colors hover:bg-brand-danger/[0.08]"
          >
            删除
          </button>
        </div>
      </motion.div>
    </div>
  )
}

const ExperienceCard = forwardRef(function ExperienceCard({ exp, t, user, onDelete, onSubmitToLibrary, onEdit }, ref) {
  const [expanded, setExpanded] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const isOwner = user && exp.user_id === user.id
  // Published posts can only be removed by an admin.
  const canDelete = isOwner && exp.review_status !== 'approved'

  const handleSubmitToLibrary = async () => {
    setSubmitting(true)
    setSubmitError('')
    try {
      await onSubmitToLibrary(exp.id)
    } catch {
      setSubmitError(t('exp.submitToLibraryFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`experience-card group relative overflow-hidden ${expanded ? 'experience-card--expanded' : ''}`}
    >
      {canDelete && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowDeleteConfirm(true)
            }}
            className="absolute right-16 top-6 z-10 rounded-xl p-2 text-brand-muted opacity-0 transition-colors hover:bg-brand-danger/[0.08] hover:text-brand-danger group-hover:opacity-100"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <AnimatePresence>
            {showDeleteConfirm && (
              <DeleteConfirmModal
                isOpen={showDeleteConfirm}
                rewardGranted={exp.reward_granted}
                onClose={() => setShowDeleteConfirm(false)}
                onConfirm={() => {
                  setShowDeleteConfirm(false)
                  onDelete(exp.id)
                }}
              />
            )}
          </AnimatePresence>
        </>
      )}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full p-6 text-left sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <TypeBadge type={exp.type} t={t} />
              <RoundBadge rounds={exp.rounds} />
              {isOwner && <ReviewStatusBadge exp={exp} t={t} />}
              {exp.salary && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-brand-card px-2.5 py-1 text-[11px] font-bold text-brand-ink">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-ink" aria-hidden="true" />
                  {exp.salary}
                </span>
              )}
            </div>

            <div>
              <h3 className="font-brand text-[17px] font-semibold leading-tight tracking-[-0.01em] text-brand-ink sm:text-[19px]">
                {exp.position}
              </h3>
              <p className="mt-1 text-[13.5px] font-bold text-brand-muted">
                {exp.company}
              </p>
            </div>

            <div className="experience-author">
              <img src={COMMUNITY_EGG} alt="" aria-hidden="true" />
              <span>{isOwner ? '我发布的面经' : (exp.publisher || '匿名荷包蛋')}</span>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-brand-muted">
              {exp.department && (
                <span className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" />
                  {exp.department}
                </span>
              )}
              <span className="flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5" />
                {exp.location}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {exp.date}
              </span>
              <span className="flex items-center gap-1">
                <Globe2 className="w-3.5 h-3.5" />
                {exp.language}
              </span>
            </div>
          </div>

          <div className="shrink-0 mt-1">
            <div className={`grid h-8 w-8 place-items-center rounded-xl transition-colors duration-300 ${
              expanded
                ? 'bg-brand-ink text-brand-on-ink'
                : 'bg-brand-inset text-brand-muted'
            }`}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </div>
      </button>

      {isOwner && exp.visibility === 'private' && (
        <div className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 px-6 pb-5 sm:px-7">
          <button
            type="button"
            onClick={handleSubmitToLibrary}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink px-3 py-1.5 text-[12px] font-bold text-brand-on-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Library className="h-3.5 w-3.5" />}
            {t('exp.submitToLibrary')}
          </button>
          <button
            type="button"
            onClick={() => onEdit(exp)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-brand-line px-3 py-1.5 text-[12px] font-bold text-brand-ink transition-colors hover:bg-brand-inset"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('exp.edit')}
          </button>
          <span className="text-[11.5px] text-brand-muted">{t('exp.submitToLibraryHint')}</span>
          {submitError && <span className="w-full text-[12px] font-bold text-brand-danger">{submitError}</span>}
        </div>
      )}

      {isOwner && exp.visibility === 'public' && exp.review_status === 'rejected' && (
        <div className="-mt-2 space-y-3 px-6 pb-5 sm:px-7">
          {exp.review_note && (
            <p className="rounded-xl border border-brand-danger/25 bg-brand-danger/[0.06] px-4 py-2.5 text-[12.5px] text-brand-ink">
              <span className="font-bold text-brand-danger">{t('exp.rejectReason')}</span>
              {exp.review_note}
            </p>
          )}
          <button
            type="button"
            onClick={() => onEdit(exp)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-ink px-3 py-1.5 text-[12px] font-bold text-brand-on-ink transition-opacity hover:opacity-90"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('exp.editAndResubmit')}
          </button>
        </div>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-6 sm:px-8 pb-8 space-y-8">
              <div className="h-px bg-brand-line" />

              {exp.rounds?.map((round, ri) => (
                <div key={ri} className="space-y-4">
                  {/* Single-round posts show the round as a badge in the header instead. */}
                  {exp.rounds.length > 1 && (
                    <div className="flex items-center gap-3">
                      <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-ink text-[12px] font-semibold text-brand-on-ink">
                        {round.round}
                      </span>
                      <div>
                        <h4 className="text-[13.5px] font-semibold text-brand-ink">
                          {round.format}
                        </h4>
                        {round.duration_min && (
                          <span className="text-[11px] text-brand-muted">
                            {round.duration_min} min
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className={`space-y-2 ${exp.rounds.length > 1 ? 'pl-10' : ''}`}>
                    <p className="mb-2 text-[12.5px] font-bold text-brand-ink">
                      {t('exp.questionsTitle')}
                    </p>
                    {round.questions.map((q, qi) => (
                      <div
                        key={qi}
                        className="flex gap-3 rounded-xl border border-brand-line bg-brand-inset px-4 py-2.5"
                      >
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-brand-line bg-brand-card text-[11px] font-semibold text-brand-ink">
                          {qi + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13.5px] leading-relaxed text-brand-ink">
                            {q}
                          </p>
                          {round.answers?.[qi] && (
                            <div className="mt-2 border-l-2 border-brand-line pl-3">
                              <p className="text-[11px] font-bold text-brand-muted">
                                {isOwner ? t('exp.myAnswer') : t('exp.authorAnswer')}
                              </p>
                              <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-brand-ink">
                                {round.answers[qi]}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {exp.reflection && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <MessageSquareQuote className="h-4 w-4 text-brand-muted" />
                    <p className="text-[12.5px] font-bold text-brand-ink">
                      {t('exp.reflectionTitle')}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-brand-line bg-brand-inset p-5">
                    <p className="whitespace-pre-line text-[13.5px] leading-[1.8] text-brand-ink">
                      {exp.reflection}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})

// A post now describes a single round. Older multi-round posts are merged into one
// when edited so no question or answer is lost (answers stay aligned by index).
function singleRound(rounds) {
  const list = Array.isArray(rounds) && rounds.length ? rounds : [{}]
  const questions = []
  const answers = []
  for (const r of list) {
    (r.questions || []).forEach((q, i) => {
      questions.push(q)
      answers.push(r.answers?.[i] || '')
    })
  }
  return {
    round: 1,
    format: list.map(r => r.format).filter(Boolean).join(' / '),
    duration_min: list[0].duration_min ?? 30,
    questions: questions.length ? questions : [''],
    answers,
  }
}

function PostModal({ isOpen, onClose, t, onPost, user, initial = null }) {
  // Edit mode: start from the existing post. Rounds are deep-copied because the
  // handlers below mutate question arrays in place. A rejected post is being
  // fixed for resubmission, so it stays pointed at the library.
  const [formData, setFormData] = useState(() => initial ? {
    // Legacy types ('work' / 'school') are not selectable; fall back to the first type.
    type: EXPERIENCE_TYPES.some(type => type.value === initial.type) ? initial.type : EXPERIENCE_TYPES[0].value,
    company: initial.company || '',
    position: initial.position || '',
    location: initial.location || '',
    department: initial.department || '',
    date: initial.date || new Date().toISOString().slice(0, 7),
    language: initial.language || '',
    salary: initial.salary || '',
    reflection: initial.reflection || '',
    visibility: initial.visibility === 'public' ? 'public' : 'private',
    rounds: [singleRound(initial.rounds)],
  } : {
    type: EXPERIENCE_TYPES[0].value,
    company: '',
    position: '',
    location: '',
    department: '',
    date: new Date().toISOString().slice(0, 7),
    language: 'English',
    salary: '',
    reflection: '',
    visibility: 'public',
    rounds: [{ round: 1, format: '', duration_min: 30, questions: [''] }]
  })
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')

  if (!isOpen) return null

  // One post = one interview round, stored as rounds[0].
  const round = formData.rounds[0]

  const updateRound = (i, field, value) => {
    const nr = [...formData.rounds]
    nr[i] = { ...nr[i], [field]: value }
    setFormData({ ...formData, rounds: nr })
  }

  const addQuestion = (ri) => {
    const nr = [...formData.rounds]
    nr[ri].questions.push('')
    setFormData({ ...formData, rounds: nr })
  }

  const updateQuestion = (ri, qi, val) => {
    const nr = [...formData.rounds]
    nr[ri].questions[qi] = val
    setFormData({ ...formData, rounds: nr })
  }

  // answers[qi] is the (optional) answer to questions[qi]
  const updateAnswer = (ri, qi, val) => {
    const nr = [...formData.rounds]
    const answers = [...(nr[ri].answers || [])]
    answers[qi] = val
    nr[ri] = { ...nr[ri], answers: Array.from(answers, a => a || '') }
    setFormData({ ...formData, rounds: nr })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setSubmitError('')
    try {
      await onPost(formData)
      onClose()
    } catch (err) {
      setSubmitError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:pt-24">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-brand-ink/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="custom-scrollbar brand-float relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[22px] border border-brand-line"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-line bg-brand-card/85 px-8 py-6 backdrop-blur-md">
          <div>
            <h2 className="font-brand text-[21px] font-semibold tracking-[-0.01em] text-brand-ink">{initial ? t('exp.editTitle') : t('exp.postTitle')}</h2>
            <p className="mt-1 text-[12.5px] text-brand-muted">{initial?.review_note ? `${t('exp.rejectReason')}${initial.review_note}` : t('exp.postSubtitle')}</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 transition-colors hover:bg-brand-inset">
            <X className="h-5 w-5 text-brand-muted" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8">
          <div>
            <p className="mb-2 ml-1 text-[12.5px] font-bold text-brand-ink">{t('exp.visibilityLabel')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('exp.visibilityLabel')}>
              {[
                { value: 'private', icon: Lock, label: t('exp.visibilityPrivate'), desc: t('exp.visibilityPrivateDesc') },
                { value: 'public', icon: Library, label: t('exp.visibilityPublic'), desc: t('exp.visibilityPublicDesc') },
              ].map(({ value, icon: Icon, label, desc }) => {
                const active = formData.visibility === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setFormData({ ...formData, visibility: value })}
                    className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
                      active ? 'border-brand-ink bg-brand-inset ring-1 ring-brand-ink' : 'border-brand-line hover:border-brand-muted/40'
                    }`}
                  >
                    <div className={`rounded-xl p-2 ${active ? 'bg-brand-ink text-brand-on-ink' : 'border border-brand-line bg-brand-inset text-brand-muted'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[13.5px] font-semibold text-brand-ink">{label}</span>
                      <span className="mt-0.5 text-[11.5px] leading-snug text-brand-muted">{desc}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <CustomDropdown
            label={t('exp.labelType')}
            value={formData.type}
            onChange={val => setFormData({...formData, type: val})}
            t={t}
            options={EXPERIENCE_TYPES.map(type => ({ value: type.value, label: t(type.labelKey), icon: type.icon }))}
          />

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <input
                required
                value={formData.company}
                onChange={e => setFormData({...formData, company: e.target.value})}
                placeholder={t('exp.postCompany')}
                className="w-full rounded-xl border border-brand-line bg-brand-inset px-5 py-3.5 text-[13.5px] font-bold text-brand-ink transition-colors placeholder:text-brand-muted/70 focus:border-brand-ink focus:outline-none"
              />
              <input
                required
                value={formData.position}
                onChange={e => setFormData({...formData, position: e.target.value})}
                placeholder={t('exp.postPosition')}
                className="w-full rounded-xl border border-brand-line bg-brand-inset px-5 py-3.5 text-[13.5px] font-bold text-brand-ink transition-colors placeholder:text-brand-muted/70 focus:border-brand-ink focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <input
                value={formData.location}
                onChange={e => setFormData({...formData, location: e.target.value})}
                placeholder={t('exp.postLocation')}
                className="w-full rounded-xl border border-brand-line bg-brand-inset px-5 py-3.5 text-[13.5px] font-bold text-brand-ink transition-colors placeholder:text-brand-muted/70 focus:border-brand-ink focus:outline-none"
              />
              <input
                value={formData.department}
                onChange={e => setFormData({...formData, department: e.target.value})}
                placeholder={t('exp.postDepartment')}
                className="w-full rounded-xl border border-brand-line bg-brand-inset px-5 py-3.5 text-[13.5px] font-bold text-brand-ink transition-colors placeholder:text-brand-muted/70 focus:border-brand-ink focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-[2fr_1fr] gap-4">
              <label className="flex w-full items-center gap-3 rounded-xl border border-brand-line bg-brand-inset px-5 transition-colors focus-within:border-brand-ink">
                <span className="shrink-0 text-[13px] font-bold text-brand-muted">{t('exp.labelRounds')}</span>
                <input
                  value={round.format}
                  onChange={e => updateRound(0, 'format', e.target.value)}
                  placeholder={t('exp.phRoundsFormat')}
                  className="min-w-0 flex-1 bg-transparent py-3.5 text-[13.5px] font-bold text-brand-ink placeholder:text-brand-muted/70 focus:outline-none"
                />
              </label>
              <input
                type="number"
                min="0"
                value={round.duration_min ?? ''}
                onChange={e => updateRound(0, 'duration_min', e.target.value === '' ? null : parseInt(e.target.value))}
                placeholder={t('exp.phRoundsDuration')}
                className="w-full rounded-xl border border-brand-line bg-brand-inset px-5 py-3.5 text-[13.5px] font-bold text-brand-ink transition-colors placeholder:text-brand-muted/70 focus:border-brand-ink focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <input
              type="month"
              value={formData.date}
              onChange={e => setFormData({...formData, date: e.target.value})}
              className="w-full rounded-xl border border-brand-line bg-brand-inset px-5 py-3.5 text-[12.5px] font-bold text-brand-ink transition-colors focus:border-brand-ink focus:outline-none"
            />
            <input
              value={formData.language}
              onChange={e => setFormData({...formData, language: e.target.value})}
              placeholder="English / German / Chinese"
              className="w-full rounded-xl border border-brand-line bg-brand-inset px-5 py-3.5 text-[13.5px] font-bold text-brand-ink transition-colors placeholder:text-brand-muted/70 focus:border-brand-ink focus:outline-none"
            />
            <input
              value={formData.salary}
              onChange={e => setFormData({...formData, salary: e.target.value})}
              placeholder="e.g. 16€/h"
              className="w-full rounded-xl border border-brand-line bg-brand-inset px-5 py-3.5 text-[13.5px] font-bold text-brand-ink transition-colors placeholder:text-brand-muted/70 focus:border-brand-ink focus:outline-none"
            />
          </div>

          <div className="space-y-3">
            <h4 className="ml-1 text-[12.5px] font-bold text-brand-ink">{t('exp.questionsTitle')}</h4>
            {round.questions.map((q, qi) => (
              <div key={qi} className="space-y-2">
                <input
                  value={q}
                  onChange={e => updateQuestion(0, qi, e.target.value)}
                  placeholder={`${t('exp.phRoundsQuestion')} ${qi + 1}`}
                  className="w-full rounded-xl border border-brand-line bg-brand-inset px-4 py-3 text-[12.5px] font-bold text-brand-ink placeholder:text-brand-muted/70"
                />
                <textarea
                  value={round.answers?.[qi] || ''}
                  onChange={e => updateAnswer(0, qi, e.target.value)}
                  placeholder={t('exp.phAnswer')}
                  rows={2}
                  className="w-full rounded-xl border border-dashed border-brand-line bg-brand-card px-4 py-2.5 text-[12.5px] text-brand-ink placeholder:text-brand-muted/70 focus:border-brand-ink focus:outline-none"
                />
              </div>
            ))}
            <button type="button" onClick={() => addQuestion(0)} className="text-[12px] font-semibold text-brand-ink hover:underline">+ {t('exp.btnPulseQuestion')}</button>
          </div>

          <div className="space-y-2">
             <label className="ml-1 text-[12.5px] font-bold text-brand-ink">{t('exp.labelReflection')}</label>
             <textarea
               value={formData.reflection}
               onChange={e => setFormData({...formData, reflection: e.target.value})}
               className="min-h-[150px] w-full rounded-[20px] border border-brand-line bg-brand-inset px-5 py-4 text-[13.5px] font-medium text-brand-ink transition-colors placeholder:text-brand-muted/70 focus:border-brand-ink focus:outline-none"
               placeholder="Share your thoughts, tips, and experience..."
             />
          </div>

          <AnimatePresence>
            {submitError && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-start gap-3 rounded-2xl border border-brand-danger/30 bg-brand-danger/[0.06] p-4"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand-danger" />
                <div className="flex-1">
                  <p className="text-[13px] font-bold text-brand-danger">{submitError}</p>
                </div>
                <button type="button" onClick={() => setSubmitError('')} className="rounded-lg p-0.5 transition-colors hover:bg-brand-danger/10">
                  <X className="h-3.5 w-3.5 text-brand-danger" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-brand-ink py-4 text-[15px] font-semibold text-brand-on-ink transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {formData.visibility === 'public'
              ? (initial?.review_status === 'rejected' ? t('exp.resubmit') : t('exp.submitPublic'))
              : t('exp.submitPrivate')}
          </button>
        </form>
      </motion.div>
    </div>
  )
}

export default function ExperiencesPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [experiences, setExperiences] = useState([])
  const [myExperiences, setMyExperiences] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState(searchParams.get('mine') === 'true' ? 'mine' : 'all')
  // 求职信息页「看面经」会带 ?q=公司名 跳过来
  const [search, setSearch] = useState(searchParams.get('q') || '')
  // 企业分类 / 岗位类别：后端按公司名、岗位名算好的 industry_keys / job_functions
  const [industryFilter, setIndustryFilter] = useState([])
  const [functionFilter, setFunctionFilter] = useState([])
  const [postModalOpen, setPostModalOpen] = useState(false)
  const [editingExp, setEditingExp] = useState(null)

  // Sync filter with URL parameter if it changes from Navbar
  useEffect(() => {
    if (searchParams.get('mine') === 'true') {
      setFilter('mine')
    } else {
      setFilter(prev => prev === 'mine' ? 'all' : prev)
    }
  }, [searchParams])

  useEffect(() => {
    document.title = filter === 'mine' ? t('nav.myExperiences') : t('meta.title')
  }, [t, filter])

  // The library only returns approved public posts; the author's own private /
  // pending / rejected posts come from /mine.
  const fetchMyExperiences = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      setMyExperiences([])
      return
    }
    const res = await fetch(`${getBackendBaseUrl()}/api/experiences/mine`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
    if (!res.ok) throw new Error('Failed')
    const data = await res.json()
    setMyExperiences(data.experiences || [])
  }

  const fetchExperiences = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${getBackendBaseUrl()}/api/experiences`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setExperiences(data.experiences || [])
      await fetchMyExperiences()
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchExperiences()
  }, [user?.id])

  // editingId: save changes to an existing private / rejected post instead of creating one.
  const handlePost = async (formData, editingId = null) => {
    const backendUrl = getBackendBaseUrl()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('No valid session found. Please log in again.')

    // SECURITY: Sanitize all string inputs on the frontend before sending to the backend (prevent injection/XSS)
    const sanitize = (str) => typeof str === 'string' ? str.replace(/<[^>]*>?/gm, '').trim() : str;

    const sanitizedData = {
      ...formData,
      company: sanitize(formData.company),
      location: sanitize(formData.location),
      position: sanitize(formData.position),
      department: sanitize(formData.department),
      reflection: sanitize(formData.reflection),
      salary: sanitize(formData.salary),
      rounds: (formData.rounds || []).map(r => ({
        ...r,
        format: sanitize(r.format),
        questions: (r.questions || []).map(sanitize),
        // Keep answers index-aligned with questions; empty string = no answer.
        answers: (r.questions || []).map((_, i) => sanitize(r.answers?.[i] || ''))
      }))
    }

    const res = await fetch(`${backendUrl}/api/experiences${editingId ? `/${editingId}` : ''}`, {
      method: editingId ? 'PUT' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(sanitizedData)
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      throw new Error(errBody.error || `Server returned ${res.status}: ${res.statusText}`)
    }

    // Refresh and show the new post (with its review status) under 我的面经
    await fetchExperiences()
    setFilter('mine')
  }

  const handleSubmitToLibrary = async (id) => {
    const res = await authenticatedFetch(`${getBackendBaseUrl()}/api/experiences/${id}/submit`, { method: 'POST' })
    if (!res.ok) throw new Error(`Submit failed with status ${res.status}`)
    const updated = await res.json()
    setMyExperiences(prev => prev.map(e => (e.id === id ? updated : e)))
  }

  const handleDelete = async (id) => {
    try {
      const backendUrl = getBackendBaseUrl()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return

      const res = await fetch(`${backendUrl}/api/experiences/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` }
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || `Delete failed with status ${res.status}`)
      }

      setExperiences(prev => prev.filter(e => e.id !== id))
      setMyExperiences(prev => prev.filter(e => e.id !== id))
      // Let Navbar / other token UI re-sync immediately after server-side -200.
      window.dispatchEvent(new Event('tokensChanged'))
    } catch (err) {
      alert(`Delete Error: ${err.message}`)
    }
  }

  // 类型标签（全部 / 实习 …）筛完的列表，下拉框的数量按它算
  const typeFiltered = useMemo(() => {
    const list = filter === 'mine' ? myExperiences : experiences
    if (EXPERIENCE_TYPES.some(type => type.value === filter)) {
      return list.filter(e => experienceType(e.type)?.value === filter)
    }
    return list
  }, [experiences, myExperiences, filter])

  const tagOptions = useMemo(() => {
    const count = (field) => {
      const counts = new Map()
      for (const e of typeFiltered) {
        for (const key of e[field] || []) counts.set(key, (counts.get(key) || 0) + 1)
      }
      // 「其他」放最后，其余按数量
      return [...counts.entries()]
        .map(([value, n]) => ({ value, count: n }))
        .sort((a, b) => (a.value === 'other') - (b.value === 'other') || b.count - a.count)
    }
    return { industries: count('industry_keys'), functions: count('job_functions') }
  }, [typeFiltered])

  const filtered = useMemo(() => {
    let list = typeFiltered
    // 同一个下拉框里多选是「任一满足」，两个下拉框之间是「同时满足」
    if (industryFilter.length) list = list.filter(e => e.industry_keys?.some(k => industryFilter.includes(k)))
    if (functionFilter.length) list = list.filter(e => e.job_functions?.some(k => functionFilter.includes(k)))

    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(e => {
        const company = (e.company || '').toLowerCase()
        const position = (e.position || '').toLowerCase()
        const dept = (e.department || '').toLowerCase()
        const loc = (e.location || '').toLowerCase()
        const refl = (e.reflection || '').toLowerCase()

        const inRounds = e.rounds?.some(r => {
          const format = (r.format || '').toLowerCase()
          const questions = r.questions?.some(qu => (qu || '').toLowerCase().includes(q))
          const answers = r.answers?.some(a => (a || '').toLowerCase().includes(q))
          return format.includes(q) || questions || answers
        })

        return company.includes(q) ||
               position.includes(q) ||
               dept.includes(q) ||
               loc.includes(q) ||
               refl.includes(q) ||
               inRounds
      })
    }
    return list
  }, [typeFiltered, industryFilter, functionFilter, search])

  const stats = useMemo(() => {
    const byType = Object.fromEntries(EXPERIENCE_TYPES.map(type => [
      type.value,
      experiences.filter(e => experienceType(e.type)?.value === type.value).length,
    ]))
    return { total: experiences.length, byType, mine: myExperiences.length }
  }, [experiences, myExperiences])

  const filterTabs = [
    { key: 'all', label: t('exp.filterAll'), count: stats.total },
    ...EXPERIENCE_TYPES.map(type => ({ key: type.value, label: t(type.labelKey), count: stats.byType[type.value] })),
  ]

  if (user) {
    filterTabs.push({ key: 'mine', label: t('exp.filterMine'), count: stats.mine })
  }

  return (
    <div className="community-page pb-16 pt-[calc(var(--ui-nav-h)+1.5rem)]">
      <div className="community-shell">
        <section className="community-hero">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="community-hero-copy"
          >
            <h1 className="community-title">{filter === 'mine' ? '我的面经' : t('exp.title')}</h1>
            <p className="community-subtitle">
              {filter === 'mine' ? '整理你分享过的面试经历。' : '看看其他人的真实面试经历，也把自己的经验留给下一位求职者。'}
            </p>
            {user && (
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <button onClick={() => setPostModalOpen(true)} className="lk-btn lk-btn-ghost">
                  <Plus className="h-4 w-4" />
                  {t('exp.postBtn')}
                </button>
                <span className="inline-flex items-center gap-1.5 text-[12px] text-brand-muted">
                  <Zap className="h-3.5 w-3.5 text-brand-ochre" />
                  {t('exp.rewardBadge')}
                </span>
              </div>
            )}
          </motion.div>

          <div className="community-egg-stage" aria-hidden="true">
            {filter === 'mine' ? (
              <img className="community-egg" src={COMMUNITY_EGG} alt="" />
            ) : (
              <div className="community-egg-group">
                <img className="community-egg" src={COMMUNITY_EGG} alt="" />
                <img className="community-egg" src={COMMUNITY_EGG} alt="" />
                <img className="community-egg" src={COMMUNITY_EGG} alt="" />
              </div>
            )}
          </div>
        </section>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-brand-muted" />
            <span className="ml-3 text-[13px] font-bold text-brand-muted">{t('exp.loading')}</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-32">
            <p className="text-[13px] font-bold text-brand-danger">{t('exp.error')}</p>
          </div>
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="community-toolbar"
            >
                <div className="community-search">
                  <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('exp.searchPlaceholder')}
                  />
                </div>

                <div className="community-filters" role="group">
                  {filterTabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => {
                        setFilter(tab.key)
                        // Optionally clear URL param
                        if (searchParams.get('mine')) {
                          setSearchParams({})
                        }
                      }}
                      aria-pressed={filter === tab.key}
                      className={`community-filter ${filter === tab.key ? 'is-active' : ''}`}
                    >
                      {tab.label}
                      <span className="community-filter-count">
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>
            </motion.div>

            {(tagOptions.industries.length > 0 || tagOptions.functions.length > 0) && (
              <div className="mb-6 flex flex-wrap items-end gap-3">
                <FilterSelect
                  label={t('taxonomy.industryLabel')}
                  values={industryFilter}
                  onChange={setIndustryFilter}
                  options={tagOptions.industries}
                  allLabel={t('taxonomy.any')}
                  formatLabel={v => t(`taxonomy.ind.${v}`, v)}
                />
                <FilterSelect
                  label={t('taxonomy.functionLabel')}
                  values={functionFilter}
                  onChange={setFunctionFilter}
                  options={tagOptions.functions}
                  allLabel={t('taxonomy.any')}
                  formatLabel={v => t(`taxonomy.fn.${v}`, v)}
                />
                <span className="mb-3 ml-auto text-[12.5px] font-semibold text-brand-muted">
                  {t('jobs.resultCount', { n: filtered.length })}
                </span>
              </div>
            )}

              <div className="experience-grid min-w-0">
                {filtered.length === 0 ? (
                  <div className="community-empty flex flex-col items-center justify-center space-y-4 px-10 py-20 text-center">
                    <p className="text-[13.5px] font-bold text-brand-muted">{filter === 'mine' ? t('exp.noMyResults') : t('exp.noResults')}</p>
                    {search && (
                       <button
                         onClick={() => setSearch('')}
                         className="text-[12.5px] font-bold text-brand-ink underline decoration-brand-line underline-offset-4 transition-colors hover:decoration-brand-ink"
                       >
                         Clear Search
                       </button>
                    )}
                  </div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="contents"
                  >
                    <AnimatePresence mode="popLayout">
                      {filtered.map((exp) => (
                        <ExperienceCard
                          key={exp.id}
                          exp={exp}
                          t={t}
                          user={user}
                          onDelete={handleDelete}
                          onSubmitToLibrary={handleSubmitToLibrary}
                          onEdit={setEditingExp}
                        />
                      ))}
                    </AnimatePresence>
                  </motion.div>
                )}
              </div>
            <AnimatePresence>
              {postModalOpen && (
                <PostModal
                  isOpen={postModalOpen}
                  onClose={() => setPostModalOpen(false)}
                  t={t}
                  onPost={handlePost}
                  user={user}
                />
              )}
              {editingExp && (
                <PostModal
                  key={editingExp.id}
                  isOpen
                  initial={editingExp}
                  onClose={() => setEditingExp(null)}
                  t={t}
                  onPost={(formData) => handlePost(formData, editingExp.id)}
                  user={user}
                />
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  )
}
