// src/pages/ResetPassword.jsx
// Completion step for the "forgot password" flow. When someone clicks the emailed link, Supabase
// redirects here and establishes a temporary recovery session; this page just sets a new password.

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { supabase } from '../lib/supabase'
import GridBackdrop from '../components/GridBackdrop'
import styles from './Login.module.css'

const schema = z.object({
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
  confirm: z.string(),
}).refine(d => d.password === d.confirm, { message: 'Passwords do not match', path: ['confirm'] })

export default function ResetPassword() {
  const navigate = useNavigate()

  // The recovery link's session takes a moment to establish after redirect.
  const [ready, setReady]     = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [fields, setFields]   = useState({ password: '', confirm: '' })
  const [errors, setErrors]   = useState({})
  const [formError, setFormError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)

  useEffect(() => {
    let active = true
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true)
    })
    // If the link already expired or was already used, no PASSWORD_RECOVERY event ever fires.
    const timer = setTimeout(async () => {
      const { data } = await supabase.auth.getSession()
      if (active && !data.session) setInvalid(true)
    }, 3000)
    return () => { active = false; sub.subscription.unsubscribe(); clearTimeout(timer) }
  }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFields(f => ({ ...f, [name]: value }))
    setErrors(e => ({ ...e, [name]: undefined }))
    setFormError(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const result = schema.safeParse(fields)
    if (!result.success) {
      const fieldErrors = {}
      result.error.issues.forEach(err => { fieldErrors[err.path[0]] = err.message })
      setErrors(fieldErrors)
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: fields.password })
    setLoading(false)

    if (error) { setFormError(error.message); return }
    setDone(true)
    setTimeout(() => navigate('/dashboard', { replace: true }), 1800)
  }

  return (
    <div className={styles.page}>
      <aside className={styles.brand}>
        <GridBackdrop />
        <span className={styles.brandMark}>VT</span>
        <h2 className={styles.brandName}>Verlyn Tech</h2>
        <p className={styles.brandLine}>Company dashboard</p>
      </aside>

      <main className={styles.main}>
      <div className={styles.panel}>
        <div className={styles.panelLogo}>
          <span className={styles.logoMark}>VT</span>
          <span className={styles.logoName}>Verlyn Tech</span>
        </div>

        <h1 className={styles.heading}>Choose a new password</h1>

        {invalid && !ready ? (
          <>
            <p className={styles.subheading}>
              This reset link is invalid or has expired. Request a new one.
            </p>
            <p className={styles.footer}>
              <Link to="/forgot-password">Send a new reset link</Link>
            </p>
          </>
        ) : done ? (
          <p className={styles.subheading}>Password changed. Taking you to your dashboard…</p>
        ) : (
          <>
            <p className={styles.subheading}>
              {ready ? 'Enter a new password for your account.' : 'Checking your reset link…'}
            </p>
            {formError && (
              <div className={styles.formError} role="alert" aria-live="assertive">{formError}</div>
            )}
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="password">New password</label>
                <input
                  id="password" name="password" type="password" autoComplete="new-password"
                  className={`${styles.input} ${errors.password ? styles.inputError : ''}`}
                  value={fields.password} onChange={handleChange}
                  disabled={loading || !ready}
                  aria-invalid={!!errors.password}
                />
                {errors.password && <span className={styles.fieldError} role="alert">{errors.password}</span>}
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="confirm">Confirm password</label>
                <input
                  id="confirm" name="confirm" type="password" autoComplete="new-password"
                  className={`${styles.input} ${errors.confirm ? styles.inputError : ''}`}
                  value={fields.confirm} onChange={handleChange}
                  disabled={loading || !ready}
                  aria-invalid={!!errors.confirm}
                />
                {errors.confirm && <span className={styles.fieldError} role="alert">{errors.confirm}</span>}
              </div>
              <button type="submit" className={styles.submit} disabled={loading || !ready} aria-busy={loading}>
                {loading ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          </>
        )}

        <p className={styles.footer}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
      </main>
    </div>
  )
}
