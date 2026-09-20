// src/lib/calendar.js
// Date-only helpers for the home calendar and progress summary.
// Deadlines are `date` columns ("YYYY-MM-DD"), so everything here compares those strings in the
// user's local calendar and never converts through UTC timestamps.

const pad = (n) => String(n).padStart(2, '0')

export const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const todayKey = (now = new Date()) => toKey(now)

export const keyToDate = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDaysToKey = (key, days) => {
  const d = keyToDate(key)
  d.setDate(d.getDate() + days)
  return toKey(d)
}

export const daysBetweenKeys = (fromKey, toKeyValue) =>
  Math.round((keyToDate(toKeyValue) - keyToDate(fromKey)) / 86400000)

/**
 * Weeks (Monday first) covering the month. Each cell: { key, day, inMonth }.
 * month is 0-11. Only as many rows as the month needs (4-6).
 */
export function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7 // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const rows = Math.ceil((offset + daysInMonth) / 7)

  const weeks = []
  for (let r = 0; r < rows; r++) {
    const week = []
    for (let c = 0; c < 7; c++) {
      const d = new Date(year, month, 1 - offset + r * 7 + c)
      week.push({ key: toKey(d), day: d.getDate(), inMonth: d.getMonth() === month })
    }
    weeks.push(week)
  }
  return weeks
}

export function shiftMonth(year, month, delta) {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

export const deadlineKey = (task) => (task.deadline ? String(task.deadline).slice(0, 10) : null)

/** Map of "YYYY-MM-DD" -> tasks due that day. Tasks without a deadline are skipped. */
export function groupByDeadline(tasks) {
  const map = new Map()
  for (const t of tasks) {
    const key = deadlineKey(t)
    if (!key) continue
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t)
  }
  return map
}

/**
 * How urgent a task is, for colouring: done | overdue | soon (today to 3 days) | upcoming | none.
 */
export function taskTone(task, today = todayKey()) {
  if (task.status === 'done') return 'done'
  const key = deadlineKey(task)
  if (!key) return 'none'
  const diff = daysBetweenKeys(today, key)
  if (diff < 0) return 'overdue'
  if (diff <= 3) return 'soon'
  return 'upcoming'
}

const TONE_RANK = { overdue: 4, soon: 3, upcoming: 2, done: 1, none: 0 }

/** The most urgent tone among a day's tasks. */
export function dayTone(tasks, today = todayKey()) {
  let best = 'none'
  for (const t of tasks) {
    const tone = taskTone(t, today)
    if (TONE_RANK[tone] > TONE_RANK[best]) best = tone
  }
  return best
}

/** "Overdue by 2 days", "Due today", "Due tomorrow", "In 5 days", "No deadline". */
export function deadlineLabel(task, today = todayKey()) {
  const key = deadlineKey(task)
  if (!key) return 'No deadline'
  const diff = daysBetweenKeys(today, key)
  if (diff < 0) return `Overdue by ${-diff} ${diff === -1 ? 'day' : 'days'}`
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Due tomorrow'
  return `In ${diff} days`
}

/** Progress numbers for a list of tasks. */
export function summarizeTasks(tasks, today = todayKey()) {
  const weekEnd = addDaysToKey(today, 7)
  let done = 0, inProgress = 0, pending = 0, overdue = 0, dueThisWeek = 0

  for (const t of tasks) {
    if (t.status === 'done') { done++; continue }
    if (t.status === 'in_progress') inProgress++
    else pending++

    const key = deadlineKey(t)
    if (key && key < today) overdue++
    else if (key && key <= weekEnd) dueThisWeek++
  }

  const total = tasks.length
  return {
    total,
    done,
    inProgress,
    pending,
    open: total - done,
    overdue,
    dueThisWeek,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  }
}

/** Open tasks, soonest deadline first (no-deadline tasks last), capped at `limit`. */
export function upcomingTasks(tasks, limit = 6) {
  return tasks
    .filter(t => t.status !== 'done')
    .sort((a, b) => {
      const ka = deadlineKey(a), kb = deadlineKey(b)
      if (ka && kb) return ka < kb ? -1 : ka > kb ? 1 : 0
      if (ka) return -1
      if (kb) return 1
      return 0
    })
    .slice(0, limit)
}

export function greetingFor(now = new Date()) {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
