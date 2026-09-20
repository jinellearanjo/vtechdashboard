// src/pages/EmployeeDashboard.jsx
// Personal task view for contributors.
// Features: own tasks only (enforced by RLS), status updates, deadline awareness,
// read-only detail link, empty/loading/error states.

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import StatusBadge from '../components/StatusBadge'
import SkeletonTable from '../components/SkeletonTable'
import Toast from '../components/Toast'
import { formatDate, isOverdue, daysUntil } from '../lib/dateUtils'
import styles from './EmployeeDashboard.module.css'

const STATUS_OPTIONS = ['all', 'pending', 'in_progress', 'done', 'overdue']
const STATUS_LABELS  = { all: 'All', pending: 'Pending', in_progress: 'In Progress', done: 'Done', overdue: 'Overdue' }

export default function EmployeeDashboard() {
  const { profile } = useAuth()

  const [tasks,        setTasks]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortField,    setSortField]    = useState('deadline')
  const [sortDir,      setSortDir]      = useState('asc')
  const [toast,        setToast]        = useState(null)

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
  }, [])

  // ── Fetch own tasks ────────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('tasks')
      .select(`
        id, title, description, status, deadline, created_at,
        assigner:profiles!tasks_assigned_by_fkey(first_name, last_name)
      `)
      .eq('assigned_to', profile.id)
      .order('deadline', { ascending: true })

    if (error) { setError(error.message) }
    else        { setTasks(data ?? []) }
    setLoading(false)
  }, [profile.id])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { fetchTasks() }, [fetchTasks])

  // Realtime — own tasks only
  useEffect(() => {
    const channel = supabase
      .channel('tasks-employee')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `assigned_to=eq.${profile.id}` },
        fetchTasks
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchTasks, profile.id])

  // ── Derived data ───────────────────────────────────────────
  const filteredTasks = tasks
    .filter(t => {
      if (statusFilter === 'overdue') return isOverdue(t.deadline) && t.status !== 'done'
      if (statusFilter !== 'all')     return t.status === statusFilter
      return true
    })
    .sort((a, b) => {
      let aVal = a[sortField], bVal = b[sortField]
      if (!aVal) return 1
      if (!bVal) return -1
      const cmp = String(aVal).localeCompare(String(bVal))
      return sortDir === 'asc' ? cmp : -cmp
    })

  const stats = {
    total:      tasks.length,
    pending:    tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    done:       tasks.filter(t => t.status === 'done').length,
    overdue:    tasks.filter(t => isOverdue(t.deadline) && t.status !== 'done').length,
  }

  // ── Status update with optimistic UI ──────────────────────
  const handleStatusChange = async (taskId, newStatus) => {
    const prev = tasks.find(t => t.id === taskId)
    setTasks(ts => ts.map(t => t.id === taskId ? { ...t, status: newStatus } : t))

    const { error } = await supabase
      .from('tasks')
      .update({ status: newStatus })
      .eq('id', taskId)

    if (error) {
      setTasks(ts => ts.map(t => t.id === taskId ? prev : t))
      showToast('Status update failed.', 'error')
    } else {
      showToast('Status updated.')
    }
  }

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const renderSortIcon = (field) => {
    if (sortField !== field) return <span className={styles.sortNeutral}>↕</span>
    return <span className={styles.sortActive}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className={styles.shell}>
      <Navbar />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <main className={styles.main}>
        {/* Greeting */}
        <div className={styles.greeting}>
          <h1 className={styles.greetingText}>
            {getGreeting()}, {profile.first_name}.
          </h1>
          <p className={styles.greetingSubtext}>
            {stats.overdue > 0
              ? `You have ${stats.overdue} overdue task${stats.overdue > 1 ? 's' : ''} requiring attention.`
              : stats.inProgress > 0
              ? `${stats.inProgress} task${stats.inProgress > 1 ? 's are' : ' is'} currently in progress.`
              : 'All tasks are up to date.'}
          </p>
        </div>

        {/* Stats */}
        <div className={styles.statsBar}>
          {[
            { label: 'Assigned',    value: stats.total,      key: 'all' },
            { label: 'Pending',     value: stats.pending,    key: 'pending' },
            { label: 'In Progress', value: stats.inProgress, key: 'in_progress' },
            { label: 'Done',        value: stats.done,       key: 'done' },
            { label: 'Overdue',     value: stats.overdue,    key: 'overdue', danger: true },
          ].map(s => (
            <button
              key={s.key}
              className={`${styles.statCard} ${statusFilter === s.key ? styles.statCardActive : ''} ${s.danger && s.value > 0 ? styles.statCardDanger : ''}`}
              onClick={() => setStatusFilter(s.key)}
              aria-pressed={statusFilter === s.key}
            >
              <span className={styles.statValue}>{s.value}</span>
              <span className={styles.statLabel}>{s.label}</span>
            </button>
          ))}
        </div>

        {/* Filter tabs */}
        <div className={styles.filterRow} role="tablist" aria-label="Filter by status">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              role="tab"
              aria-selected={statusFilter === s}
              className={`${styles.filterTab} ${statusFilter === s ? styles.filterTabActive : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className={styles.errorState} role="alert">
            <strong>Could not load tasks.</strong> {error}
            <button className={styles.retryBtn} onClick={fetchTasks}>Retry</button>
          </div>
        )}

        {/* Loading */}
        {loading && !error && <SkeletonTable rows={5} cols={5} />}

        {/* Empty */}
        {!loading && !error && filteredTasks.length === 0 && (
          <div className={styles.emptyState}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
            <p>
              {statusFilter !== 'all'
                ? `No ${STATUS_LABELS[statusFilter].toLowerCase()} tasks.`
                : 'No tasks have been assigned to you yet.'}
            </p>
          </div>
        )}

        {/* Task table */}
        {!loading && !error && filteredTasks.length > 0 && (
          <div className={styles.tableWrapper} role="region" aria-label="My tasks">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th} onClick={() => handleSort('title')} tabIndex={0} onKeyDown={e => e.key === 'Enter' && handleSort('title')}>
                    Task {renderSortIcon('title')}
                  </th>
                  <th className={styles.th} onClick={() => handleSort('deadline')} tabIndex={0} onKeyDown={e => e.key === 'Enter' && handleSort('deadline')}>
                    Deadline {renderSortIcon('deadline')}
                  </th>
                  <th className={styles.th}>Assigned by</th>
                  <th className={styles.th} onClick={() => handleSort('status')} tabIndex={0} onKeyDown={e => e.key === 'Enter' && handleSort('status')}>
                    Status {renderSortIcon('status')}
                  </th>
                  <th className={styles.th}>Update</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((task, idx) => {
                  const due     = daysUntil(task.deadline)
                  const overdue = isOverdue(task.deadline) && task.status !== 'done'
                  return (
                    <tr
                      key={task.id}
                      className={`${styles.tr} ${overdue ? styles.trOverdue : ''} ${idx % 2 === 1 ? styles.trAlt : ''}`}
                    >
                      <td className={`${styles.td} ${styles.tdTitle}`}>
                        <Link to={`/tasks/${task.id}`} className={styles.taskLink}>
                          {task.title}
                        </Link>
                        {task.description && (
                          <span className={styles.taskDesc}>{task.description}</span>
                        )}
                      </td>
                      <td className={styles.td}>
                        <span className={`${styles.deadlineCell} ${overdue ? styles.deadlineDanger : due <= 2 ? styles.deadlineWarn : ''}`}>
                          {task.deadline ? formatDate(task.deadline) : '—'}
                          {task.deadline && task.status !== 'done' && (
                            <span className={styles.daysTag}>
                              {overdue ? `${Math.abs(due)}d overdue` : due === 0 ? 'Today' : `${due}d left`}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className={styles.td}>
                        {task.assigner
                          ? `${task.assigner.first_name} ${task.assigner.last_name}`
                          : '—'}
                      </td>
                      <td className={styles.td}>
                        <StatusBadge status={overdue ? 'overdue' : task.status} />
                      </td>
                      <td className={styles.td}>
                        {task.status !== 'done' ? (
                          <div className={styles.updateBtns}>
                            {task.status === 'pending' && (
                              <button
                                className={styles.updateBtn}
                                onClick={() => handleStatusChange(task.id, 'in_progress')}
                                aria-label="Mark as in progress"
                              >
                                Start
                              </button>
                            )}
                            {task.status === 'in_progress' && (
                              <button
                                className={`${styles.updateBtn} ${styles.updateBtnDone}`}
                                onClick={() => handleStatusChange(task.id, 'done')}
                                aria-label="Mark as done"
                              >
                                Mark done
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className={styles.completedTag}>✓ Completed</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && filteredTasks.length > 0 && (
          <div className={styles.tableFooter} aria-live="polite">
            Showing {filteredTasks.length} of {tasks.length} tasks
          </div>
        )}
      </main>
    </div>
  )
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
