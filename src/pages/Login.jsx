// src/pages/Login.jsx
// Handles two auth flows:
//   1. Standard — email + password via Supabase auth
//   2. Legacy   — username only; credentials stored in localStorage

import { useMemo, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { legacyEmail, getDeviceCredential, deviceLoginAllowed } from '../lib/legacy'
import { z } from 'zod'
import GridBackdrop from '../components/GridBackdrop'
import styles from './Login.module.css'

const standardSchema = z.object({
  email:    z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const legacySchema = z.object({
  username: z.string().min(2, 'Username must be at least 2 characters'),
})

export default function Login() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const from      = location.state?.from?.pathname ?? '/dashboard'

  const [mode, setMode]       = useState('standard') // 'standard' | 'legacy'
  const [fields, setFields]   = useState({ email: '', password: '', username: '' })
  const [errors, setErrors]   = useState({})
  const [formError, setFormError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)

  // an old passwordless account remembered by this browser (see src/lib/legacy.js)
  const deviceCred = useMemo(
    () => (mode === 'legacy' && deviceLoginAllowed ? getDeviceCredential(fields.username) : null),
    [mode, fields.username]
  )

  const handleChange = (e) => {
    const { name, value } = e.target
    setFields(f => ({ ...f, [name]: value }))
    setErrors(e => ({ ...e, [name]: undefined }))
    setFormError(null)
  }

  // ── Standard login ──────────────────────────────────────────
  const handleStandardLogin = async () => {
    const result = standardSchema.safeParse(fields)
    if (!result.success) {
      const fieldErrors = {}
      result.error.issues.forEach(e => { fieldErrors[e.path[0]] = e.message })
      setErrors(fieldErrors)
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email:    fields.email.trim().toLowerCase(),
      password: fields.password,
    })
    setLoading(false)

    if (error) {
      setFormError('Incorrect email or password. Please try again.')
      return
    }

    navigate(from, { replace: true })
  }

  // ── Legacy login ────────────────────────────────────────────
  const handleLegacyLogin = async () => {
    const result = legacySchema.safeParse(fields)
    if (!result.success) {
      const fieldErrors = {}
      result.error.issues.forEach(e => { fieldErrors[e.path[0]] = e.message })
      setErrors(fieldErrors)
      return
    }

    const username = fields.username.trim().toLowerCase()

    if (fields.password) {
      setLoading(true)
      const { error } = await supabase.auth.signInWithPassword({ email: legacyEmail(username), password: fields.password })
      setLoading(false)
      if (error) {
        setFormError('Incorrect username or password. Please try again.')
        return
      }
      navigate(from, { replace: true })
      return
    }

    // Old passwordless account remembered by this browser: sign in once, then ask for a password
    if (deviceCred) {
      setLoading(true)
      const { error } = await supabase.auth.signInWithPassword({ email: deviceCred.email, password: deviceCred.password })
      setLoading(false)
      if (error) {
        setFormError("This device's saved sign-in no longer works. Enter your password instead.")
        return
      }
      navigate('/profile', { replace: true, state: { setPassword: true } })
      return
    }

    setErrors({ password: 'Enter your password' })
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (mode === 'standard') handleStandardLogin()
    else handleLegacyLogin()
  }

  const passwordField = (
      <div className={styles.field}>
        <label className={styles.label} htmlFor="password">Password</label>
        <div className={styles.passwordWrapper}>
          <input
            id="password"
            name="password"
            type={showPass ? 'text' : 'password'}
            autoComplete="current-password"
            className={`${styles.input} ${errors.password ? styles.inputError : ''}`}
            value={fields.password}
            onChange={handleChange}
            placeholder="••••••••"
            aria-describedby={errors.password ? 'password-error' : undefined}
            aria-invalid={!!errors.password}
            disabled={loading}
          />
          <button
            type="button"
            className={styles.showPass}
            onClick={() => setShowPass(s => !s)}
            aria-label={showPass ? 'Hide password' : 'Show password'}
            tabIndex={0}
          >
            {showPass ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        {errors.password && (
          <span id="password-error" className={styles.fieldError} role="alert">{errors.password}</span>
        )}
        {mode === 'legacy' && (
          <span id="legacy-pw-hint" className={styles.hint}>
            {deviceCred
              ? 'This device still remembers your old passwordless sign-in. Leave the password empty to sign in once, then set a password in your profile.'
              : 'Legacy accounts use a username and password.'}
          </span>
        )}
      </div>
  )

  return (
    <div className={styles.page}>

      {/* Brand side (hidden on small screens) */}
      <aside className={styles.brand}>
        <GridBackdrop />
        <span className={styles.brandMark}>VT</span>
        <h2 className={styles.brandName}>Verlyn Tech</h2>
        <p className={styles.brandLine}>Company dashboard</p>
      </aside>

      {/* Sign-in side */}
      <main className={styles.main}>
      <div className={styles.panel}>

        {/* Logo (shown only when the brand side is hidden) */}
        <div className={styles.panelLogo}>
          <span className={styles.logoMark}>VT</span>
          <span className={styles.logoName}>Verlyn Tech</span>
        </div>

        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.subheading}>
          {mode === 'standard'
            ? 'Enter your credentials to access your workspace.'
            : 'Sign in with your username and password.'}
        </p>

        {/* Mode tabs */}
        <div className={styles.tabs} role="tablist" aria-label="Login method">
          <button
            role="tab"
            aria-selected={mode === 'standard'}
            className={`${styles.tab} ${mode === 'standard' ? styles.tabActive : ''}`}
            onClick={() => { setMode('standard'); setErrors({}); setFormError(null) }}
          >
            Email &amp; Password
          </button>
          <button
            role="tab"
            aria-selected={mode === 'legacy'}
            className={`${styles.tab} ${mode === 'legacy' ? styles.tabActive : ''}`}
            onClick={() => { setMode('legacy'); setErrors({}); setFormError(null) }}
          >
            Legacy Access
          </button>
        </div>

        {location.state?.notice && !formError && (
          <div className={styles.formNotice} role="status">{location.state.notice}</div>
        )}

        {/* Form error */}
        {formError && (
          <div className={styles.formError} role="alert" aria-live="assertive">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {formError}
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>

          {/* Standard fields */}
          {mode === 'standard' && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="email">Email address</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  className={`${styles.input} ${errors.email ? styles.inputError : ''}`}
                  value={fields.email}
                  onChange={handleChange}
                  placeholder="you@verlyntech.com"
                  aria-describedby={errors.email ? 'email-error' : undefined}
                  aria-invalid={!!errors.email}
                  disabled={loading}
                />
                {errors.email && (
                  <span id="email-error" className={styles.fieldError} role="alert">{errors.email}</span>
                )}
              </div>
            </>
          )}

          {/* Legacy field */}
          {mode === 'legacy' && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                className={`${styles.input} ${errors.username ? styles.inputError : ''}`}
                value={fields.username}
                onChange={handleChange}
                placeholder="your.username"
                aria-describedby={errors.username ? 'username-error' : undefined}
                aria-invalid={!!errors.username}
                disabled={loading}
              />
              {errors.username && (
                <span id="username-error" className={styles.fieldError} role="alert">{errors.username}</span>
              )}
            </div>
          )}

          {passwordField}

          <button
            type="submit"
            className={styles.submit}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className={styles.footer}>
          No account?{' '}
          <Link to="/signup">Create one</Link>
          {' · '}
          <Link to="/terms">Terms</Link>
          {' · '}
          <Link to="/privacy">Privacy</Link>
        </p>
        {mode === 'legacy' && (
          <p className={styles.footer}>
            New to legacy access?{' '}
            <Link to="/signup" state={{ legacy: true, username: fields.username.trim().toLowerCase() }}>Create a legacy account</Link>
          </p>
        )}
      </div>
      </main>
    </div>
  )
}
