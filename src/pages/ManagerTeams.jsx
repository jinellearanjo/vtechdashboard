// src/pages/ManagerTeams.jsx
// Create teams, manage their members, delete empty teams. Managers and admins only (RLS).
// A task can be assigned to a team from the Tasks page; every member then sees it.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Toast from '../components/Toast'
import Avatar from '../components/Avatar'
import styles from './ManagerTeams.module.css'

export default function ManagerTeams() {
  const { profile } = useAuth()

  const [teams,   setTeams]   = useState([])
  const [people,  setPeople]  = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [newName, setNewName] = useState('')
  const [busy,    setBusy]    = useState(false)
  const [addSel,  setAddSel]  = useState({}) // teamId -> selected user id
  const [toast,   setToast]   = useState(null)

  const showToast = (message, type = 'success') => setToast({ message, type })

  const load = useCallback(async () => {
    const [teamsRes, peopleRes] = await Promise.all([
      supabase
        .from('teams')
        .select(`
          id, name, created_at,
          team_members(user_id, profile:profiles!team_members_user_id_fkey(id, first_name, last_name, role, avatar_path))
        `)
        .order('name'),
      supabase
        .from('profiles')
        .select('id, first_name, last_name, role, avatar_path')
        .order('first_name'),
    ])

    if (teamsRes.error)       setError(teamsRes.error.message)
    else if (peopleRes.error) setError(peopleRes.error.message)
    else {
      setTeams(teamsRes.data ?? [])
      setPeople(peopleRes.data ?? [])
    }
    setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { load() }, [load])

  const run = async (action, successMessage) => {
    setBusy(true)
    const { error: err } = await action()
    if (err) {
      showToast(friendlyError(err), 'error')
    } else {
      if (successMessage) showToast(successMessage)
      await load()
    }
    setBusy(false)
    return !err
  }

  const friendlyError = (err) => {
    if (err.code === '23505') return 'A team with that name already exists.'
    if (err.code === '23503') return 'This team still has tasks. Reassign or delete them first.'
    return err.message
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    const ok = await run(
      () => supabase.from('teams').insert({ name, created_by: profile.id }),
      `Team "${name}" created.`
    )
    if (ok) setNewName('')
  }

  const handleAddMember = (team) => {
    const userId = addSel[team.id]
    if (!userId) return
    return run(
      () => supabase.from('team_members').insert({ team_id: team.id, user_id: userId }),
      'Member added.'
    ).then(ok => { if (ok) setAddSel(s => ({ ...s, [team.id]: '' })) })
  }

  const handleRemoveMember = (team, member) =>
    run(
      () => supabase.from('team_members').delete().eq('team_id', team.id).eq('user_id', member.user_id),
      'Member removed.'
    )

  const handleDeleteTeam = (team) => {
    if (!window.confirm(`Delete the team "${team.name}"? Members are removed from it; tasks assigned to it must be reassigned first.`)) return
    return run(() => supabase.from('teams').delete().eq('id', team.id), 'Team deleted.')
  }

  return (
    <main className={styles.main}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Teams</h1>
        <span className={styles.pageSubtitle}>{teams.length} {teams.length === 1 ? 'team' : 'teams'}</span>
      </div>

      <form className={styles.createRow} onSubmit={handleCreate}>
        <label htmlFor="new-team" className={styles.srOnly}>New team name</label>
        <input
          id="new-team"
          className={styles.input}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="New team name"
          maxLength={60}
          disabled={busy}
        />
        <button type="submit" className={styles.btnPrimary} disabled={busy || !newName.trim()}>
          Create team
        </button>
      </form>

      {error   && <div className={styles.errorState} role="alert">{error}</div>}
      {loading && <p className={styles.muted}>Loading teams…</p>}
      {!loading && !error && teams.length === 0 && (
        <p className={styles.muted}>No teams yet. Create one above, then add members.</p>
      )}

      <div className={styles.grid}>
        {teams.map(team => {
          const memberIds = new Set(team.team_members.map(m => m.user_id))
          const available = people.filter(p => !memberIds.has(p.id))
          return (
            <section key={team.id} className={styles.card} aria-label={`Team ${team.name}`}>
              <header className={styles.cardHeader}>
                <div>
                  <h2 className={styles.teamName}>{team.name}</h2>
                  <span className={styles.muted}>
                    {team.team_members.length} {team.team_members.length === 1 ? 'member' : 'members'}
                  </span>
                </div>
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => handleDeleteTeam(team)}
                  disabled={busy}
                >
                  Delete
                </button>
              </header>

              {team.team_members.length === 0 ? (
                <p className={styles.emptyMembers}>No members yet.</p>
              ) : (
                <ul className={styles.members}>
                  {team.team_members.map(m => (
                    <li key={m.user_id} className={styles.member}>
                      <Avatar person={m.profile} size={28} />
                      <span className={styles.memberName}>
                        {m.profile ? `${m.profile.first_name} ${m.profile.last_name}` : 'Unknown user'}
                      </span>
                      <button
                        type="button"
                        className={styles.removeBtn}
                        onClick={() => handleRemoveMember(team, m)}
                        disabled={busy}
                        aria-label={`Remove ${m.profile?.first_name ?? 'member'} from ${team.name}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className={styles.addRow}>
                <select
                  className={styles.input}
                  value={addSel[team.id] ?? ''}
                  onChange={e => setAddSel(s => ({ ...s, [team.id]: e.target.value }))}
                  disabled={busy || available.length === 0}
                  aria-label={`Add a member to ${team.name}`}
                >
                  <option value="">{available.length ? 'Add a member…' : 'Everyone is in this team'}</option>
                  {available.map(p => (
                    <option key={p.id} value={p.id}>{p.first_name} {p.last_name} ({p.role})</option>
                  ))}
                </select>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => handleAddMember(team)}
                  disabled={busy || !addSel[team.id]}
                >
                  Add
                </button>
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}
