// src/pages/ForgotPassword.jsx
// Sends a Supabase password-reset email. Always shows the same confirmation, whether or not the
// address has an account, so this page can't be used to check who has signed up.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { supabase } from '../lib/supabase'
import GridBackdrop from '../components/GridBackdrop'
import styles from './Login.module.css'

const schema = z.object({ email: z.string().email('Enter a valid email address') })

export default function ForgotPassword() {
  const [email, setEmail]     = useState('')
  const [error, setError]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const result = schema.safeParse({ email })
    if (!result.success) { setError(result.error.issues[0].message); return }

    setLoading(true)
    setError(null)
    // Errors here (rate limits, provider issues) aren't shown to the person — see the note above.
    await supabase.auth.resetPasswordForEmail(result.data.email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    setSent(true)
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

        <h1 className={styles.heading}>Reset your password</h1>
        <p className={styles.subheading}>
          {sent
            ? "If that email has an account, we've sent a link to reset your password."
            : "Enter your account's email address and we'll send you a reset link."}
        </p>

        {!sent && (
          <>
            {error && (
              <div className={styles.formError} role="alert" aria-live="assertive">{error}</div>
            )}
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="email">Email address</label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className={`${styles.input} ${error ? styles.inputError : ''}`}
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(null) }}
                  placeholder="you@verlyntech.com"
                  disabled={loading}
                  aria-invalid={!!error}
                />
              </div>
              <button type="submit" className={styles.submit} disabled={loading} aria-busy={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
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
