// src/context/AuthContext.jsx
// Provides session, profile, role, and theme state to the entire application.
// Includes retry logic for profile fetch — auth state fires before the
// profiles row is guaranteed to be readable via RLS.

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

const RETRY_ATTEMPTS = 3
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

  // Single source of truth: onAuthStateChange fires INITIAL_SESSION on subscribe,
  // then SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT. The profile is only fetched when
  // the user changes, so token refreshes and tab-focus events don't refetch it.
  const profileUserRef = useRef(null)

  useEffect(() => {
    let mounted = true

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return

        setSession(session)

        if (!session?.user) {
          profileUserRef.current = null
          setProfile(null)
          setLoading(false)
          return
        }

        if (profileUserRef.current === session.user.id) {
          setLoading(false)
          return
        }

        profileUserRef.current = session.user.id
        setLoading(true)

        // Defer: awaiting a supabase call inside this callback can deadlock the auth client.
        setTimeout(async () => {
          const p = await fetchProfileWithRetry(session.user.id)
          if (!mounted) return
          if (!p) profileUserRef.current = null // allow a retry on the next auth event
          setProfile(p)
          setLoading(false)
        }, 0)
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    profileUserRef.current = null
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

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
