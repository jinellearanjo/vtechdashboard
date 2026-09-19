// src/components/PageLoader.jsx
// Full-page loading state used during lazy route loading and auth initialisation.

import styles from './PageLoader.module.css'

export default function PageLoader({ label = 'Loading' }) {
  return (
    <div className={styles.wrapper} role="status" aria-label={label}>
      <div className={styles.logo}>VT</div>
      <div className={styles.bar}>
        <div className={styles.fill} />
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  )
}
