// src/context/AuthContext.jsx
// Provides session, profile, role, and theme state to the entire application.
// Includes retry logic for profile fetch — auth state fires before the
// profiles row is guaranteed to be readable via RLS.

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

const RETRY_ATTEMPTS = 5
const RETRY_DELAY_MS = 600

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Retries the profile fetch up to RETRY_ATTEMPTS times with a delay.
// Needed because onAuthStateChange fires before RLS can confirm the
// newly inserted profile row is visible to the authenticated session.
async function fetchProfileWithRetry(userId) {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (data) return data

    // PGRST116 = no rows returned — profile not yet visible, retry
    if (error?.code === 'PGRST116' && attempt < RETRY_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS * attempt) // back off progressively
      continue
    }

    // Any other error or final attempt — give up
    if (error) console.error(`Profile fetch attempt ${attempt} failed:`, error.message)
    return null
  }
  return null
}

export function AuthProvider({ children }) {
  const [session,  setSession]  = useState(undefined) // undefined = still initialising
  const [profile,  setProfile]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [theme,    setTheme]    = useState(() => {
    return localStorage.getItem('vt-theme') || 'light'
  })

  // Apply theme token to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('vt-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'light' ? 'dark' : 'light')
  }, [])

  // Initialise auth state on mount
  useEffect(() => {
    let mounted = true

    const init = async () => {
      // Get existing session (page refresh / returning user)
      const { data: { session } } = await supabase.auth.getSession()

      if (!mounted) return

      setSession(session)

      if (session?.user) {
        const profile = await fetchProfileWithRetry(session.user.id)
        if (mounted) setProfile(profile)
      }

      if (mounted) setLoading(false)
    }

    init()

    // Listen for sign-in, sign-out, token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return

        setSession(session)

        if (session?.user) {
          // Show loading briefly while profile resolves
          setLoading(true)
          const profile = await fetchProfileWithRetry(session.user.id)
          if (mounted) {
            setProfile(profile)
            setLoading(false)
          }
        } else {
          // Signed out
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return
    const profile = await fetchProfileWithRetry(session.user.id)
    setProfile(profile)
  }, [session])

  const value = {
    session,
    profile,
    role:       profile?.role ?? null,
    isAdmin:    profile?.role === 'admin',
    isManager:  profile?.role === 'manager' || profile?.role === 'admin',
    isEmployee: profile?.role === 'employee',
    isLegacy:   profile?.is_legacy ?? false,
    loading,
    theme,
    toggleTheme,
    signOut,
    refreshProfile,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
