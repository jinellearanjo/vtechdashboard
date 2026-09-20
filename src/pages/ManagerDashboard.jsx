// src/pages/ManagerDashboard.jsx
// Full task management view for managers and admins.
// Features: dense data table, column sorting, status filters, assign tasks,
// deadline tracking, optimistic updates, empty/loading/error states.

import { useState, useEffect, useCallback, useRef } from 'react'
import { Link, Routes, Route } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import StatusBadge from '../components/StatusBadge'
import SkeletonTable from '../components/SkeletonTable'
import Toast from '../components/Toast'
import { formatDate, isOverdue, daysUntil } from '../lib/dateUtils'
import styles from './ManagerDashboard.module.css'

const SORT_FIELDS    = { title: 'Title', assigned_to: 'Assignee', deadline: 'Deadline', status: 'Status', created_at: 'Created' }

const EMPTY_TASK = {
  title: '', description: '', assigned_to: '', deadline: '', status: 'pending',
}

export default function ManagerDashboard() {
  return (
    <div className={styles.shell}>
      <Navbar />
      <Routes>
        <Route index element={<ManagerHome />} />
        <Route path="tasks" element={<ManagerHome />} />
        <Route path="team"  element={<TeamView />} />
      </Routes>
    </div>
  )
}

// ── Manager Home / Tasks ─────────────────────────────────────

function ManagerHome() {
  const { profile } = useAuth()

  const [tasks,       setTasks]       = useState([])
  const [employees,   setEmployees]   = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [statusFilter,setStatusFilter]= useState('all')
  const [sortField,   setSortField]   = useState('deadline')
  const [sortDir,     setSortDir]     = useState('asc')
  const [search,      setSearch]      = useState('')
  const [modalOpen,   setModalOpen]   = useState(false)
  const [editTask,    setEditTask]    = useState(null) // null = new task
  const [formFields,  setFormFields]  = useState(EMPTY_TASK)
  const [formErrors,  setFormErrors]  = useState({})
  const [saving,      setSaving]      = useState(false)
  const [toast,       setToast]       = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const searchRef = useRef(null)

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
  }, [])

  // ── Data fetching ────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [tasksRes, employeesRes] = await Promise.all([
      supabase
        .from('tasks')
        .select(`
          id, title, description, status, deadline, created_at,
          assigned_to, assigned_by,
          assignee:profiles!tasks_assigned_to_fkey(id, first_name, last_name, username),
          assigner:profiles!tasks_assigned_by_fkey(id, first_name, last_name)
        `)
        .order('created_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('id, first_name, last_name, username, role')
        .in('role', ['employee', 'manager'])
        .order('first_name'),
    ])

    if (tasksRes.error) { setError(tasksRes.error.message); setLoading(false); return }
    if (employeesRes.error) { setError(employeesRes.error.message); setLoading(false); return }

    setTasks(tasksRes.data ?? [])
    setEmployees(employeesRes.data ?? [])
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { fetchData() }, [fetchData])

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('tasks-manager')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, fetchData)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [fetchData])

  // ── Derived data ─────────────────────────────────────────
  const filteredTasks = tasks
    .filter(t => {
      if (statusFilter === 'overdue') return isOverdue(t.deadline) && t.status !== 'done'
      if (statusFilter !== 'all')     return t.status === statusFilter
      return true
    })
    .filter(t => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        t.title?.toLowerCase().includes(q) ||
        t.assignee?.first_name?.toLowerCase().includes(q) ||
        t.assignee?.last_name?.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      let aVal = a[sortField], bVal = b[sortField]
      if (sortField === 'assigned_to') {
        aVal = a.assignee?.last_name ?? ''
        bVal = b.assignee?.last_name ?? ''
      }
      if (!aVal) return 1
      if (!bVal) return -1
      const cmp = String(aVal).localeCompare(String(bVal))
      return sortDir === 'asc' ? cmp : -cmp
    })

  const stats = {
    total:     tasks.length,
    pending:   tasks.filter(t => t.status === 'pending').length,
    inProgress:tasks.filter(t => t.status === 'in_progress').length,
    done:      tasks.filter(t => t.status === 'done').length,
    overdue:   tasks.filter(t => isOverdue(t.deadline) && t.status !== 'done').length,
  }

  // ── Sorting ──────────────────────────────────────────────
  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const renderSortIcon = (field) => {
    if (sortField !== field) return <span className={styles.sortNeutral}>↕</span>
    return <span className={styles.sortActive}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // ── Modal ────────────────────────────────────────────────
  const openCreateModal = () => {
    setEditTask(null)
    setFormFields(EMPTY_TASK)
    setFormErrors({})
    setModalOpen(true)
  }

  const openEditModal = (task) => {
    setEditTask(task)
    setFormFields({
      title:       task.title,
      description: task.description ?? '',
      assigned_to: task.assigned_to ?? '',
      deadline:    task.deadline ?? '',
      status:      task.status,
    })
    setFormErrors({})
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditTask(null)
    setFormFields(EMPTY_TASK)
    setFormErrors({})
  }

  const validateForm = () => {
    const errs = {}
    if (!formFields.title.trim())   errs.title = 'Title is required'
    if (!formFields.assigned_to)    errs.assigned_to = 'Assignee is required'
    if (!formFields.deadline)       errs.deadline = 'Deadline is required'
    setFormErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Save task (create / update) with optimistic update ──
  const handleSave = async () => {
    if (!validateForm()) return
    setSaving(true)

    const payload = {
      title:       formFields.title.trim(),
      description: formFields.description.trim() || null,
      assigned_to: formFields.assigned_to,
      deadline:    formFields.deadline,
      status:      formFields.status,
      assigned_by: profile.id,
    }

    if (editTask) {
      // Optimistic update
      setTasks(prev => prev.map(t => t.id === editTask.id ? { ...t, ...payload } : t))

      const { error } = await supabase.from('tasks').update(payload).eq('id', editTask.id)
      if (error) {
        setTasks(prev => prev.map(t => t.id === editTask.id ? editTask : t)) // rollback
        showToast('Failed to update task. ' + error.message, 'error')
      } else {
        showToast('Task updated.')
        closeModal()
        fetchData()
      }
    } else {
      const { data, error } = await supabase.from('tasks').insert(payload).select().single()
      if (error) {
        showToast('Failed to create task. ' + error.message, 'error')
      } else {
        setTasks(prev => [data, ...prev])
        showToast('Task created.')
        closeModal()
      }
    }

    setSaving(false)
  }

  // ── Delete task ──────────────────────────────────────────
  const handleDelete = async (taskId) => {
    const prev = [...tasks]
    setTasks(t => t.filter(t => t.id !== taskId)) // optimistic
    setDeleteConfirm(null)

    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (error) {
      setTasks(prev) // rollback
      showToast('Failed to delete task.', 'error')
    } else {
      showToast('Task deleted.')
    }
  }

  // ── Inline status update ─────────────────────────────────
  const handleStatusChange = async (taskId, newStatus) => {
    const prev = tasks.find(t => t.id === taskId)
    setTasks(t => t.map(t => t.id === taskId ? { ...t, status: newStatus } : t))

    const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', taskId)
    if (error) {
      setTasks(t => t.map(t => t.id === taskId ? prev : t))
      showToast('Status update failed.', 'error')
    }
  }

  // ── Keyboard shortcut: N = new task ─────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'n' && !modalOpen &&
          document.activeElement.tagName !== 'INPUT' &&
          document.activeElement.tagName !== 'TEXTAREA') {
        openCreateModal()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [modalOpen])

  // ── Render ───────────────────────────────────────────────
  return (
    <main className={styles.main}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Stats bar */}
      <div className={styles.statsBar}>
        {[
          { label: 'Total',       value: stats.total,      key: 'all' },
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

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <input
          ref={searchRef}
          type="search"
          className={styles.search}
          placeholder="Search tasks or assignees…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search tasks"
        />
        <div className={styles.toolbarRight}>
          <span className={styles.hint} aria-hidden="true">Press N to create</span>
          <button className={styles.btnPrimary} onClick={openCreateModal}>
            + New task
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className={styles.errorState} role="alert">
          <strong>Failed to load tasks.</strong> {error}
          <button className={styles.retryBtn} onClick={fetchData}>Retry</button>
        </div>
      )}

      {/* Loading state */}
      {loading && !error && <SkeletonTable rows={8} cols={6} />}

      {/* Empty state */}
      {!loading && !error && filteredTasks.length === 0 && (
        <div className={styles.emptyState}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <p>{search || statusFilter !== 'all' ? 'No tasks match the current filter.' : 'No tasks have been created yet.'}</p>
          {statusFilter === 'all' && !search && (
            <button className={styles.btnPrimary} onClick={openCreateModal}>Create the first task</button>
          )}
        </div>
      )}

      {/* Task table */}
      {!loading && !error && filteredTasks.length > 0 && (
        <div className={styles.tableWrapper} role="region" aria-label="Task list">
          <table className={styles.table} aria-rowcount={filteredTasks.length}>
            <thead>
              <tr>
                {Object.entries(SORT_FIELDS).map(([field, label]) => (
                  <th
                    key={field}
                    className={styles.th}
                    onClick={() => handleSort(field)}
                    onKeyDown={e => e.key === 'Enter' && handleSort(field)}
                    tabIndex={0}
                    aria-sort={sortField === field ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    role="columnheader"
                  >
                    {label} {renderSortIcon(field)}
                  </th>
                ))}
                <th className={styles.th}>Deadline</th>
                <th className={`${styles.th} ${styles.thActions}`}>Actions</th>
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
                    aria-rowindex={idx + 1}
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
                      {task.assignee
                        ? `${task.assignee.first_name} ${task.assignee.last_name}`
                        : <span className={styles.unassigned}>Unassigned</span>
                      }
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
                      <select
                        className={styles.statusSelect}
                        value={task.status}
                        onChange={e => handleStatusChange(task.id, e.target.value)}
                        aria-label={`Status for ${task.title}`}
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                      </select>
                    </td>
                    <td className={styles.td}>
                      <StatusBadge status={overdue ? 'overdue' : task.status} />
                    </td>
                    <td className={styles.td}>
                      {formatDate(task.created_at)}
                    </td>
                    <td className={`${styles.td} ${styles.tdActions}`}>
                      <button
                        className={styles.actionBtn}
                        onClick={() => openEditModal(task)}
                        aria-label={`Edit ${task.title}`}
                        title="Edit"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button
                        className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                        onClick={() => setDeleteConfirm(task)}
                        aria-label={`Delete ${task.title}`}
                        title="Delete"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Row count */}
      {!loading && !error && filteredTasks.length > 0 && (
        <div className={styles.tableFooter} aria-live="polite">
          Showing {filteredTasks.length} of {tasks.length} tasks
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label={editTask ? 'Edit task' : 'New task'}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{editTask ? 'Edit task' : 'New task'}</h2>
              <button className={styles.modalClose} onClick={closeModal} aria-label="Close">✕</button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="m-title">Title *</label>
                <input
                  id="m-title" type="text"
                  className={`${styles.input} ${formErrors.title ? styles.inputError : ''}`}
                  value={formFields.title}
                  onChange={e => setFormFields(f => ({ ...f, title: e.target.value }))}
                  placeholder="Task title"
                  disabled={saving}
                />
                {formErrors.title && <span className={styles.fieldError}>{formErrors.title}</span>}
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="m-desc">Description</label>
                <textarea
                  id="m-desc"
                  className={styles.textarea}
                  value={formFields.description}
                  onChange={e => setFormFields(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional details…"
                  rows={3}
                  disabled={saving}
                />
              </div>

              <div className={styles.modalRow}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="m-assignee">Assignee *</label>
                  <select
                    id="m-assignee"
                    className={`${styles.input} ${formErrors.assigned_to ? styles.inputError : ''}`}
                    value={formFields.assigned_to}
                    onChange={e => setFormFields(f => ({ ...f, assigned_to: e.target.value }))}
                    disabled={saving}
                  >
                    <option value="">Select team member…</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>
                        {emp.first_name} {emp.last_name} ({emp.role})
                      </option>
                    ))}
                  </select>
                  {formErrors.assigned_to && <span className={styles.fieldError}>{formErrors.assigned_to}</span>}
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="m-deadline">Deadline *</label>
                  <input
                    id="m-deadline" type="date"
                    className={`${styles.input} ${formErrors.deadline ? styles.inputError : ''}`}
                    value={formFields.deadline}
                    onChange={e => setFormFields(f => ({ ...f, deadline: e.target.value }))}
                    min={new Date().toISOString().split('T')[0]}
                    disabled={saving}
                  />
                  {formErrors.deadline && <span className={styles.fieldError}>{formErrors.deadline}</span>}
                </div>
              </div>

              {editTask && (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="m-status">Status</label>
                  <select
                    id="m-status"
                    className={styles.input}
                    value={formFields.status}
                    onChange={e => setFormFields(f => ({ ...f, status: e.target.value }))}
                    disabled={saving}
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </select>
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.btnSecondary} onClick={closeModal} disabled={saving}>Cancel</button>
              <button className={styles.btnPrimary} onClick={handleSave} disabled={saving} aria-busy={saving}>
                {saving ? 'Saving…' : editTask ? 'Save changes' : 'Create task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-label="Confirm deletion">
          <div className={`${styles.modal} ${styles.modalSm}`}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Delete task</h2>
              <button className={styles.modalClose} onClick={() => setDeleteConfirm(null)} aria-label="Close">✕</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.deleteWarning}>
                Are you sure you want to delete <strong>"{deleteConfirm.title}"</strong>?
                This action cannot be undone.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnSecondary} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className={styles.btnDanger} onClick={() => handleDelete(deleteConfirm.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ── Team View ────────────────────────────────────────────────

function TeamView() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    const fetch = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, middle_name, last_name, username, role, date_of_joining, date_of_birth')
        .order('last_name')
      if (error) { setError(error.message) }
      else        { setMembers(data ?? []) }
      setLoading(false)
    }
    fetch()
  }, [])

  return (
    <main className={styles.main}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Team</h1>
        <span className={styles.pageSubtitle}>{members.length} members</span>
      </div>

      {error && <div className={styles.errorState} role="alert">{error}</div>}
      {loading && <SkeletonTable rows={5} cols={5} />}

      {!loading && !error && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Name</th>
                <th className={styles.th}>Username</th>
                <th className={styles.th}>Role</th>
                <th className={styles.th}>Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={m.id} className={`${styles.tr} ${i % 2 === 1 ? styles.trAlt : ''}`}>
                  <td className={styles.td}>
                    <div className={styles.memberName}>
                      <span className={styles.memberAvatar}>
                        {m.first_name?.[0]}{m.last_name?.[0]}
                      </span>
                      {m.first_name} {m.middle_name ? m.middle_name + ' ' : ''}{m.last_name}
                    </div>
                  </td>
                  <td className={styles.td}>{m.username}</td>
                  <td className={styles.td}>
                    <span className={`${styles.roleBadge} ${styles[`role_${m.role}`]}`}>
                      {{ admin: 'Administrator', manager: 'Project Manager', employee: 'Contributor' }[m.role]}
                    </span>
                  </td>
                  <td className={styles.td}>{formatDate(m.date_of_joining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
