// src/lib/dateUtils.js
// Centralised date formatting and comparison utilities.
// All timestamps stored as UTC; rendered in the user's local timezone.

/**
 * Format a date string or ISO timestamp to YYYY-MM-DD.
 * @param {string} value
 * @returns {string}
 */
export function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d)) return '—'
  return d.toLocaleDateString('en-CA') // YYYY-MM-DD, locale-independent
}

/**
 * Format a timestamp to "YYYY-MM-DD HH:mm" in the user's local timezone.
 * @param {string} value
 * @returns {string}
 */
export function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (isNaN(d)) return '—'
  const date = d.toLocaleDateString('en-CA')
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

/**
 * Returns true if the given deadline date is in the past (today counts as not overdue).
 * @param {string} deadline  YYYY-MM-DD
 * @returns {boolean}
 */
export function isOverdue(deadline) {
  if (!deadline) return false
  const today    = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate  = new Date(deadline)
  dueDate.setHours(0, 0, 0, 0)
  return dueDate < today
}

/**
 * Returns the number of days until (positive) or since (negative) the deadline.
 * 0 = due today.
 * @param {string} deadline  YYYY-MM-DD
 * @returns {number}
 */
export function daysUntil(deadline) {
  if (!deadline) return null
  const today   = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDate = new Date(deadline)
  dueDate.setHours(0, 0, 0, 0)
  const diff    = dueDate - today
  return Math.round(diff / (1000 * 60 * 60 * 24))
}
