// src/components/GridBackdrop.jsx
// Faint grid with a soft glow, fading out toward the edges. Purely decorative.
// The parent needs `position: relative; overflow: hidden` (or pass `fixed` to cover the viewport).

import styles from './GridBackdrop.module.css'

export default function GridBackdrop({ fixed = false }) {
  return (
    <div className={`${styles.backdrop} ${fixed ? styles.fixed : ''}`} aria-hidden="true">
      <div className={styles.glow} />
      <div className={styles.grid} />
    </div>
  )
}
