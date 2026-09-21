// src/pages/Home.jsx
// Landing page for every role: greeting, progress, upcoming tasks and a deadline calendar.
// Managers and admins can switch between their own tasks and everyone's.

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import MonthCalendar from '../components/MonthCalendar'
import { useUnreadTotal } from '../lib/chat'
import { getDeviceCredential } from '../lib/legacy'
import { fetchMyTasks, fetchAllTasks, countPendingReviews } from '../lib/tasks'
import { summarizeTasks, upcomingTasks, taskTone, deadlineLabel, greetingFor, todayKey } from '../lib/calendar'
import styles from './Home.module.css'

const STATUS_LABELS = { pending: 'Pending', in_progress: 'In progress', done: 'Done' }

export default function Home() {
  const { profile, isManager, isLegacy } = useAuth()
  const unread = useUnreadTotal()

  const [scope,   setScope]   = useState('mine')   // 'mine' | 'all' (managers/admins)
  const [tasks,   setTasks]   = useState(null)     // null = loading
  const [error,   setError]   = useState(null)
  const [pending, setPending] = useState(0)
  // old passwordless legacy account still signing in from this browser
  const [needsPassword] = useState(() => isLegacy && getDeviceCredential(profile.username) !== null)

  useEffect(() => {
    let active = true
    const load = scope === 'all' ? fetchAllTasks() : fetchMyTasks(profile.id)
    load
      .then(data => { if (active) { setTasks(data); setError(null) } })
      .catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [scope, profile.id])

  useEffect(() => {
    if (!isManager) return
    let active = true
    countPendingReviews().then(n => { if (active) setPending(n) })
    return () => { active = false }
  }, [isManager])

  const changeScope = (next) => {
    if (next === scope) return
    setTasks(null)
    setScope(next)
  }

  const today = todayKey()
  const summary  = useMemo(() => summarizeTasks(tasks ?? [], today), [tasks, today])
  const upcoming = useMemo(() => upcomingTasks(tasks ?? [], 6), [tasks])

  const dateLine = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const loading = tasks === null && !error

  return (
    <div className={styles.shell}>
      <Navbar />
      <main className={styles.main}>

        <header className={styles.header}>
          <div>
            <h1 className={styles.greeting}>{greetingFor()}, {profile.first_name}</h1>
            <p className={styles.date}>{dateLine}</p>
          </div>

          {isManager && (
            <div className={styles.scope} role="group" aria-label="Which tasks to show">
              <button
                type="button"
                className={`${styles.scopeBtn} ${scope === 'mine' ? styles.scopeActive : ''}`}
                onClick={() => changeScope('mine')}
                aria-pressed={scope === 'mine'}
              >
                My tasks
              </button>
              <button
                type="button"
                className={`${styles.scopeBtn} ${scope === 'all' ? styles.scopeActive : ''}`}
                onClick={() => changeScope('all')}
                aria-pressed={scope === 'all'}
              >
                Everyone
              </button>
            </div>
          )}
        </header>

        {error && <div className={styles.errorBanner} role="alert">Could not load tasks. {error}</div>}

        {(needsPassword || unread > 0 || (isManager && pending > 0)) && (
          <div className={styles.notices}>
            {needsPassword && (
              <Link to="/profile" className={styles.notice}>
                Set a password for your account so you can sign in anywhere <span aria-hidden="true">&rarr;</span>
              </Link>
            )}
            {unread > 0 && (
              <Link to="/chat" className={styles.notice}>
                <strong>{unread}</strong> unread {unread === 1 ? 'message' : 'messages'} <span aria-hidden="true">&rarr;</span>
              </Link>
            )}
            {isManager && pending > 0 && (
              <Link to="/manager" className={styles.notice}>
                <strong>{pending}</strong> {pending === 1 ? 'submission' : 'submissions'} awaiting review <span aria-hidden="true">&rarr;</span>
              </Link>
            )}
          </div>
        )}

        {/* Stats */}
        <section className={styles.stats} aria-label="Task summary">
          <div className={styles.stat}>
            <span className={styles.statValue}>{loading ? '–' : summary.open}</span>
            <span className={styles.statLabel}>Open tasks</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{loading ? '–' : summary.dueThisWeek}</span>
            <span className={styles.statLabel}>Due in the next 7 days</span>
          </div>
          <div className={`${styles.stat} ${summary.overdue > 0 ? styles.statDanger : ''}`}>
            <span className={styles.statValue}>{loading ? '–' : summary.overdue}</span>
            <span className={styles.statLabel}>Overdue</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{loading ? '–' : summary.done}</span>
            <span className={styles.statLabel}>Completed</span>
          </div>
        </section>

        <div className={styles.columns}>
          <div className={styles.column}>

            {/* Progress */}
            <section className={styles.card} aria-labelledby="progress-heading">
              <h2 id="progress-heading" className={styles.cardTitle}>
                {scope === 'all' ? 'Team progress' : 'Your progress'}
              </h2>

              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : summary.total === 0 ? (
                <p className={styles.muted}>Nothing assigned yet. New tasks will show up here.</p>
              ) : (
                <>
                  <div className={styles.progressHead}>
                    <span className={styles.percent}>{summary.percent}%</span>
                    <span className={styles.muted}>{summary.done} of {summary.total} tasks done</span>
                  </div>
                  <div
                    className={styles.bar}
                    role="img"
                    aria-label={`${summary.done} done, ${summary.inProgress} in progress, ${summary.pending} pending out of ${summary.total}`}
                  >
                    <span className={styles.segDone}     style={{ flexGrow: summary.done }} />
                    <span className={styles.segProgress} style={{ flexGrow: summary.inProgress }} />
                    <span className={styles.segPending}  style={{ flexGrow: summary.pending }} />
                  </div>
                  <ul className={styles.barLegend}>
                    <li><span className={`${styles.swatch} ${styles.segDone}`} /> Done · {summary.done}</li>
                    <li><span className={`${styles.swatch} ${styles.segProgress}`} /> In progress · {summary.inProgress}</li>
                    <li><span className={`${styles.swatch} ${styles.segPending}`} /> Pending · {summary.pending}</li>
                  </ul>
                </>
              )}
            </section>

            {/* Upcoming */}
            <section className={styles.card} aria-labelledby="upcoming-heading">
              <h2 id="upcoming-heading" className={styles.cardTitle}>Upcoming tasks</h2>

              {loading ? (
                <p className={styles.muted}>Loading…</p>
              ) : upcoming.length === 0 ? (
                <p className={styles.muted}>
                  {summary.total === 0 ? 'No tasks yet.' : 'All caught up. Nothing open right now.'}
                </p>
              ) : (
                <ul className={styles.taskList}>
                  {upcoming.map(t => {
                    const tone = taskTone(t, today)
                    const who = scope === 'all'
                      ? (t.team ? `${t.team.name} (team)` : t.assignee ? `${t.assignee.first_name} ${t.assignee.last_name}` : null)
                      : (t.team ? `Team · ${t.team.name}` : null)
                    return (
                      <li key={t.id} className={styles.taskItem}>
                        <div className={styles.taskMain}>
                          <Link to={`/tasks/${t.id}`} className={styles.taskLink}>{t.title}</Link>
                          <span className={`${styles.due} ${styles[`due_${tone}`]}`}>{deadlineLabel(t, today)}</span>
                          {who && <span className={styles.who}>{who}</span>}
                        </div>
                        <span className={`${styles.status} ${styles[`status_${t.status}`]}`}>
                          {STATUS_LABELS[t.status] ?? t.status}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}

              <Link to={isManager ? '/manager' : '/employee'} className={styles.viewAll}>
                {isManager ? 'Manage all tasks' : 'See all my tasks'} <span aria-hidden="true">&rarr;</span>
              </Link>
            </section>
          </div>

          <div className={styles.column}>
            <MonthCalendar tasks={tasks ?? []} />
          </div>
        </div>
      </main>
    </div>
  )
}
