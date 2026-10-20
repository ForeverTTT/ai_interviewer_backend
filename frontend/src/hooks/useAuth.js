import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { track } from '../lib/analytics'
import { dashboardStore } from '../lib/dashboardStore'

const DEV_AUTH_BYPASS = import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === 'true'
const DEV_PREVIEW_USER = {
  id: 'local-preview',
  email: 'preview@flowlab.local',
  user_metadata: { full_name: 'Local Preview' },
}

export function useAuth() {
  const [user, setUser] = useState(DEV_AUTH_BYPASS ? DEV_PREVIEW_USER : null)
  const [loading, setLoading] = useState(!DEV_AUTH_BYPASS)

  useEffect(() => {
    if (DEV_AUTH_BYPASS) return undefined

    let mounted = true

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) {
        setUser(session?.user ?? null)
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === 'SIGNED_OUT') dashboardStore.clear()
      if (mounted) {
        setUser(session?.user ?? null)
        setLoading(false)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
  }

  const signInWithLinkedIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'linkedin_oidc',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
  }

  const signInWithEmail = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  // Resolves to { needsConfirmation } — hosted Supabase emails a confirmation
  // link that lands on /auth/callback; local Supabase signs in immediately.
  const signUpWithEmail = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) throw error
    // With confirmations on, Supabase hides existing accounts behind a fake
    // user that has no identities instead of returning an error.
    if (data.user && data.user.identities?.length === 0) {
      throw Object.assign(new Error('User already registered'), { code: 'user_already_exists' })
    }
    return { needsConfirmation: !data.session }
  }

  const sendPasswordReset = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })
    if (error) throw error
  }

  const updatePassword = async (password) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
  }

  const signInLocal = async () => {
    if (import.meta.env.VITE_LOCAL_SUPABASE !== 'true') {
      throw new Error('Local authentication is disabled')
    }

    const email = import.meta.env.VITE_LOCAL_EMAIL || 'local@example.com'
    const password = import.meta.env.VITE_LOCAL_PASSWORD || 'localdev123'
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (!signInError) return
    if (!/invalid login credentials/i.test(signInError.message || '')) throw signInError

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: 'Local Developer' } },
    })
    if (signUpError) throw signUpError

    // Local Supabase normally disables email confirmation. If a customized
    // config enables it, surface a useful error instead of silently looping.
    if (!data.session) {
      throw new Error('Local account created; disable email confirmation or confirm it in Mailpit')
    }
  }

  const signOut = async () => {
    // Before signing out, while the event can still be tied to the account.
    track('logged_out')
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return {
    user,
    loading,
    signInWithGoogle,
    signInWithLinkedIn,
    signInWithEmail,
    signUpWithEmail,
    sendPasswordReset,
    updatePassword,
    signInLocal,
    signOut,
  }
}
