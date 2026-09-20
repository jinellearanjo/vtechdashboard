// src/pages/TaskDetail.jsx
// Full task detail view — accessible by any authenticated user.
// RLS on the server ensures employees only reach tasks assigned to them.
// Managers see full detail and can edit inline.

import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import StatusBadge from '../components/StatusBadge'
import Toast from '../components/Toast'
import { formatDate, formatDateTime, isOverdue, daysUntil } from '../lib/dateUtils'
import styles from './TaskDetail.module.css'

export default function TaskDetail() {
  const { id }   = useParams()
  const navigate = useNavigate()
  const { profile, isManager } = useAuth()

  const [task,    setTask]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [toast,   setToast]   = useState(null)
  const [saving,  setSaving]  = useState(false)

  const showToast = (msg, type = 'success') => setToast({ message: msg, type })

  // ── Fetch task ─────────────────────────────────────────────
  useEffect(() => {
    const fetch = async () => {
      setLoading(true)
      setError(null)

      const { data, error } = await supabase
        .from('tasks')
        .select(`
          id, title, description, status, deadline, created_at,
          assigned_to, assigned_by,
          assignee:profiles!tasks_assigned_to_fkey(id, first_name, last_name, username, role),
          assigner:profiles!tasks_assigned_by_fkey(id, first_name, last_name)
        `)
        .eq('id', id)
        .single()

      if (error) {
        setError(error.code === 'PGRST116'
          ? 'Task not found or you do not have access.'
          : error.message)
      } else {
        setTask(data)
      }
      setLoading(false)
    }
    fetch()
  }, [id])

  // ── Status update (employee: own tasks; manager: all) ──────
  const handleStatusChange = async (newStatus) => {
    if (!task) return
    const prev = task
    setTask(t => ({ ...t, status: newStatus }))
    setSaving(true)

    const { error } = await supabase
      .from('tasks')
      .update({ status: newStatus })
      .eq('id', task.id)

    setSaving(false)
    if (error) {
      setTask(prev)
      showToast('Status update failed.', 'error')
    } else {
      showToast('Status updated.')
    }
  }

  const canUpdateStatus = () => {
    if (!task) return false
    if (isManager) return true
    return task.assigned_to === profile.id
  }

  // ── Render ─────────────────────────────────────────────────
  const overdue = task && isOverdue(task.deadline) && task.status !== 'done'
  const due     = task?.deadline ? daysUntil(task.deadline) : null

  return (
    <div className={styles.shell}>
      <Navbar />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <main className={styles.main}>
        {/* Breadcrumb */}
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <Link to={isManager ? '/manager/tasks' : '/employee'} className={styles.breadcrumbLink}>
            {isManager ? 'Tasks' : 'My Tasks'}
          </Link>
          <span className={styles.breadcrumbSep} aria-hidden="true">/</span>
          <span className={styles.breadcrumbCurrent} aria-current="page">
            {loading ? 'Loading…' : task?.title ?? 'Task detail'}
          </span>
        </nav>

        {/* Error */}
        {error && (
          <div className={styles.errorState} role="alert">
            <strong>Error.</strong> {error}
            <button className={styles.backBtn} onClick={() => navigate(-1)}>Go back</button>
          </div>
        )}

        {/* Loading */}
        {loading && !error && (
          <div className={styles.loadingState} aria-live="polite">
            <div className={styles.skeleton} style={{ height: 32, width: 300 }} />
            <div className={styles.skeleton} style={{ height: 18, width: 200 }} />
            <div className={styles.skeletonBlock} />
          </div>
        )}

        {/* Task detail */}
        {!loading && !error && task && (
          <div className={styles.layout}>

            {/* Main column */}
            <div className={styles.mainCol}>
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.titleRow}>
                    <h1 className={styles.title}>{task.title}</h1>
                    {overdue && (
                      <span className={styles.overdueTag} role="status">Overdue</span>
                    )}
                  </div>
                  <div className={styles.metaRow}>
                    <StatusBadge status={overdue ? 'overdue' : task.status} />
                    <span className={styles.metaSep} aria-hidden="true">·</span>
                    <span className={styles.metaText}>
                      Created {formatDate(task.created_at)}
                    </span>
                    {task.assigner && (
                      <>
                        <span className={styles.metaSep} aria-hidden="true">·</span>
                        <span className={styles.metaText}>
                          Assigned by {task.assigner.first_name} {task.assigner.last_name}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className={styles.cardBody}>
                  <h2 className={styles.sectionLabel}>Description</h2>
                  {task.description
                    ? <p className={styles.description}>{task.description}</p>
                    : <p className={styles.noContent}>No description provided.</p>
                  }
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <aside className={styles.sidebar}>

              {/* Deadline */}
              <div className={styles.sideCard}>
                <h2 className={styles.sideLabel}>Deadline</h2>
                <p className={`${styles.sideValue} ${overdue ? styles.sideValueDanger : due !== null && due <= 2 && task.status !== 'done' ? styles.sideValueWarn : ''}`}>
                  {task.deadline ? formatDate(task.deadline) : 'No deadline set'}
                </p>
                {task.deadline && task.status !== 'done' && (
                  <p className={styles.sideNote}>
                    {overdue
                      ? `${Math.abs(due)} day${Math.abs(due) !== 1 ? 's' : ''} overdue`
                      : due === 0
                      ? 'Due today'
                      : `${due} day${due !== 1 ? 's' : ''} remaining`}
                  </p>
                )}
              </div>

              {/* Assignee */}
              <div className={styles.sideCard}>
                <h2 className={styles.sideLabel}>Assignee</h2>
                {task.assignee ? (
                  <div className={styles.assigneeRow}>
                    <span className={styles.assigneeAvatar}>
                      {task.assignee.first_name?.[0]}{task.assignee.last_name?.[0]}
                    </span>
                    <div>
                      <p className={styles.assigneeName}>
                        {task.assignee.first_name} {task.assignee.last_name}
                      </p>
                      <p className={styles.assigneeUsername}>@{task.assignee.username}</p>
                    </div>
                  </div>
                ) : (
                  <p className={styles.noContent}>Unassigned</p>
                )}
              </div>

              {/* Status control */}
              {canUpdateStatus() && (
                <div className={styles.sideCard}>
                  <h2 className={styles.sideLabel}>Update status</h2>
                  <div className={styles.statusBtns}>
                    {[
                      { value: 'pending',     label: 'Pending' },
                      { value: 'in_progress', label: 'In Progress' },
                      { value: 'done',        label: 'Done' },
                    ].map(s => (
                      <button
                        key={s.value}
                        className={`${styles.statusBtn} ${task.status === s.value ? styles.statusBtnActive : ''}`}
                        onClick={() => handleStatusChange(s.value)}
                        disabled={saving || task.status === s.value}
                        aria-pressed={task.status === s.value}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className={styles.sideCard}>
                <h2 className={styles.sideLabel}>Details</h2>
                <dl className={styles.metaList}>
                  <dt className={styles.metaDt}>Task ID</dt>
                  <dd className={styles.metaDd}>{task.id.slice(0, 8)}…</dd>
                  <dt className={styles.metaDt}>Created</dt>
                  <dd className={styles.metaDd}>{formatDateTime(task.created_at)}</dd>
                </dl>
              </div>

              {/* Back */}
              <button className={styles.backBtn} onClick={() => navigate(-1)}>
                ← Back
              </button>
            </aside>
          </div>
        )}
      </main>
    </div>
  )
}
