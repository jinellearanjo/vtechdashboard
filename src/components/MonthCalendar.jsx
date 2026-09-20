// src/components/MonthCalendar.jsx
// Month view with task deadlines highlighted: each day with deadlines is tinted by its most urgent task
// (overdue / due soon / upcoming / done); click a day to list its tasks underneath.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  buildMonthGrid, shiftMonth, groupByDeadline, dayTone, taskTone, deadlineLabel, todayKey,
} from '../lib/calendar'
import styles from './MonthCalendar.module.css'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TONE_LABELS = {
  overdue:  'overdue',
  soon:     'due soon',
  upcoming: 'upcoming',
  done:     'done',
}

const STATUS_LABELS = { pending: 'Pending', in_progress: 'In progress', done: 'Done' }

const monthName = (year, month) =>
  new Date(year, month, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

const longDate = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function MonthCalendar({ tasks }) {
  const today = todayKey()
  const now = new Date()

  const [view,     setView]     = useState({ year: now.getFullYear(), month: now.getMonth() })
  const [selected, setSelected] = useState(today)

  const byDay = useMemo(() => groupByDeadline(tasks), [tasks])
  const weeks = useMemo(() => buildMonthGrid(view.year, view.month), [view])

  const goTo = (delta) => setView(v => shiftMonth(v.year, v.month, delta))
  const goToday = () => {
    const d = new Date()
    setView({ year: d.getFullYear(), month: d.getMonth() })
    setSelected(todayKey())
  }

  const selectedTasks = byDay.get(selected) ?? []

  return (
    <section className={styles.card} aria-label="Deadline calendar">
      <header className={styles.header}>
        <h2 className={styles.title} aria-live="polite">{monthName(view.year, view.month)}</h2>
        <div className={styles.nav}>
          <button type="button" className={styles.navBtn} onClick={() => goTo(-1)} aria-label="Previous month">&lsaquo;</button>
          <button type="button" className={styles.todayBtn} onClick={goToday}>Today</button>
          <button type="button" className={styles.navBtn} onClick={() => goTo(1)} aria-label="Next month">&rsaquo;</button>
        </div>
      </header>

      <div className={styles.grid} role="grid" aria-label={monthName(view.year, view.month)}>
        <div className={styles.weekdays} role="row">
          {WEEKDAYS.map(d => <span key={d} className={styles.weekday} role="columnheader">{d}</span>)}
        </div>

        {weeks.map((week, i) => (
          <div key={i} className={styles.week} role="row">
            {week.map(cell => {
              const dayTasks = byDay.get(cell.key) ?? []
              const tone = dayTasks.length ? dayTone(dayTasks, today) : 'none'
              const isToday = cell.key === today
              const isSelected = cell.key === selected
              const label = dayTasks.length
                ? `${longDate(cell.key)}: ${dayTasks.length} ${dayTasks.length === 1 ? 'task' : 'tasks'} due (${TONE_LABELS[tone]})`
                : longDate(cell.key)

              return (
                <button
                  key={cell.key}
                  type="button"
                  role="gridcell"
                  className={[
                    styles.cell,
                    !cell.inMonth ? styles.outside : '',
                    tone !== 'none' ? styles[`tone_${tone}`] : '',
                    isToday ? styles.today : '',
                    isSelected ? styles.selected : '',
                  ].join(' ')}
                  onClick={() => setSelected(cell.key)}
                  aria-label={label}
                  aria-pressed={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                >
                  <span className={styles.day}>{cell.day}</span>
                  {dayTasks.length > 0 && <span className={styles.count}>{dayTasks.length}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      <ul className={styles.legend} aria-label="Legend">
        <li><span className={`${styles.swatch} ${styles.tone_overdue}`} /> Overdue</li>
        <li><span className={`${styles.swatch} ${styles.tone_soon}`} /> Due within 3 days</li>
        <li><span className={`${styles.swatch} ${styles.tone_upcoming}`} /> Upcoming</li>
        <li><span className={`${styles.swatch} ${styles.tone_done}`} /> Done</li>
      </ul>

      <div className={styles.dayPanel}>
        <h3 className={styles.dayTitle}>{selected === today ? 'Today · ' : ''}{longDate(selected)}</h3>
        {selectedTasks.length === 0 ? (
          <p className={styles.empty}>No deadlines on this day.</p>
        ) : (
          <ul className={styles.dayList}>
            {selectedTasks.map(t => {
              const tone = taskTone(t, today)
              return (
                <li key={t.id} className={styles.dayItem}>
                  <span className={`${styles.dot} ${styles[`dot_${tone}`]}`} aria-hidden="true" />
                  <Link to={`/tasks/${t.id}`} className={styles.taskLink}>{t.title}</Link>
                  <span className={styles.taskMeta}>
                    {STATUS_LABELS[t.status] ?? t.status}
                    {t.status !== 'done' && tone === 'overdue' ? ` · ${deadlineLabel(t, today)}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
