// src/pages/Signup.jsx
// Handles two registration flows:
//   1. Standard — email + password + personal details + optional invite code
//   2. Legacy   — username only (no credentials); synthetic auth handled transparently
//
// If navigated here from Login with state.legacy === true, the legacy flow
// is pre-selected and the username field is pre-filled.

import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { z } from 'zod'
import styles from './Signup.module.css'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

// ── Validation schemas ───────────────────────────────────────

const baseSchema = z.object({
  username:      z.string().min(2, 'Username must be at least 2 characters')
                           .max(32, 'Username cannot exceed 32 characters')
                           .regex(/^[a-z0-9._-]+$/, 'Only lowercase letters, numbers, dots, hyphens, underscores'),
  first_name:    z.string().min(1, 'First name is required').max(50),
  middle_name:   z.string().max(50).optional().or(z.literal('')),
  last_name:     z.string().min(1, 'Last name is required').max(50),
  date_of_birth: z.string().min(1, 'Date of birth is required'),
  invite_code:   z.string().optional().or(z.literal('')),
})

const standardSchema = baseSchema.extend({
  email:    z.string().email('Enter a valid email address'),
  password: z.string()
              .min(8, 'Password must be at least 8 characters')
              .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
              .regex(/[0-9]/, 'Must contain at least one number'),
  confirm_password: z.string().min(1, 'Please confirm your password'),
}).refine(d => d.password === d.confirm_password, {
  message: 'Passwords do not match',
  path: ['confirm_password'],
})

const legacySchema = baseSchema

// ── Helpers ──────────────────────────────────────────────────

function getPasswordStrength(password) {
  if (!password) return { score: 0, label: '', color: '' }
  let score = 0
  if (password.length >= 8)  score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++
  if (score <= 1) return { score, label: 'Weak',   color: 'var(--interactive-danger)' }
  if (score <= 3) return { score, label: 'Fair',   color: 'var(--interactive-warning)' }
  return              { score, label: 'Strong', color: 'var(--interactive-success)' }
}

async function validateInviteCode(code) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/validate-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  return res.json()
}

// ── Component ────────────────────────────────────────────────

export default function Signup() {
  const navigate = useNavigate()
  const location = useLocation()
  const isLegacy = location.state?.legacy === true

  const [fields, setFields] = useState({
    username:         location.state?.username ?? '',
    first_name:       '',
    middle_name:      '',
    last_name:        '',
    date_of_birth:    '',
    email:            '',
    password:         '',
    confirm_password: '',
    invite_code:      '',
  })

  const [errors,      setErrors]      = useState({})
  const [formError,   setFormError]   = useState(null)
  const [formSuccess, setFormSuccess] = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [showPass,    setShowPass]    = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [inviteResult,  setInviteResult]  = useState(null) // { valid, role, invite_id }

  // Infer role from invite code validation result, else employee
  const resolvedRole = inviteResult?.role ?? 'employee'

  const strength = isLegacy ? null : getPasswordStrength(fields.password)

  const handleChange = (e) => {
    const { name, value } = e.target
    setFields(f => ({ ...f, [name]: value }))
    setErrors(e => ({ ...e, [name]: undefined }))
    setFormError(null)
    if (name === 'invite_code') setInviteResult(null)
  }

  // Validate invite code on blur
  const handleInviteBlur = async () => {
    const code = fields.invite_code.trim()
    if (!code) { setInviteResult(null); return }

    const result = await validateInviteCode(code)
    setInviteResult(result)

    if (!result.valid) {
      const messages = {
        not_found: 'Invite code not recognised.',
        used:      'This invite code has already been used.',
        expired:   'This invite code has expired.',
        server_error: 'Could not validate code. Please try again.',
      }
      setErrors(e => ({ ...e, invite_code: messages[result.reason] ?? 'Invalid code.' }))
    } else {
      setErrors(e => ({ ...e, invite_code: undefined }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setFormError(null)

    if (!termsAccepted) {
      setFormError('You must accept the Terms of Service to create an account.')
      return
    }

    // Validate invite code if provided
    if (fields.invite_code.trim() && !inviteResult?.valid) {
      const result = await validateInviteCode(fields.invite_code.trim())
      setInviteResult(result)
      if (!result.valid) {
        setErrors(e => ({ ...e, invite_code: 'Invalid or expired invite code.' }))
        return
      }
    }

    // Schema validation
    const schema = isLegacy ? legacySchema : standardSchema
    const result = schema.safeParse(fields)
    if (!result.success) {
      const fieldErrors = {}
      result.error.issues.forEach(err => { fieldErrors[err.path[0]] = err.message })
      setErrors(fieldErrors)
      return
    }

    setLoading(true)

    if (isLegacy) {
      await handleLegacySignup()
    } else {
      await handleStandardSignup()
    }

    setLoading(false)
  }

  // ── Sign-up helpers ────────────────────────────────────────
  // The profile row (and the role from the invite code) is created server-side by the
  // handle_new_user trigger from this metadata. The client never sets a role.
  const signUpMetadata = (isLegacyUser) => ({
    username:      fields.username.trim().toLowerCase(),
    first_name:    fields.first_name.trim(),
    middle_name:   fields.middle_name?.trim() || '',
    last_name:     fields.last_name.trim(),
    date_of_birth: fields.date_of_birth,
    invite_code:   fields.invite_code.trim(),
    is_legacy:     isLegacyUser,
  })

  const signUpErrorMessage = (error) => {
    if (/already registered/i.test(error.message)) return 'An account with this email already exists.'
    if (/database error/i.test(error.message)) {
      return 'Could not create the account. The username may be taken, or the invite code is no longer valid.'
    }
    return error.message
  }

  const finishSignup = (data, isLegacyUser) => {
    if (!data.session) {
      // Email confirmation is enabled on the project
      setFormSuccess('Account created. Check your email to confirm your address, then sign in.')
      return
    }
    setFormSuccess(
      isLegacyUser
        ? 'Account created. You are being signed in.'
        : 'Account created successfully. Redirecting to your dashboard.'
    )
    setTimeout(() => navigate('/dashboard', { replace: true }), 1500)
  }

  // ── Standard signup ────────────────────────────────────────
  const handleStandardSignup = async () => {
    const { data, error } = await supabase.auth.signUp({
      email:    fields.email.trim().toLowerCase(),
      password: fields.password,
      options:  { data: signUpMetadata(false) },
    })

    if (error) { setFormError(signUpErrorMessage(error)); return }
    if (!data.user?.id) { setFormError('Registration failed. Please try again.'); return }

    finishSignup(data, false)
  }

  // ── Legacy signup ──────────────────────────────────────────
  const handleLegacySignup = async () => {
    const username          = fields.username.trim().toLowerCase()
    const syntheticEmail    = `${username}@legacy.verlyntech.internal`
    const syntheticPassword = crypto.randomUUID()

    const { data, error } = await supabase.auth.signUp({
      email:    syntheticEmail,
      password: syntheticPassword,
      options:  { data: signUpMetadata(true) },
    })

    if (error) { setFormError(signUpErrorMessage(error)); return }
    if (!data.user?.id) { setFormError('Registration failed. Please try again.'); return }

    // Persist credentials locally so this device can re-authenticate
    localStorage.setItem(
      `vt-legacy-${username}`,
      JSON.stringify({ email: syntheticEmail, password: syntheticPassword })
    )

    finishSignup(data, true)
  }

  // ── Role badge display ─────────────────────────────────────
  const roleBadgeClass = {
    admin:    styles.roleAdmin,
    manager:  styles.roleManager,
    employee: styles.roleEmployee,
  }[resolvedRole]

  const roleLabels = {
    admin:    'Administrator',
    manager:  'Project Manager',
    employee: 'Contributor',
  }

  return (
    <div className={styles.page}>
      <div className={styles.panel}>

        {/* Logo */}
        <div className={styles.logoRow}>
          <span className={styles.logoMark}>VT</span>
          <span className={styles.logoName}>Verlyn Tech</span>
        </div>

        <h1 className={styles.heading}>
          {isLegacy ? 'Complete registration' : 'Create an account'}
        </h1>
        <p className={styles.subheading}>
          {isLegacy
            ? 'Provide your details to finalise legacy access.'
            : 'All fields marked with * are required.'}
        </p>

        {/* Legacy notice */}
        {isLegacy && (
          <div className={styles.noticeInfo} role="note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            Legacy accounts are tied to this device. Clearing browser storage will require re-registration.
          </div>
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

        {/* Form success */}
        {formSuccess && (
          <div className={styles.formSuccess} role="status" aria-live="polite">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {formSuccess}
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>

          {/* ── Section: Personal details ── */}
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Personal details</legend>

            {/* Name row */}
            <div className={styles.row3}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="first_name">First name *</label>
                <input
                  id="first_name" name="first_name" type="text"
                  autoComplete="given-name"
                  className={`${styles.input} ${errors.first_name ? styles.inputError : ''}`}
                  value={fields.first_name} onChange={handleChange}
                  placeholder="First" disabled={loading}
                  aria-invalid={!!errors.first_name}
                  aria-describedby={errors.first_name ? 'first-name-error' : undefined}
                />
                {errors.first_name && <span id="first-name-error" className={styles.fieldError} role="alert">{errors.first_name}</span>}
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="middle_name">Middle name</label>
                <input
                  id="middle_name" name="middle_name" type="text"
                  autoComplete="additional-name"
                  className={styles.input}
                  value={fields.middle_name} onChange={handleChange}
                  placeholder="Middle (optional)" disabled={loading}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="last_name">Last name *</label>
                <input
                  id="last_name" name="last_name" type="text"
                  autoComplete="family-name"
                  className={`${styles.input} ${errors.last_name ? styles.inputError : ''}`}
                  value={fields.last_name} onChange={handleChange}
                  placeholder="Last" disabled={loading}
                  aria-invalid={!!errors.last_name}
                  aria-describedby={errors.last_name ? 'last-name-error' : undefined}
                />
                {errors.last_name && <span id="last-name-error" className={styles.fieldError} role="alert">{errors.last_name}</span>}
              </div>
            </div>

            {/* DOB + Username */}
            <div className={styles.row2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="date_of_birth">Date of birth *</label>
                <input
                  id="date_of_birth" name="date_of_birth" type="date"
                  className={`${styles.input} ${errors.date_of_birth ? styles.inputError : ''}`}
                  value={fields.date_of_birth} onChange={handleChange}
                  disabled={loading}
                  max={new Date().toISOString().split('T')[0]}
                  aria-invalid={!!errors.date_of_birth}
                  aria-describedby={errors.date_of_birth ? 'dob-error' : undefined}
                />
                {errors.date_of_birth && <span id="dob-error" className={styles.fieldError} role="alert">{errors.date_of_birth}</span>}
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="username">Username *</label>
                <input
                  id="username" name="username" type="text"
                  autoComplete="username"
                  className={`${styles.input} ${errors.username ? styles.inputError : ''}`}
                  value={fields.username} onChange={handleChange}
                  placeholder="e.g. j.smith"
                  disabled={loading || (isLegacy && !!location.state?.username)}
                  aria-invalid={!!errors.username}
                  aria-describedby={errors.username ? 'username-error' : 'username-hint'}
                />
                {errors.username
                  ? <span id="username-error" className={styles.fieldError} role="alert">{errors.username}</span>
                  : <span id="username-hint" className={styles.hint}>Lowercase, no spaces.</span>
                }
              </div>
            </div>
          </fieldset>

          {/* ── Section: Credentials (standard only) ── */}
          {!isLegacy && (
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Credentials</legend>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="email">Email address *</label>
                <input
                  id="email" name="email" type="email"
                  autoComplete="email"
                  className={`${styles.input} ${errors.email ? styles.inputError : ''}`}
                  value={fields.email} onChange={handleChange}
                  placeholder="you@verlyntech.com" disabled={loading}
                  aria-invalid={!!errors.email}
                  aria-describedby={errors.email ? 'email-error' : undefined}
                />
                {errors.email && <span id="email-error" className={styles.fieldError} role="alert">{errors.email}</span>}
              </div>

              <div className={styles.row2}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="password">Password *</label>
                  <div className={styles.passwordWrapper}>
                    <input
                      id="password" name="password"
                      type={showPass ? 'text' : 'password'}
                      autoComplete="new-password"
                      className={`${styles.input} ${errors.password ? styles.inputError : ''}`}
                      value={fields.password} onChange={handleChange}
                      placeholder="Min. 8 characters" disabled={loading}
                      aria-invalid={!!errors.password}
                      aria-describedby="password-strength"
                    />
                    <button type="button" className={styles.showPass}
                      onClick={() => setShowPass(s => !s)}
                      aria-label={showPass ? 'Hide password' : 'Show password'}>
                      {showPass
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                  {/* Password strength meter */}
                  {fields.password && (
                    <div id="password-strength" className={styles.strengthRow} aria-live="polite">
                      <div className={styles.strengthBar}>
                        {[1,2,3,4,5].map(i => (
                          <div
                            key={i}
                            className={styles.strengthSegment}
                            style={{ backgroundColor: i <= strength.score ? strength.color : 'var(--border-default)' }}
                          />
                        ))}
                      </div>
                      <span className={styles.strengthLabel} style={{ color: strength.color }}>
                        {strength.label}
                      </span>
                    </div>
                  )}
                  {errors.password && <span className={styles.fieldError} role="alert">{errors.password}</span>}
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="confirm_password">Confirm password *</label>
                  <div className={styles.passwordWrapper}>
                    <input
                      id="confirm_password" name="confirm_password"
                      type={showConfirm ? 'text' : 'password'}
                      autoComplete="new-password"
                      className={`${styles.input} ${errors.confirm_password ? styles.inputError : ''}`}
                      value={fields.confirm_password} onChange={handleChange}
                      placeholder="Repeat password" disabled={loading}
                      aria-invalid={!!errors.confirm_password}
                    />
                    <button type="button" className={styles.showPass}
                      onClick={() => setShowConfirm(s => !s)}
                      aria-label={showConfirm ? 'Hide password' : 'Show password'}>
                      {showConfirm
                        ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      }
                    </button>
                  </div>
                  {errors.confirm_password && <span className={styles.fieldError} role="alert">{errors.confirm_password}</span>}
                </div>
              </div>
            </fieldset>
          )}

          {/* ── Section: Access ── */}
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Access</legend>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="invite_code">Invite code</label>
              <div className={styles.inviteRow}>
                <input
                  id="invite_code" name="invite_code" type="text"
                  className={`${styles.input} ${errors.invite_code ? styles.inputError : inviteResult?.valid ? styles.inputSuccess : ''}`}
                  value={fields.invite_code} onChange={handleChange}
                  onBlur={handleInviteBlur}
                  placeholder="Optional — required for manager or admin access"
                  disabled={loading}
                  style={{ textTransform: 'uppercase' }}
                  aria-describedby="invite-hint"
                />
                {inviteResult?.valid && (
                  <span className={`${styles.rolePill} ${roleBadgeClass}`}>
                    {roleLabels[resolvedRole]}
                  </span>
                )}
              </div>
              {errors.invite_code
                ? <span className={styles.fieldError} role="alert">{errors.invite_code}</span>
                : <span id="invite-hint" className={styles.hint}>
                    Without a code, your account will be created as a Contributor.
                  </span>
              }
            </div>
          </fieldset>

          {/* ── Terms acceptance ── */}
          <div className={styles.termsRow}>
            <input
              id="terms" type="checkbox"
              className={styles.checkbox}
              checked={termsAccepted}
              onChange={e => setTermsAccepted(e.target.checked)}
              disabled={loading}
              aria-required="true"
            />
            <label htmlFor="terms" className={styles.termsLabel}>
              I have read and agree to the{' '}
              <Link to="/terms" target="_blank" rel="noopener noreferrer">
                Terms of Service
              </Link>
            </label>
          </div>

          <button
            type="submit"
            className={styles.submit}
            disabled={loading || !termsAccepted}
            aria-busy={loading}
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className={styles.footer}>
          Already have an account?{' '}
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
