// src/context/AuthContext.jsx
// Provides session, profile, role, and theme state to the entire application.
// Wrap <App /> with <AuthProvider /> in main.jsx.

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session,  setSession]  = useState(undefined) // undefined = loading
  const [profile,  setProfile]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [theme,    setTheme]    = useState(() => {
    return localStorage.getItem('vt-theme') || 'light'
  })

  // Apply theme to <html> element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('vt-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'light' ? 'dark' : 'light')
  }, [])

  // Fetch profile row for the authenticated user
  const fetchProfile = useCallback(async (userId) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Profile fetch error:', error.message)
      return null
    }
    return data
  }, [])

  // Initialise auth state on mount
  useEffect(() => {
    let mounted = true

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!mounted) return

      setSession(session)

      if (session?.user) {
        const profile = await fetchProfile(session.user.id)
        if (mounted) setProfile(profile)
      }

      setLoading(false)
    }

    init()

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return

        setSession(session)

        if (session?.user) {
          const profile = await fetchProfile(session.user.id)
          if (mounted) setProfile(profile)
        } else {
          setProfile(null)
        }

        setLoading(false)
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [fetchProfile])

  // Sign out
  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
  }, [])

  // Refresh profile (call after profile updates)
  const refreshProfile = useCallback(async () => {
    if (!session?.user) return
    const profile = await fetchProfile(session.user.id)
    setProfile(profile)
  }, [session, fetchProfile])

  const value = {
    session,
    profile,
    role: profile?.role ?? null,
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

// Hook — use this in any component: const { profile, role } = useAuth()
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
