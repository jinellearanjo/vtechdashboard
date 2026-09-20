// src/components/StatusBadge.jsx
// Renders a colour-coded status pill.
// Accepts: 'pending' | 'in_progress' | 'done' | 'overdue'

import styles from './StatusBadge.module.css'

const CONFIG = {
  pending:     { label: 'Pending',     className: 'pending' },
  in_progress: { label: 'In Progress', className: 'inProgress' },
  done:        { label: 'Done',        className: 'done' },
  overdue:     { label: 'Overdue',     className: 'overdue' },
}

export default function StatusBadge({ status }) {
  const config = CONFIG[status] ?? { label: status, className: 'pending' }
  return (
    <span
      className={`${styles.badge} ${styles[config.className]}`}
      role="status"
      aria-label={`Status: ${config.label}`}
    >
      {config.label}
    </span>
  )
}
