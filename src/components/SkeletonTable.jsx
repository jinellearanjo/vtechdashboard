// src/components/SkeletonTable.jsx
// Animated shimmer table used as a loading placeholder.
// Props: rows (number), cols (number)

import styles from './SkeletonTable.module.css'

export default function SkeletonTable({ rows = 6, cols = 5 }) {
  return (
    <div className={styles.wrapper} aria-busy="true" aria-label="Loading data" role="status">
      <table className={styles.table}>
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className={styles.th}>
                <div className={styles.shimmer} style={{ width: `${60 + (i * 15) % 40}%` }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className={styles.tr}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className={styles.td}>
                  <div
                    className={styles.shimmer}
                    style={{ width: `${50 + ((r + c) * 13) % 45}%` }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
