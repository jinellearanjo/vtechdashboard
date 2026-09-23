// src/components/DepartmentPicker.jsx
// Choose up to MAX_DEPARTMENTS department channels to request access to. Used right after sign-up and
// on the profile page. Approval is required before any messages in a department become visible.

import { useEffect, useState } from 'react'
import { listDepartments, requestDepartments, MAX_DEPARTMENTS } from '../lib/departments'
import styles from './DepartmentPicker.module.css'

const STATUS_LABEL = { pending: 'Requested', approved: 'Approved', denied: 'Denied · request again' }

export default function DepartmentPicker({ onDone, onSkip, submitLabel = 'Request access' }) {
  const [departments, setDepartments] = useState(null) // null = loading
  const [error,       setError]       = useState(null)
  const [selected,    setSelected]    = useState(() => new Set())
  const [submitting,  setSubmitting]  = useState(false)

  useEffect(() => {
    let active = true
    listDepartments()
      .then(list => { if (active) setDepartments(list) })
      .catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])

  const alreadyCommitted = (d) => d.status === 'pending' || d.status === 'approved'
  const committedCount = (departments ?? []).filter(alreadyCommitted).length
  const atCap = committedCount + selected.size >= MAX_DEPARTMENTS

  const toggle = (dept) => {
    if (alreadyCommitted(dept)) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(dept.id)) next.delete(dept.id)
      else if (!atCap) next.add(dept.id)
      return next
    })
  }

  const handleSubmit = async () => {
    if (selected.size === 0) { onSkip(); return }
    setSubmitting(true)
    setError(null)
    try {
      await requestDepartments([...selected])
      onDone()
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <p className={styles.intro}>
        Departments are restricted chats. Pick up to {MAX_DEPARTMENTS} you need access to — an administrator will
        review each request. You can also do this later from your profile.
      </p>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {departments === null && !error && <p className={styles.muted}>Loading departments…</p>}

      {departments && (
        <>
          <ul className={styles.list}>
            {departments.map(dept => {
              const committed = alreadyCommitted(dept)
              const checked = committed || selected.has(dept.id)
              const disabled = committed || (atCap && !selected.has(dept.id))
              return (
                <li key={dept.id}>
                  <label className={`${styles.item} ${disabled && !checked ? styles.itemDisabled : ''}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(dept)}
                    />
                    <span className={styles.itemBody}>
                      <span className={styles.itemName}>{dept.title}</span>
                      {dept.description && <span className={styles.itemDesc}>{dept.description}</span>}
                    </span>
                    {dept.status && <span className={`${styles.badge} ${styles[`badge_${dept.status}`]}`}>{STATUS_LABEL[dept.status]}</span>}
                  </label>
                </li>
              )
            })}
          </ul>
          <p className={styles.count}>{committedCount + selected.size} / {MAX_DEPARTMENTS} selected</p>
        </>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.btn} onClick={onSkip} disabled={submitting}>
          {selected.size > 0 ? 'Cancel' : 'Skip for now'}
        </button>
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSubmit} disabled={submitting || departments === null}>
          {submitting ? 'Requesting…' : selected.size > 0 ? submitLabel : 'Continue without requesting'}
        </button>
      </div>
    </div>
  )
}
