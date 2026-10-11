import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, MessageCircle, X } from 'lucide-react'
import './HelpFeedbackDialog.css'
import UserFeedbackForm from '../UserFeedbackForm'

const SUPPORT_WECHAT = 'iskaikaila'

export default function HelpFeedbackDialog({ onClose, returnFocusRef }) {
  const { t } = useTranslation()
  const dialogRef = useRef(null)
  const wechatRef = useRef(null)
  const [copyState, setCopyState] = useState('idle')

  useEffect(() => {
    const dialog = dialogRef.current
    const previousOverflow = document.body.style.overflow
    dialog.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus({ preventScroll: true })
    }
  }, [returnFocusRef])

  useEffect(() => {
    if (copyState !== 'copied') return undefined
    const timeout = setTimeout(() => setCopyState('idle'), 2500)
    return () => clearTimeout(timeout)
  }, [copyState])

  const copyWechat = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_WECHAT)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
      wechatRef.current?.focus()
      wechatRef.current?.select()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="flowlab-help-dialog rounded-[28px] border border-brand-line bg-brand-card p-0 text-brand-ink shadow-2xl"
      aria-labelledby="help-feedback-title"
      aria-describedby="help-feedback-description"
      onCancel={event => { event.preventDefault(); onClose() }}
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="relative p-6 sm:p-8">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('support.close')}
          className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-xl text-brand-muted transition-colors hover:bg-brand-inset hover:text-brand-ink"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-brand-success/10 text-brand-success" aria-hidden="true">
          <MessageCircle className="h-6 w-6" />
        </span>
        <h2 id="help-feedback-title" className="pr-8 text-[22px] font-semibold">{t('support.entry')}</h2>
        <p id="help-feedback-description" className="mt-2 text-[13px] leading-6 text-brand-muted">{t('support.description')}</p>

        <UserFeedbackForm source="help" className="mt-5" />

        <div className="mt-6 rounded-[20px] border border-brand-line bg-brand-inset/60 p-5">
          <h3 className="text-[14px] font-semibold">{t('support.contact')}</h3>
          <label htmlFor="support-wechat" className="mt-4 block text-[12px] text-brand-muted">{t('support.wechat')}</label>
          <input
            ref={wechatRef}
            id="support-wechat"
            value={SUPPORT_WECHAT}
            readOnly
            onFocus={event => event.target.select()}
            className="mt-1 block w-full min-w-0 rounded-md border-0 bg-transparent p-0 text-[22px] font-semibold tracking-wide text-brand-ink"
          />
          <button
            type="button"
            onClick={copyWechat}
            className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-brand-line bg-brand-card px-4 py-3 text-[13px] font-semibold text-brand-ink transition-colors hover:bg-brand-inset"
          >
            {copyState === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {t(copyState === 'copied' ? 'support.copied' : 'support.copy')}
          </button>
          <p role="status" aria-live="polite" className="mt-3 text-[12px] leading-5 text-brand-muted">
            {t(copyState === 'failed' ? 'support.copyFailed' : copyState === 'copied' ? 'support.copySuccess' : 'support.addHint')}
          </p>
        </div>

      </div>
    </dialog>
  )
}
