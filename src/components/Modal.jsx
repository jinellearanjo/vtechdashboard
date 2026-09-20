// src/components/Modal.jsx
// Minimal accessible dialog: overlay, Escape / click-outside to close, focus moves in and is restored on close.

import { useEffect, useRef } from 'react'
import styles from './Modal.module.css'

export default function Modal({ title, onClose, children, width = 440 }) {
  const dialogRef = useRef(null)
  const closeRef  = useRef(onClose)

  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.querySelector('input, textarea, select, button')?.focus()

    const onKey = (e) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  return (
    <div
      className={styles.overlay}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className={styles.header}>
          <h2 id="modal-title" className={styles.title}>{title}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">&times;</button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}
