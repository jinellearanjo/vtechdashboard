// src/components/Toast.jsx
// Transient notification that auto-dismisses after 3.5 seconds.
// Types: 'success' | 'error' | 'info'

import { useEffect } from 'react'
import styles from './Toast.module.css'

const ICONS = {
  success: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  error: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
}

export default function Toast({ message, type = 'success', onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div
      className={`${styles.toast} ${styles[type]}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className={styles.icon}>{ICONS[type]}</span>
      <span className={styles.message}>{message}</span>
      <button
        className={styles.close}
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  )
}
