import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { BRAND_ASSETS } from '../assets/brandAssets'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import LanguageSwitcher from '../components/LanguageSwitcher'
import './LoginPage.css'

const MIN_PASSWORD_LENGTH = 8

/**
 * Landing page for the password-reset email. Supabase signs the user in with a
 * short-lived recovery session (from the URL), then we let them set a new password.
 */
export default function ResetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { updatePassword } = useAuth()
  const [status, setStatus] = useState('loading') // loading | ready | invalid | done
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A PKCE code is single-use; StrictMode replays effects in development.
  const exchangeRef = useRef(null)

  useEffect(() => {
    document.title = t('resetPassword.metaTitle')
  }, [t])

  useEffect(() => {
    let mounted = true
    const run = async () => {
      const search = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      if (search.get('error') || hash.get('error')) {
        if (mounted) setStatus('invalid')
        return
      }
      const code = search.get('code')
      if (code) {
        exchangeRef.current ??= supabase.auth.exchangeCodeForSession(code)
        await exchangeRef.current
      }
      // getSession waits for the client to finish reading a token from the hash.
      const { data } = await supabase.auth.getSession()
      if (mounted) setStatus(data?.session ? 'ready' : 'invalid')
    }
    void run()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (status !== 'done') return undefined
    const timer = window.setTimeout(() => navigate('/setup', { replace: true }), 1200)
    return () => window.clearTimeout(timer)
  }, [status, navigate])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('login.emailErrors.weakPassword'))
      return
    }
    if (password !== confirm) {
      setError(t('resetPassword.mismatch'))
      return
    }
    setBusy(true)
    try {
      await updatePassword(password)
      setStatus('done')
    } catch (err) {
      console.error('Password update error:', err)
      setError(err?.code === 'same_password' ? t('resetPassword.samePassword') : err?.message || t('login.emailErrors.unavailable'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="fl-login-page fl-login-page-single">
      <section className="fl-login-form-panel">
        <div className="fl-login-tools">
          <Link to="/login" className="fl-login-back"><ArrowLeft size={16} /> {t('resetPassword.backToLogin')}</Link>
          <div><LanguageSwitcher /></div>
        </div>

        <div className="fl-login-card">
          <Link to="/" className="fl-login-brand fl-login-reset-brand" aria-label={t('login.homeAria')}>
            <img className="fl-login-brand-wordmark" src={BRAND_ASSETS.wordmark} alt="FlowLab" />
          </Link>

          {status === 'loading' && <p role="status">{t('resetPassword.checking')}</p>}

          {status === 'invalid' && (
            <div className="fl-login-email-form">
              <p role="alert" className="fl-login-error">{t('resetPassword.invalidLink')}</p>
              <Link to="/login" className="fl-login-submit">{t('resetPassword.backToLogin')}</Link>
            </div>
          )}

          {status === 'done' && <p role="status" className="fl-login-notice">{t('resetPassword.success')}</p>}

          {status === 'ready' && (
            <form className="fl-login-email-form" onSubmit={handleSubmit}>
              <p className="fl-login-email-title">{t('resetPassword.title')}</p>
              <label className="fl-login-field">
                <span>{t('resetPassword.newPassword')}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  autoFocus
                  minLength={MIN_PASSWORD_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.passwordHint', { count: MIN_PASSWORD_LENGTH })}
                />
              </label>
              <label className="fl-login-field">
                <span>{t('resetPassword.confirmPassword')}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <button type="submit" disabled={busy} className="fl-login-submit">
                {busy ? t('login.emailBusy') : t('resetPassword.submit')}
                {!busy && <ArrowRight size={17} />}
              </button>
              {error && <p role="alert" className="fl-login-error">{error}</p>}
            </form>
          )}
        </div>
      </section>
    </main>
  )
}
