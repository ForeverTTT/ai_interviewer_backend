import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BRAND_ASSETS } from '../assets/brandAssets'
import { motion } from 'framer-motion'
import { ArrowLeft, ArrowRight, Mail } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { AppThemeToggle } from '../components/ThemeToggle'
import { track } from '../lib/analytics'
import './LoginPage.css'

const CHARACTER_SHEET = BRAND_ASSETS.characterRoleBoard

// The job detective has its own artwork; the others are still cut from the shared role board.
const SHELL_TEAM = [
  { id: 'coach', crop: 'top-left' },
  { id: 'job', asset: BRAND_ASSETS.jobDetective },
  { id: 'resume', crop: 'top-right' },
  { id: 'review', crop: 'bottom-right' },
]

function TeamMascot({ member, index }) {
  return (
    <motion.div
      className="fl-login-team-member"
      initial={{ opacity: 0, y: 30, rotate: index % 2 ? 2 : -2 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.65, delay: 0.12 + index * 0.08, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={`fl-login-mascot-crop fl-login-mascot-${member.crop ?? 'single'}`} aria-hidden="true">
        <img src={member.asset ?? CHARACTER_SHEET} alt="" />
      </div>
    </motion.div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#0A66C2" d="M19 0H5a5 5 0 0 0-5 5v14a5 5 0 0 0 5 5h14a5 5 0 0 0 5-5V5a5 5 0 0 0-5-5ZM8 19H5V8h3v11ZM6.5 6.73A1.76 1.76 0 1 1 6.5 3.2a1.76 1.76 0 0 1 0 3.53ZM20 19h-3v-5.6c0-3.37-4-3.12-4 0V19h-3V8h3v1.77C14.4 7.18 20 6.99 20 12.24V19Z" />
    </svg>
  )
}

const MIN_PASSWORD_LENGTH = 8

// Supabase error codes we can explain better than its English message.
const EMAIL_ERROR_KEYS = {
  invalid_credentials: 'login.emailErrors.invalidCredentials',
  email_not_confirmed: 'login.emailErrors.notConfirmed',
  user_already_exists: 'login.emailErrors.alreadyRegistered',
  email_exists: 'login.emailErrors.alreadyRegistered',
  weak_password: 'login.emailErrors.weakPassword',
  over_email_send_rate_limit: 'login.emailErrors.rateLimited',
  over_request_rate_limit: 'login.emailErrors.rateLimited',
  email_provider_disabled: 'login.emailErrors.disabled',
  signup_disabled: 'login.emailErrors.disabled',
}

function EmailForm({ mode, onModeChange, onBack, signInWithEmail, signUpWithEmail, sendPasswordReset }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const switchMode = (next) => {
    setError('')
    setNotice('')
    setPassword('')
    onModeChange(next)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setNotice('')
    const address = email.trim()
    if (mode === 'signup' && password.length < MIN_PASSWORD_LENGTH) {
      setError(t('login.emailErrors.weakPassword'))
      return
    }

    setBusy(true)
    try {
      if (mode === 'signin') {
        await signInWithEmail(address, password)
        track('login_completed', { provider: 'email', isNewUser: false })
      } else if (mode === 'signup') {
        const { needsConfirmation } = await signUpWithEmail(address, password)
        if (needsConfirmation) {
          setNotice(t('login.emailCheckInbox', { email: address }))
          setPassword('')
        } else {
          track('login_completed', { provider: 'email', isNewUser: true })
        }
      } else {
        await sendPasswordReset(address)
        setNotice(t('login.emailResetSent', { email: address }))
      }
    } catch (err) {
      console.error('Email auth error:', err)
      const key = EMAIL_ERROR_KEYS[err?.code]
      track('login_failed', { reason: `email_${err?.code || 'unknown'}` })
      setError(key ? t(key) : err?.message || t('login.emailErrors.unavailable'))
    } finally {
      setBusy(false)
    }
  }

  const submitLabel = {
    signin: t('login.emailSignInSubmit'),
    signup: t('login.emailSignUpSubmit'),
    reset: t('login.emailResetSubmit'),
  }[mode]

  return (
    <form className="fl-login-email-form" onSubmit={handleSubmit}>
      <p className="fl-login-email-title">{t(`login.emailTitle.${mode}`)}</p>

      <label className="fl-login-field">
        <span>{t('login.emailLabel')}</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </label>

      {mode !== 'reset' && (
        <label className="fl-login-field">
          <span className="fl-login-field-head">
            {t('login.passwordLabel')}
            {mode === 'signin' && (
              <button type="button" className="fl-login-link" onClick={() => switchMode('reset')}>
                {t('login.emailForgot')}
              </button>
            )}
          </span>
          <input
            type="password"
            name="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'signup' ? t('login.passwordHint', { count: MIN_PASSWORD_LENGTH }) : ''}
          />
        </label>
      )}

      <button type="submit" disabled={busy} className="fl-login-submit">
        {busy ? t('login.emailBusy') : submitLabel}
        {!busy && <ArrowRight size={17} />}
      </button>

      {error && <p role="alert" className="fl-login-error">{error}</p>}
      {notice && <p role="status" className="fl-login-notice">{notice}</p>}

      <div className="fl-login-email-links">
        {mode === 'signin' && (
          <button type="button" className="fl-login-link" onClick={() => switchMode('signup')}>
            {t('login.emailSwitchToSignUp')}
          </button>
        )}
        {mode !== 'signin' && (
          <button type="button" className="fl-login-link" onClick={() => switchMode('signin')}>
            {t('login.emailSwitchToSignIn')}
          </button>
        )}
        <button type="button" className="fl-login-link fl-login-link-muted" onClick={onBack}>
          <ArrowLeft size={13} /> {t('login.emailOtherMethods')}
        </button>
      </div>
    </form>
  )
}

export default function LoginPage() {
  const { t, i18n } = useTranslation()
  const {
    user,
    loading,
    signInWithGoogle,
    signInWithLinkedIn,
    signInWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    signInLocal,
  } = useAuth()
  const [loginError, setLoginError] = useState('')
  const [localBusy, setLocalBusy] = useState(false)
  // null shows the provider buttons; otherwise 'signin' | 'signup' | 'reset'.
  const [emailMode, setEmailMode] = useState(null)
  const isLocalSupabase = import.meta.env.VITE_LOCAL_SUPABASE === 'true'
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/setup'

  useEffect(() => {
    document.title = t('login.metaTitle')
  }, [i18n.resolvedLanguage, t])

  useEffect(() => {
    if (!loading && user) navigate(from, { replace: true })
  }, [user, loading, navigate, from])

  const handleGoogleLogin = async () => {
    setLoginError('')
    track('login_started', { provider: 'google' })
    try {
      await signInWithGoogle()
    } catch (error) {
      console.error('Google login error:', error)
      setLoginError(error?.message || t('login.googleUnavailable'))
    }
  }

  const handleLinkedInLogin = async () => {
    setLoginError('')
    track('login_started', { provider: 'linkedin' })
    try {
      await signInWithLinkedIn()
    } catch (error) {
      console.error('LinkedIn login error:', error)
      setLoginError(error?.message || t('login.linkedinUnavailable'))
    }
  }

  const handleEmailOption = () => {
    setLoginError('')
    track('login_started', { provider: 'email' })
    setEmailMode('signin')
  }

  const handleLocalLogin = async () => {
    setLoginError('')
    setLocalBusy(true)
    track('login_started', { provider: 'local' })
    try {
      await signInLocal()
      track('login_completed', { provider: 'local', isNewUser: false })
    } catch (error) {
      console.error('Local login error:', error)
      setLoginError(error?.message || t('login.localUnavailable'))
    } finally {
      setLocalBusy(false)
    }
  }

  return (
    <main className="fl-login-page">
      <section className="fl-login-team-panel" aria-label={t('login.teamAria')}>
        <div className="fl-login-mesh fl-login-mesh-pink" aria-hidden="true" />
        <div className="fl-login-mesh fl-login-mesh-aqua" aria-hidden="true" />

        <Link to="/" className="fl-login-brand fl-login-brand-center" aria-label={t('login.homeAria')}>
          <img
            className="fl-login-brand-wordmark"
            src={BRAND_ASSETS.wordmark}
            alt="FlowLab"
          />
        </Link>

        <div className="fl-login-team-row">
          {SHELL_TEAM.map((member, index) => <TeamMascot key={member.id} member={member} index={index} />)}
        </div>
      </section>

      <section className="fl-login-form-panel">
        <div className="fl-login-tools">
          <Link to="/" className="fl-login-back"><ArrowLeft size={16} /> {t('login.back')}</Link>
          <div><LanguageSwitcher /><AppThemeToggle /></div>
        </div>

        <motion.div className="fl-login-card" initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.75, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}>
          <p>{t('login.intro')}</p>

          {emailMode ? (
            <EmailForm
              mode={emailMode}
              onModeChange={setEmailMode}
              onBack={() => setEmailMode(null)}
              signInWithEmail={signInWithEmail}
              signUpWithEmail={signUpWithEmail}
              sendPasswordReset={sendPasswordReset}
            />
          ) : (
            <div className="fl-login-options">
              {isLocalSupabase ? (
                <button type="button" onClick={handleLocalLogin} disabled={localBusy} className="fl-login-option fl-login-option-local">
                  <span><span className="fl-login-local-icon">F</span>{localBusy ? t('login.localLoading') : t('login.localContinue')}</span>
                  <ArrowRight size={18} />
                </button>
              ) : (
                <>
                  <button type="button" onClick={handleGoogleLogin} className="fl-login-option fl-login-option-google">
                    <span><GoogleIcon />{t('login.google')}</span>
                    <ArrowRight size={18} />
                  </button>
                  <button type="button" onClick={handleLinkedInLogin} className="fl-login-option fl-login-option-linkedin">
                    <span><LinkedInIcon />{t('login.linkedin')}</span>
                    <ArrowRight size={18} />
                  </button>
                </>
              )}
              <button type="button" onClick={handleEmailOption} className="fl-login-option fl-login-option-email">
                <span><Mail className="fl-login-mail-icon" />{t('login.email')}</span>
                <ArrowRight size={18} />
              </button>
            </div>
          )}

          {loginError && !emailMode && <p role="alert" className="fl-login-error">{loginError}</p>}
          <p className="fl-login-terms">{t('login.terms')}</p>
        </motion.div>
      </section>
    </main>
  )
}
