import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Loader2 } from 'lucide-react'
import { checkNickname, saveNickname } from '../lib/nickname'

/**
 * 设置社区昵称：输入时（停顿 400ms）向后端检查格式和是否被占用，可用时才能保存。
 * 个人资料页和发布面经表单共用。
 */
export default function NicknameField({ initial = '', onSaved, onCancel, autoFocus = false }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial || '')
  const [status, setStatus] = useState({ state: 'idle' }) // idle | checking | ok | error
  const [saving, setSaving] = useState(false)
  const checkId = useRef(0)
  const inputId = useId()
  const hintId = useId()

  useEffect(() => {
    const name = value.trim()
    if (!name || name === (initial || '')) {
      setStatus({ state: 'idle' })
      return
    }
    const id = ++checkId.current
    setStatus({ state: 'checking' })
    const timer = setTimeout(async () => {
      try {
        const result = await checkNickname(name)
        if (id !== checkId.current) return
        setStatus(result.available ? { state: 'ok', value: result.nickname } : { state: 'error', code: result.code })
      } catch {
        if (id === checkId.current) setStatus({ state: 'error', code: 'CHECK_FAILED' })
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [value, initial])

  const save = async () => {
    if (status.state !== 'ok') return
    setSaving(true)
    try {
      const saved = await saveNickname(status.value)
      setValue(saved || '')
      setStatus({ state: 'idle' })
      onSaved?.(saved)
    } catch (err) {
      setStatus({ state: 'error', code: err.code || 'SAVE_FAILED' })
    } finally {
      setSaving(false)
    }
  }

  const message = status.state === 'error'
    ? t(`nickname.errors.${status.code}`, t('nickname.errors.SAVE_FAILED'))
    : status.state === 'ok'
      ? t('nickname.available')
      : t('nickname.hint')

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="ml-1 block text-[12px] font-bold text-brand-ink">{t('nickname.label')}</label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            id={inputId}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                save()
              }
            }}
            maxLength={30}
            autoFocus={autoFocus}
            aria-describedby={hintId}
            aria-invalid={status.state === 'error'}
            placeholder={t('nickname.placeholder')}
            className={`w-full rounded-xl border bg-brand-inset px-4 py-2.5 pr-9 text-[13.5px] font-bold text-brand-ink placeholder:text-brand-muted/70 focus:outline-none ${
              status.state === 'error' ? 'border-brand-danger' : 'border-brand-line focus:border-brand-ink'
            }`}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-muted" aria-hidden="true">
            {status.state === 'checking' && <Loader2 className="h-4 w-4 animate-spin" />}
            {status.state === 'ok' && <Check className="h-4 w-4 text-brand-success" />}
          </span>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={status.state !== 'ok' || saving}
          className="shrink-0 rounded-xl bg-brand-ink px-4 text-[12.5px] font-bold text-brand-on-ink transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? t('nickname.saving') : t('nickname.save')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="shrink-0 rounded-xl border border-brand-line px-3 text-[12.5px] font-bold text-brand-muted hover:text-brand-ink">
            {t('nickname.cancel')}
          </button>
        )}
      </div>
      <p
        id={hintId}
        role={status.state === 'error' ? 'alert' : undefined}
        className={`ml-1 text-[11.5px] ${status.state === 'error' ? 'text-brand-danger' : status.state === 'ok' ? 'text-brand-success' : 'text-brand-muted'}`}
      >
        {message}
      </p>
    </div>
  )
}
