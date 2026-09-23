// src/pages/AdminPanel.jsx
// Full admin panel. Accessible only to users with role = 'admin'.
// Tabs: Users, Invite Codes, Audit Log, Export.

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import SkeletonTable from '../components/SkeletonTable'
import Toast from '../components/Toast'
import { formatDate, formatDateTime } from '../lib/dateUtils'
import {
  fetchAllDepartmentAccess, decideDepartmentAccess, grantDepartmentAccess, revokeDepartmentAccess,
} from '../lib/departments'
import styles from './AdminPanel.module.css'

const TABS = [
  { key: 'users',       label: 'Users' },
  { key: 'invites',     label: 'Invite Codes' },
  { key: 'departments', label: 'Departments' },
  { key: 'audit',       label: 'Audit Log' },
  { key: 'export',      label: 'Data Export' },
]

const ROLE_LABELS = {
  admin:    'Administrator',
  manager:  'Project Manager',
  employee: 'Contributor',
}

export default function AdminPanel() {
  const [tab,   setTab]   = useState('users')
  const [toast, setToast] = useState(null)

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
  }, [])

  return (
    <div className={styles.shell}>
      <Navbar />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <main className={styles.main}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Admin Panel</h1>
          <p className={styles.pageSubtitle}>System configuration and oversight</p>
        </div>

        {/* Tab bar */}
        <div className={styles.tabBar} role="tablist" aria-label="Admin sections">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        <div role="tabpanel" aria-label={TABS.find(t => t.key === tab)?.label}>
          {tab === 'users'   && <UsersTab   showToast={showToast} />}
          {tab === 'invites'     && <InvitesTab     showToast={showToast} />}
          {tab === 'departments' && <DepartmentsTab showToast={showToast} />}
          {tab === 'audit'       && <AuditTab />}
          {tab === 'export'  && <ExportTab  showToast={showToast} />}
        </div>
      </main>
    </div>
  )
}

// ── Users Tab ────────────────────────────────────────────────

function UsersTab({ showToast }) {
  const { profile: self } = useAuth()
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [search,  setSearch]  = useState('')
  const [changing, setChanging] = useState(null) // id being updated

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, middle_name, last_name, username, role, is_legacy, date_of_joining')
      .order('last_name')
    if (error) setError(error.message)
    else       setUsers(data ?? [])
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount / dependency change
  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleRoleChange = async (userId, newRole) => {
    if (userId === self.id) {
      showToast('You cannot change your own role.', 'error')
      return
    }
    setChanging(userId)
    const { data, error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', userId)
      .select('id')

    if (error) {
      showToast('Role update failed. ' + error.message, 'error')
    } else if (!data?.length) {
      showToast('Role update was not applied (permission denied).', 'error')
    } else {
      setUsers(u => u.map(u => u.id === userId ? { ...u, role: newRole } : u))
      showToast('Role updated.')
    }
    setChanging(null)
  }

  const filtered = users.filter(u => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      u.first_name?.toLowerCase().includes(q) ||
      u.last_name?.toLowerCase().includes(q)  ||
      u.username?.toLowerCase().includes(q)
    )
  })

  return (
    <div className={styles.tabContent}>
      <div className={styles.toolbar}>
        <input
          type="search"
          className={styles.search}
          placeholder="Search users…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search users"
        />
        <span className={styles.count}>{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {error   && <div className={styles.errorState} role="alert">{error}</div>}
      {loading && <SkeletonTable rows={6} cols={5} />}

      {!loading && !error && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Name</th>
                <th className={styles.th}>Username</th>
                <th className={styles.th}>Role</th>
                <th className={styles.th}>Type</th>
                <th className={styles.th}>Joined</th>
                <th className={styles.th}>Change role</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={u.id} className={`${styles.tr} ${i % 2 === 1 ? styles.trAlt : ''}`}>
                  <td className={styles.td}>
                    <div className={styles.nameCell}>
                      <span className={styles.avatar}>
                        {u.first_name?.[0]}{u.last_name?.[0]}
                      </span>
                      <span>
                        {u.first_name} {u.middle_name ? u.middle_name[0] + '. ' : ''}{u.last_name}
                        {u.id === self.id && <span className={styles.selfTag}> (you)</span>}
                      </span>
                    </div>
                  </td>
                  <td className={styles.td}>{u.username}</td>
                  <td className={styles.td}>
                    <span className={`${styles.roleBadge} ${styles[`role_${u.role}`]}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className={styles.td}>
                    <span className={u.is_legacy ? styles.legacyTag : styles.standardTag}>
                      {u.is_legacy ? 'Legacy' : 'Standard'}
                    </span>
                  </td>
                  <td className={styles.td}>{formatDate(u.date_of_joining)}</td>
                  <td className={styles.td}>
                    <select
                      className={styles.roleSelect}
                      value={u.role}
                      onChange={e => handleRoleChange(u.id, e.target.value)}
                      disabled={changing === u.id || u.id === self.id}
                      aria-label={`Change role for ${u.first_name} ${u.last_name}`}
                    >
                      <option value="employee">Contributor</option>
                      <option value="manager">Project Manager</option>
                      <option value="admin">Administrator</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Invites Tab ──────────────────────────────────────────────

function InvitesTab({ showToast }) {
  const { profile } = useAuth()
  const [invites,  setInvites]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [creating, setCreating] = useState(false)
  const [form,     setForm]     = useState({ role: 'manager', expires_in: '7', single_use: true })

  const fetchInvites = useCallback(async () => {
    setLoading(true)
    // Admin reads via service role — use anon key but admin RLS allows this
    // In production, route through an Edge Function for strict separation
    const { data, error } = await supabase
      .from('invite_codes')
      .select(`
        id, code, role, single_use, expires_at, created_at,
        used_by, used_at,
        creator:profiles!invite_codes_created_by_fkey(first_name, last_name),
        user:profiles!invite_codes_used_by_fkey(first_name, last_name)
      `)
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else       setInvites(data ?? [])
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount / dependency change
  useEffect(() => { fetchInvites() }, [fetchInvites])

  const generateCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const bytes = crypto.getRandomValues(new Uint8Array(8))
    return Array.from(bytes, b => chars[b % chars.length]).join('') // 256 % 32 === 0, so no modulo bias
  }

  const handleCreate = async () => {
    setCreating(true)
    const code       = generateCode()
    const expires_at = form.expires_in
      ? new Date(Date.now() + parseInt(form.expires_in) * 86400000).toISOString()
      : null

    const { error } = await supabase.from('invite_codes').insert({
      code,
      role:       form.role,
      single_use: form.single_use,
      expires_at,
      created_by: profile.id,
    })

    if (error) {
      showToast('Failed to create invite code.', 'error')
    } else {
      showToast(`Code created: ${code}`)
      fetchInvites()
    }
    setCreating(false)
  }

  const handleRevoke = async (id) => {
    const { error } = await supabase
      .from('invite_codes')
      .update({ expires_at: new Date().toISOString() })
      .eq('id', id)

    if (error) showToast('Failed to revoke code.', 'error')
    else { showToast('Code revoked.'); fetchInvites() }
  }

  const isExpired = (code) => {
    if (!code.expires_at) return false
    return new Date(code.expires_at) < new Date()
  }

  const isUsed = (code) => code.single_use && code.used_by !== null

  const getCodeStatus = (code) => {
    if (isUsed(code))    return { label: 'Used',    cls: styles.codeUsed }
    if (isExpired(code)) return { label: 'Expired', cls: styles.codeExpired }
    return                      { label: 'Active',  cls: styles.codeActive }
  }

  return (
    <div className={styles.tabContent}>

      {/* Create form */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Generate invite code</h2>
        <div className={styles.createRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="inv-role">Role</label>
            <select
              id="inv-role"
              className={styles.input}
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            >
              <option value="manager">Project Manager</option>
              <option value="admin">Administrator</option>
              <option value="employee">Contributor</option>
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="inv-expires">Expires in (days)</label>
            <input
              id="inv-expires"
              type="number"
              min="1"
              max="365"
              className={styles.input}
              value={form.expires_in}
              onChange={e => setForm(f => ({ ...f, expires_in: e.target.value }))}
              placeholder="Leave blank = never"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="inv-single">Single use</label>
            <select
              id="inv-single"
              className={styles.input}
              value={form.single_use ? 'yes' : 'no'}
              onChange={e => setForm(f => ({ ...f, single_use: e.target.value === 'yes' }))}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>

          <button
            className={styles.btnPrimary}
            onClick={handleCreate}
            disabled={creating}
            aria-busy={creating}
            style={{ alignSelf: 'flex-end' }}
          >
            {creating ? 'Generating…' : 'Generate code'}
          </button>
        </div>
      </div>

      {error   && <div className={styles.errorState} role="alert">{error}</div>}
      {loading && <SkeletonTable rows={4} cols={6} />}

      {!loading && !error && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Code</th>
                <th className={styles.th}>Role</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>Single use</th>
                <th className={styles.th}>Expires</th>
                <th className={styles.th}>Used by</th>
                <th className={styles.th}>Created</th>
                <th className={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv, i) => {
                const status = getCodeStatus(inv)
                const active = !isUsed(inv) && !isExpired(inv)
                return (
                  <tr key={inv.id} className={`${styles.tr} ${i % 2 === 1 ? styles.trAlt : ''}`}>
                    <td className={styles.td}>
                      <code className={styles.codeText}>{inv.code}</code>
                    </td>
                    <td className={styles.td}>
                      <span className={`${styles.roleBadge} ${styles[`role_${inv.role}`]}`}>
                        {ROLE_LABELS[inv.role]}
                      </span>
                    </td>
                    <td className={styles.td}>
                      <span className={`${styles.codeStatus} ${status.cls}`}>{status.label}</span>
                    </td>
                    <td className={styles.td}>{inv.single_use ? 'Yes' : 'No'}</td>
                    <td className={styles.td}>{inv.expires_at ? formatDate(inv.expires_at) : '—'}</td>
                    <td className={styles.td}>
                      {inv.user
                        ? `${inv.user.first_name} ${inv.user.last_name}`
                        : '—'}
                    </td>
                    <td className={styles.td}>{formatDate(inv.created_at)}</td>
                    <td className={styles.td}>
                      {active && (
                        <button
                          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                          onClick={() => handleRevoke(inv.id)}
                          aria-label={`Revoke code ${inv.code}`}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Audit Log Tab ────────────────────────────────────────────

function DepartmentsTab({ showToast }) {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [busyKey, setBusyKey] = useState(null)
  const [filter,  setFilter]  = useState('pending')

  const fmtName = (p) => p ? `${p.first_name} ${p.last_name}` : 'Former user'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await fetchAllDepartmentAccess())
      setError(null)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { load() }, [load])

  const run = async (key, action, message) => {
    setBusyKey(key)
    try {
      await action()
      showToast(message)
      await load()
    } catch (e) {
      showToast(e.message, 'error')
    }
    setBusyKey(null)
  }

  const visible = rows.filter(r => filter === 'all' || r.status === filter)

  return (
    <div>
      <div className={styles.toolbar}>
        <select className={styles.select} value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="all">All</option>
        </select>
      </div>

      {error && <div className={styles.errorState} role="alert">{error}</div>}
      {loading ? (
        <SkeletonTable rows={4} cols={5} />
      ) : visible.length === 0 ? (
        <p className={styles.emptyState}>No {filter === 'all' ? '' : filter} requests.</p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Department</th>
                <th>Status</th>
                <th>Requested</th>
                <th>Decided by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const key = `${r.user_id}:${r.channel_id}`
                const busy = busyKey === key
                return (
                  <tr key={key}>
                    <td>{fmtName(r.user)}</td>
                    <td>{r.channel?.title ?? r.channel?.name}</td>
                    <td>
                      <span className={`${styles.badge} ${styles[`badge_${r.status}`]}`}>{r.status}</span>
                    </td>
                    <td>{formatDateTime(r.requested_at)}</td>
                    <td>{r.decider ? fmtName(r.decider) : '—'}</td>
                    <td className={styles.actionsCell}>
                      {r.status === 'pending' && (
                        <>
                          <button
                            type="button" className={styles.linkBtn} disabled={busy}
                            onClick={() => run(key, () => decideDepartmentAccess(r.user_id, r.channel_id, true), 'Approved.')}
                          >
                            Approve
                          </button>
                          <button
                            type="button" className={styles.linkBtnDanger} disabled={busy}
                            onClick={() => run(key, () => decideDepartmentAccess(r.user_id, r.channel_id, false), 'Denied.')}
                          >
                            Deny
                          </button>
                        </>
                      )}
                      {r.status === 'approved' && (
                        <button
                          type="button" className={styles.linkBtnDanger} disabled={busy}
                          onClick={() => run(key, () => revokeDepartmentAccess(r.user_id, r.channel_id), 'Access revoked.')}
                        >
                          Revoke
                        </button>
                      )}
                      {r.status === 'denied' && (
                        <button
                          type="button" className={styles.linkBtn} disabled={busy}
                          onClick={() => run(key, () => grantDepartmentAccess(r.user_id, r.channel_id), 'Access granted.')}
                        >
                          Grant anyway
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function AuditTab() {
  const [logs,    setLogs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [page,    setPage]    = useState(0)
  const PAGE_SIZE = 50

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('audit_log')
      .select(`
        id, action, entity, entity_id, delta, created_at,
        performer:profiles!audit_log_performed_by_fkey(first_name, last_name, username)
      `)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error) setError(error.message)
    else       setLogs(data ?? [])
    setLoading(false)
  }, [page])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount / dependency change
  useEffect(() => { fetchLogs() }, [fetchLogs])

  return (
    <div className={styles.tabContent}>
      <p className={styles.tabNote}>
        Showing {PAGE_SIZE} most recent entries. All entries are immutable.
      </p>

      {error   && <div className={styles.errorState} role="alert">{error}</div>}
      {loading && <SkeletonTable rows={8} cols={5} />}

      {!loading && !error && logs.length === 0 && (
        <div className={styles.emptyState}>No audit log entries yet.</div>
      )}

      {!loading && !error && logs.length > 0 && (
        <>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Timestamp</th>
                  <th className={styles.th}>User</th>
                  <th className={styles.th}>Action</th>
                  <th className={styles.th}>Entity</th>
                  <th className={styles.th}>Delta</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr key={log.id} className={`${styles.tr} ${i % 2 === 1 ? styles.trAlt : ''}`}>
                    <td className={styles.td}>
                      <span className={styles.mono}>{formatDateTime(log.created_at)}</span>
                    </td>
                    <td className={styles.td}>
                      {log.performer
                        ? `${log.performer.first_name} ${log.performer.last_name}`
                        : <span className={styles.muted}>System</span>}
                    </td>
                    <td className={styles.td}>
                      <span className={`${styles.actionTag} ${styles[`action_${log.action}`] ?? styles.action_default}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className={styles.td}>
                      <span className={styles.mono}>{log.entity}</span>
                      {log.entity_id && (
                        <span className={`${styles.mono} ${styles.muted}`}> {log.entity_id.slice(0, 8)}…</span>
                      )}
                    </td>
                    <td className={styles.td}>
                      {log.delta
                        ? <code className={styles.delta}>{JSON.stringify(log.delta, null, 0)}</code>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.pagination}>
            <button
              className={styles.pageBtn}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              ← Previous
            </button>
            <span className={styles.pageInfo}>Page {page + 1}</span>
            <button
              className={styles.pageBtn}
              onClick={() => setPage(p => p + 1)}
              disabled={logs.length < PAGE_SIZE}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Export Tab ───────────────────────────────────────────────

function ExportTab({ showToast }) {
  const [exporting, setExporting] = useState(null)

  const toCSV = (rows, columns) => {
    const header = columns.join(',')
    const body   = rows.map(row =>
      columns.map(col => {
        const val = row[col] ?? ''
        let str = typeof val === 'object' ? JSON.stringify(val) : String(val)
        if (/^[=+\-@\t\r]/.test(str)) str = `'${str}` // neutralise spreadsheet formulas
        return `"${str.replace(/"/g, '""')}"`
      }).join(',')
    ).join('\n')
    return `${header}\n${body}`
  }

  const downloadCSV = (content, filename) => {
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadJSON = (data, filename) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExport = async (type) => {
    setExporting(type)

    try {
      if (type === 'tasks-csv') {
        const { data, error } = await supabase
          .from('tasks')
          .select('id, title, description, status, deadline, created_at, assigned_to, team_id, assigned_by')
          .order('created_at', { ascending: false })
        if (error) throw error
        const csv = toCSV(data, ['id','title','description','status','deadline','created_at','assigned_to','team_id','assigned_by'])
        downloadCSV(csv, `tasks-export-${formatDate(new Date().toISOString())}.csv`)
        showToast('Tasks exported.')
      }

      else if (type === 'users-csv') {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, username, first_name, middle_name, last_name, role, is_legacy, date_of_joining')
          .order('last_name')
        if (error) throw error
        const csv = toCSV(data, ['id','username','first_name','middle_name','last_name','role','is_legacy','date_of_joining'])
        downloadCSV(csv, `users-export-${formatDate(new Date().toISOString())}.csv`)
        showToast('Users exported.')
      }

      else if (type === 'audit-json') {
        const { data, error } = await supabase
          .from('audit_log')
          .select('*')
          .order('created_at', { ascending: false })
        if (error) throw error
        downloadJSON(data, `audit-log-${formatDate(new Date().toISOString())}.json`)
        showToast('Audit log exported.')
      }

      else if (type === 'full-json') {
        const [tasks, users, audit] = await Promise.all([
          supabase.from('tasks').select('*').order('created_at', { ascending: false }),
          supabase.from('profiles').select('id, username, first_name, last_name, role, date_of_joining').order('last_name'),
          supabase.from('audit_log').select('*').order('created_at', { ascending: false }),
        ])
        if (tasks.error || users.error || audit.error) throw new Error('Partial export failure')
        downloadJSON({ tasks: tasks.data, users: users.data, audit_log: audit.data },
          `full-export-${formatDate(new Date().toISOString())}.json`)
        showToast('Full export complete.')
      }

    } catch (err) {
      showToast('Export failed. ' + err.message, 'error')
    }

    setExporting(null)
  }

  const exports = [
    { key: 'tasks-csv',  label: 'Tasks',          format: 'CSV',  desc: 'All tasks with status, deadline, and assignments.' },
    { key: 'users-csv',  label: 'Users',           format: 'CSV',  desc: 'All user profiles. Excludes date of birth.' },
    { key: 'audit-json', label: 'Audit Log',       format: 'JSON', desc: 'Full immutable audit trail.' },
    { key: 'full-json',  label: 'Complete Export', format: 'JSON', desc: 'All of the above in a single structured file.' },
  ]

  return (
    <div className={styles.tabContent}>
      <p className={styles.tabNote}>
        All exports are generated client-side from live data.
        No data leaves the system other than your direct download.
      </p>

      <div className={styles.exportGrid}>
        {exports.map(exp => (
          <div key={exp.key} className={styles.exportCard}>
            <div className={styles.exportInfo}>
              <div className={styles.exportHeader}>
                <span className={styles.exportLabel}>{exp.label}</span>
                <span className={styles.exportFormat}>{exp.format}</span>
              </div>
              <p className={styles.exportDesc}>{exp.desc}</p>
            </div>
            <button
              className={styles.btnPrimary}
              onClick={() => handleExport(exp.key)}
              disabled={!!exporting}
              aria-busy={exporting === exp.key}
            >
              {exporting === exp.key ? 'Exporting…' : 'Download'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
