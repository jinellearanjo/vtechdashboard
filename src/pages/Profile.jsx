// src/pages/Profile.jsx
// Your own profile: photo, personal details, password, and account deletion.

import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import Avatar from '../components/Avatar'
import Modal from '../components/Modal'
import Toast from '../components/Toast'
import { AVATAR_ACCEPT, prepareAvatar, uploadAvatar, removeAvatar } from '../lib/avatars'
import {
  updateDetails, changePassword, checkAccountDeletion, verifyPassword, deleteAccount,
  fetchBirthdate, saveBirthdate, setFirstPassword,
} from '../lib/profile'
import { getDeviceCredential, clearDeviceCredential } from '../lib/legacy'
import DepartmentPicker from '../components/DepartmentPicker'
import { formatDate } from '../lib/dateUtils'
import styles from './Profile.module.css'

const ROLE_LABELS = { admin: 'Administrator', manager: 'Project Manager', employee: 'Contributor' }

const todayIso = () => new Date().toLocaleDateString('en-CA')

const detailsSchema = z.object({
  first_name:    z.string().trim().min(1, 'First name is required').max(50, 'At most 50 characters'),
  middle_name:   z.string().trim().max(50, 'At most 50 characters'),
  last_name:     z.string().trim().min(1, 'Last name is required').max(50, 'At most 50 characters'),
  username:      z.string().trim().toLowerCase()
                   .min(2, 'At least 2 characters').max(32, 'At most 32 characters')
                   .regex(/^[a-z0-9._-]+$/, 'Lowercase letters, numbers, dots, hyphens, underscores only'),
  // optional here: it is private and can be cleared; a blank value is stored as "none"
  date_of_birth: z.string().refine(d => d === '' || d <= todayIso(), 'Date of birth cannot be in the future'),
})

const passwordSchema = z.object({
  current: z.string().min(1, 'Enter your current password'),
  next: z.string()
    .min(8, 'At least 8 characters')
    .regex(/[A-Z]/, 'Needs an uppercase letter')
    .regex(/[0-9]/, 'Needs a number'),
  confirm: z.string().min(1, 'Confirm the new password'),
}).refine(d => d.next === d.confirm, { message: 'Passwords do not match', path: ['confirm'] })

const firstPasswordSchema = z.object({
  next:    passwordSchema.shape.next,
  confirm: z.string().min(1, 'Confirm the new password'),
}).refine(d => d.next === d.confirm, { message: 'Passwords do not match', path: ['confirm'] })

function issuesToErrors(error) {
  const errors = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (!errors[key]) errors[key] = issue.message
  }
  return errors
}

// ── Delete account dialog ──────────────────────────────────────
function DeleteAccountModal({ profile, email, askPassword, onClose, onDeleted }) {
  const [reason,   setReason]   = useState(undefined) // undefined = checking, null = allowed, string = blocked
  const [typed,    setTyped]    = useState('')
  const [password, setPassword] = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    let active = true
    checkAccountDeletion()
      .then(r => { if (active) setReason(r) })
      .catch(e => { if (active) setReason(e.message) })
    return () => { active = false }
  }, [])

  const confirmed = typed.trim() === profile.username && (!askPassword || password.length > 0)

  const handleDelete = async (e) => {
    e.preventDefault()
    if (!confirmed || busy) return
    setBusy(true)
    setError(null)
    try {
      if (askPassword) await verifyPassword(email, password)
      try { await removeAvatar(profile.id, profile.avatar_path) } catch { /* not critical */ }
      await deleteAccount()
      await onDeleted()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Delete your account" onClose={onClose} width={520}>
      <form className={styles.form} onSubmit={handleDelete}>
        <div className={styles.explain}>
          <p><strong>This cannot be undone.</strong> When you delete your account:</p>
          <ul>
            <li>Your profile, photo and sign-in are removed, and you are taken out of teams and group chats.</li>
            <li>Your messages stay, shown as &ldquo;Former user&rdquo;. Direct messages stay visible to the other person.</li>
            <li>Documents you submitted stay with the tasks they belong to, without your name.</li>
            <li>Completed tasks assigned to you stay on record without an assignee.</li>
            <li>The activity log keeps a record that the account was deleted.</li>
          </ul>
        </div>

        {reason === undefined && <p className={styles.muted}>Checking whether your account can be deleted…</p>}
        {reason && <div className={styles.errorBox} role="alert">{reason}</div>}

        {reason === null && (
          <>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="confirm-username">
                Type your username <strong>{profile.username}</strong> to confirm
              </label>
              <input
                id="confirm-username" className={styles.input} value={typed}
                onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false}
              />
            </div>

            {askPassword && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor="confirm-password">Your password</label>
                <input
                  id="confirm-password" type="password" className={styles.input} value={password}
                  onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                />
              </div>
            )}
          </>
        )}

        {error && <div className={styles.errorBox} role="alert">{error}</div>}

        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={`${styles.btn} ${styles.btnDanger}`} disabled={reason !== null || !confirmed || busy}>
            {busy ? 'Deleting…' : 'Delete my account'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Page ───────────────────────────────────────────────────────
export default function Profile() {
  const { profile, session, isLegacy, role, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const fileRef  = useRef(null)
  const email    = session?.user?.email ?? ''

  const [toast, setToast] = useState(null)
  const showToast = (message, type = 'success') => setToast({ message, type })

  // photo
  const [photoBusy, setPhotoBusy] = useState(false)

  // details
  // Date of birth lives in a private table (only you can read it), so it loads separately: null = loading
  const [birthdate, setBirthdate] = useState(null)
  const original = {
    first_name:    profile.first_name ?? '',
    middle_name:   profile.middle_name ?? '',
    last_name:     profile.last_name ?? '',
    username:      profile.username ?? '',
    date_of_birth: birthdate ?? '',
  }
  const [details,      setDetails]      = useState({ ...original, date_of_birth: '' })
  const [detailErrors, setDetailErrors] = useState({})
  const [saving,       setSaving]       = useState(false)
  const dirty = Object.keys(original).some(k => details[k] !== original[k])

  useEffect(() => {
    let active = true
    fetchBirthdate(profile.id)
      .then(value => {
        if (!active) return
        setBirthdate(value ?? '')
        setDetails(d => ({ ...d, date_of_birth: value ?? '' }))
      })
      .catch(() => { if (active) setBirthdate('') })
    return () => { active = false }
  }, [profile.id])

  // An old passwordless legacy account still keeps a sign-in in this browser until it gets a password
  const [hasDeviceLogin, setHasDeviceLogin] = useState(() => isLegacy && getDeviceCredential(profile.username) !== null)

  // password
  const [pw,       setPw]       = useState({ current: '', next: '', confirm: '' })
  const [pwErrors, setPwErrors] = useState({})
  const [pwBusy,   setPwBusy]   = useState(false)

  // delete
  const [deleting, setDeleting] = useState(false)

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    try {
      const blob = await prepareAvatar(file)
      await uploadAvatar(profile.id, blob, profile.avatar_path)
      await refreshProfile()
      showToast('Photo updated.')
    } catch (err) {
      showToast(err.message, 'error')
    }
    setPhotoBusy(false)
  }

  const handleRemovePhoto = async () => {
    setPhotoBusy(true)
    try {
      await removeAvatar(profile.id, profile.avatar_path)
      await refreshProfile()
      showToast('Photo removed.')
    } catch (err) {
      showToast(err.message, 'error')
    }
    setPhotoBusy(false)
  }

  const handleDetailChange = (e) => {
    const { name, value } = e.target
    setDetails(d => ({ ...d, [name]: value }))
    setDetailErrors(errs => ({ ...errs, [name]: undefined }))
  }

  const handleSaveDetails = async (e) => {
    e.preventDefault()
    const result = detailsSchema.safeParse(details)
    if (!result.success) { setDetailErrors(issuesToErrors(result.error)); return }

    const v = result.data
    setSaving(true)
    try {
      await updateDetails(profile.id, {
        first_name:    v.first_name,
        middle_name:   v.middle_name || null,
        last_name:     v.last_name,
        // legacy accounts sign in with their username, so it stays fixed
        ...(!isLegacy && v.username !== profile.username ? { username: v.username } : {}),
      })
      if (v.date_of_birth !== (birthdate ?? '')) {
        await saveBirthdate(profile.id, v.date_of_birth)
        setBirthdate(v.date_of_birth)
      }
      await refreshProfile()
      showToast('Details saved.')
    } catch (err) {
      showToast(err.message, 'error')
    }
    setSaving(false)
  }

  const handlePasswordChange = (e) => {
    const { name, value } = e.target
    setPw(p => ({ ...p, [name]: value }))
    setPwErrors(errs => ({ ...errs, [name]: undefined }))
  }

  const handleSavePassword = async (e) => {
    e.preventDefault()
    const result = (hasDeviceLogin ? firstPasswordSchema : passwordSchema).safeParse(pw)
    if (!result.success) { setPwErrors(issuesToErrors(result.error)); return }

    setPwBusy(true)
    try {
      if (hasDeviceLogin) {
        await setFirstPassword(pw.next)
        clearDeviceCredential(profile.username)   // the old passwordless sign-in stops working on this device
        setHasDeviceLogin(false)
        showToast('Password set. Use it to sign in from now on.')
      } else {
        await changePassword(email, pw.current, pw.next)
        showToast('Password changed.')
      }
      setPw({ current: '', next: '', confirm: '' })
    } catch (err) {
      showToast(err.message, 'error')
    }
    setPwBusy(false)
  }

  const handleDeleted = async () => {
    clearDeviceCredential(profile.username)
    await signOut()
    navigate('/login', { replace: true, state: { notice: 'Your account has been deleted.' } })
  }

  const field = (name, label, props = {}) => (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={`p-${name}`}>{label}</label>
      <input
        id={`p-${name}`} name={name} className={`${styles.input} ${detailErrors[name] ? styles.inputError : ''}`}
        value={details[name]} onChange={handleDetailChange} disabled={saving}
        aria-invalid={!!detailErrors[name]} aria-describedby={detailErrors[name] ? `p-${name}-err` : undefined}
        {...props}
      />
      {detailErrors[name] && <span id={`p-${name}-err`} className={styles.fieldError} role="alert">{detailErrors[name]}</span>}
    </div>
  )

  return (
    <div className={styles.shell}>
      <Navbar />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <main className={styles.main}>
        <h1 className={styles.title}>Your profile</h1>

        {/* Photo */}
        <section className={styles.card} aria-labelledby="photo-heading">
          <h2 id="photo-heading" className={styles.cardTitle}>Profile photo</h2>
          <div className={styles.photoRow}>
            <Avatar person={profile} size={96} />
            <div className={styles.photoInfo}>
              <div className={styles.actions} style={{ justifyContent: 'flex-start' }}>
                <input ref={fileRef} type="file" accept={AVATAR_ACCEPT} className={styles.hidden} onChange={handlePhoto} aria-label="Choose a profile photo" />
                <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => fileRef.current?.click()} disabled={photoBusy}>
                  {photoBusy ? 'Working…' : profile.avatar_path ? 'Change photo' : 'Upload photo'}
                </button>
                {profile.avatar_path && (
                  <button type="button" className={styles.btn} onClick={handleRemovePhoto} disabled={photoBusy}>Remove</button>
                )}
              </div>
              <p className={styles.hint}>
                JPG, PNG or WebP. It is cropped to a square and shrunk on your device before uploading, which also strips
                location and camera data. Everyone signed in to Verlyn Tech can see it.
              </p>
            </div>
          </div>
        </section>

        {/* Details */}
        <section className={styles.card} aria-labelledby="details-heading">
          <h2 id="details-heading" className={styles.cardTitle}>Personal details</h2>
          <form className={styles.form} onSubmit={handleSaveDetails} noValidate>
            <div className={styles.row3}>
              {field('first_name', 'First name', { autoComplete: 'given-name' })}
              {field('middle_name', 'Middle name', { autoComplete: 'additional-name' })}
              {field('last_name', 'Last name', { autoComplete: 'family-name' })}
            </div>
            <div className={styles.row2}>
              {field('username', 'Username', isLegacy ? { disabled: true } : { autoComplete: 'username' })}
              {field('date_of_birth', 'Date of birth', { type: 'date', max: todayIso(), disabled: saving || birthdate === null })}
            </div>
            {isLegacy && <p className={styles.hint}>Legacy accounts sign in with their username, so it can&rsquo;t be changed.</p>}
            <p className={styles.hint}>Your date of birth is private: only you can see it. Managers and administrators can&rsquo;t.</p>

            <dl className={styles.facts}>
              <div><dt>Role</dt><dd>{ROLE_LABELS[role] ?? role}</dd></div>
              <div><dt>Member since</dt><dd>{formatDate(profile.date_of_joining)}</dd></div>
              {!isLegacy && email && <div><dt>Email</dt><dd>{email}</dd></div>}
            </dl>

            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={() => { setDetails(original); setDetailErrors({}) }} disabled={!dirty || saving}>
                Reset
              </button>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={!dirty || saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </section>

        {/* Password */}
        <section className={styles.card} aria-labelledby="password-heading">
          <h2 id="password-heading" className={styles.cardTitle}>Password</h2>
          {hasDeviceLogin && (
            <div className={styles.notice} role="note">
              This account was created before passwords were required. Set one now so you can sign in from any device;
              until then this browser signs in from your username alone.
            </div>
          )}
          <form className={styles.form} onSubmit={handleSavePassword} noValidate>
            {[
              ...(hasDeviceLogin ? [] : [['current', 'Current password', 'current-password']]),
              ['next', hasDeviceLogin ? 'Choose a password' : 'New password', 'new-password'],
              ['confirm', 'Confirm password', 'new-password'],
            ].map(([name, label, ac]) => (
              <div key={name} className={styles.field}>
                <label className={styles.label} htmlFor={`pw-${name}`}>{label}</label>
                <input
                  id={`pw-${name}`} name={name} type="password" autoComplete={ac}
                  className={`${styles.input} ${pwErrors[name] ? styles.inputError : ''}`}
                  value={pw[name]} onChange={handlePasswordChange} disabled={pwBusy}
                  aria-invalid={!!pwErrors[name]}
                />
                {pwErrors[name] && <span className={styles.fieldError} role="alert">{pwErrors[name]}</span>}
              </div>
            ))}
            <div className={styles.actions}>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={pwBusy || (!hasDeviceLogin && !pw.current) || !pw.next}>
                {pwBusy ? 'Saving…' : hasDeviceLogin ? 'Set password' : 'Change password'}
              </button>
            </div>
          </form>
        </section>

        {/* Departments */}
        <section className={styles.card} aria-labelledby="dept-heading">
          <h2 id="dept-heading" className={styles.cardTitle}>Department access</h2>
          <p className={styles.muted}>
            Departments are restricted chats. Requests need approval from an administrator, up to 3 at a time.
          </p>
          <DepartmentPicker
            onDone={() => showToast('Request sent.')}
            onSkip={() => {}}
            submitLabel="Request access"
          />
        </section>

        {/* Danger zone */}
        <section className={`${styles.card} ${styles.danger}`} aria-labelledby="delete-heading">
          <h2 id="delete-heading" className={styles.cardTitle}>Delete account</h2>
          <p className={styles.muted}>
            Permanently remove your profile and sign-in. Your messages and submitted documents stay, without your name.
            See the <Link to="/privacy" className={styles.link}>privacy policy</Link> for what is kept.
          </p>
          <div className={styles.actions} style={{ justifyContent: 'flex-start' }}>
            <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => setDeleting(true)}>
              Delete my account…
            </button>
          </div>
        </section>
      </main>

      {deleting && (
        <DeleteAccountModal
          profile={profile} email={email} askPassword={!hasDeviceLogin}
          onClose={() => setDeleting(false)} onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
