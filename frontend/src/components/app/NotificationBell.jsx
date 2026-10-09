import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, CheckCircle2, Trash2, XCircle, Zap } from 'lucide-react'
import { getBackendBaseUrl } from '../../lib/backendBase'
import { authenticatedFetch } from '../../lib/authenticatedFetch'

function formatTime(value, locale) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
}

function ExperienceReviewItem({ payload, t }) {
  const title = [payload.company, payload.position].filter(Boolean).join(' · ')
  const approved = payload.decision === 'approved'
  const takenDown = !approved && payload.previous_status === 'approved'
  const Icon = approved ? CheckCircle2 : XCircle

  return (
    <div className="flex gap-3">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${approved ? 'text-brand-success' : 'text-brand-danger'}`} />
      <div className="min-w-0 space-y-1">
        <p className="text-[13px] font-semibold leading-snug text-brand-ink">
          {approved
            ? t('notifications.experienceApproved', { title })
            : takenDown
              ? t('notifications.experienceTakenDown', { title })
              : t('notifications.experienceRejected', { title })}
        </p>
        {approved && payload.tokens_awarded > 0 && (
          <p className="inline-flex items-center gap-1 text-[12px] font-semibold text-brand-ink">
            <Zap className="h-3 w-3 fill-brand-ochre text-brand-ochre" />
            {t('notifications.tokensAwarded', { n: payload.tokens_awarded })}
          </p>
        )}
        {!approved && payload.note && (
          <p className="text-[12px] text-brand-muted">{t('notifications.reason', { note: payload.note })}</p>
        )}
        {!approved && <p className="text-[12px] text-brand-muted">{t('notifications.editHint')}</p>}
      </div>
    </div>
  )
}

function ExperienceDeletedItem({ payload, t }) {
  const title = [payload.company, payload.position].filter(Boolean).join(' · ')
  return (
    <div className="flex gap-3">
      <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-danger" />
      <p className="text-[13px] font-semibold leading-snug text-brand-ink">
        {t('notifications.experienceDeleted', { title })}
      </p>
    </div>
  )
}

/** 顶栏铃铛：面经审核结果等站内通知。打开即全部标为已读。 */
export default function NotificationBell() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const containerRef = useRef(null)
  const lastUnreadRef = useRef(0)

  const load = useCallback(async () => {
    try {
      const res = await authenticatedFetch(`${getBackendBaseUrl()}/api/notifications`)
      if (!res.ok) return
      const data = await res.json()
      setItems(data.notifications || [])
      setUnread(data.unreadCount || 0)
      // A newly approved post means the balance changed; let the token UI re-sync.
      if ((data.unreadCount || 0) > lastUnreadRef.current) window.dispatchEvent(new Event('tokensChanged'))
      lastUnreadRef.current = data.unreadCount || 0
    } catch {
      // Notifications are best-effort; never break the shell over them.
    }
  }, [])

  useEffect(() => { load() }, [load, location.pathname])

  useEffect(() => {
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  useEffect(() => {
    if (!open) return undefined
    const onClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && unread > 0) {
      setUnread(0)
      lastUnreadRef.current = 0
      try {
        await authenticatedFetch(`${getBackendBaseUrl()}/api/notifications/read`, { method: 'POST' })
      } catch { /* retried next time the panel opens */ }
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={t('notifications.title')}
        aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-xl text-brand-ink transition-colors hover:bg-white/50 dark:hover:bg-white/[0.06]"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand-danger px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="brand-float absolute right-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-[20px] border border-brand-line"
          >
            <p className="border-b border-brand-line px-4 py-3 text-[13px] font-bold text-brand-ink">{t('notifications.title')}</p>
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-[12.5px] text-brand-muted">{t('notifications.empty')}</p>
            ) : (
              <ul className="max-h-[60vh] divide-y divide-brand-line overflow-y-auto">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        if (n.type === 'experience_review') navigate('/experiences?mine=true')
                      }}
                      className={`w-full px-4 py-3 text-left transition-colors hover:bg-brand-inset ${n.read_at ? '' : 'bg-brand-ochre/[0.08]'}`}
                    >
                      {n.type === 'experience_review' && <ExperienceReviewItem payload={n.payload || {}} t={t} />}
                      {n.type === 'experience_deleted' && <ExperienceDeletedItem payload={n.payload || {}} t={t} />}
                      <p className="mt-1.5 pl-7 text-[11px] text-brand-muted">{formatTime(n.created_at, i18n.language)}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
