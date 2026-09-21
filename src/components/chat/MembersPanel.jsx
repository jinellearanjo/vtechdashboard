// src/components/chat/MembersPanel.jsx
// Who is in a channel or group. Group owners can add and remove people; anyone can leave a group.

import { useEffect, useState } from 'react'
import { fetchChannelMembers, addGroupMembers, removeGroupMember } from '../../lib/chat'
import Avatar from '../Avatar'
import { fullName } from './chatUtils'
import styles from './Chat.module.css'

export default function MembersPanel({ channel, me, directory, onClose, onChanged, onLeft, showToast }) {
  const [members,  setMembers]  = useState([])
  const [loaded,   setLoaded]   = useState(false)
  const [toAdd,    setToAdd]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [version,  setVersion]  = useState(0) // bump to reload after a change

  const isGroup = channel.type === 'private'
  const isOwner = isGroup && channel.my_role === 'owner' && !channel.archived_at

  useEffect(() => {
    let active = true
    fetchChannelMembers(channel.id)
      .then(list => { if (active) { setMembers(list); setLoaded(true) } })
      .catch(e => { if (active) showToast(e.message, 'error') })
    return () => { active = false }
  }, [channel.id, version, showToast])

  const memberIds = new Set(members.map(m => m.id))
  const candidates = directory.filter(p => !memberIds.has(p.id))

  const run = async (action, message) => {
    setBusy(true)
    try {
      await action()
      if (message) showToast(message)
      setVersion(v => v + 1)
      onChanged()
    } catch (e) {
      showToast(e.message, 'error')
    }
    setBusy(false)
  }

  const handleAdd = async () => {
    if (!toAdd) return
    await run(() => addGroupMembers(channel.id, [toAdd]), 'Person added.')
    setToAdd('')
  }

  const handleRemove = (member) => {
    if (!window.confirm(`Remove ${fullName(member)} from this group?`)) return
    return run(() => removeGroupMember(channel.id, member.id), 'Person removed.')
  }

  const handleLeave = async () => {
    if (!window.confirm('Leave this group? You will lose access to its messages.')) return
    setBusy(true)
    try {
      await removeGroupMember(channel.id, me.id)
      onLeft()
    } catch (e) {
      showToast(e.message, 'error')
      setBusy(false)
    }
  }

  return (
    <aside className={styles.members} aria-label="Members">
      <div className={styles.membersHeader}>
        <h2 className={styles.membersTitle}>Members{loaded ? ` (${members.length})` : ''}</h2>
        <button type="button" className={styles.btn} onClick={onClose}>Close</button>
      </div>

      {channel.type === 'public' && (
        <p className={styles.hint} style={{ padding: 'var(--space-3) var(--space-4) 0' }}>
          Everyone in the company is in public channels.
        </p>
      )}

      <ul className={styles.memberList}>
        {members.map(m => (
          <li key={m.id} className={styles.member}>
            <Avatar person={m} size={28} />
            <span className={styles.memberName}>{fullName(m)}{m.id === me.id ? ' (you)' : ''}</span>
            {m.role === 'owner' && isGroup && <span className={styles.ownerTag}>owner</span>}
            {isOwner && m.id !== me.id && (
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => handleRemove(m)} disabled={busy}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <div className={styles.membersSection}>
          <label className={styles.label} htmlFor="add-member">Add someone</label>
          <select id="add-member" className={styles.input} value={toAdd} onChange={e => setToAdd(e.target.value)} disabled={busy || candidates.length === 0}>
            <option value="">{candidates.length ? 'Choose a person…' : 'Everyone is already in'}</option>
            {candidates.map(p => <option key={p.id} value={p.id}>{fullName(p)}</option>)}
          </select>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleAdd} disabled={busy || !toAdd}>Add</button>
        </div>
      )}

      {isGroup && !channel.archived_at && (
        <div className={styles.membersSection}>
          <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={handleLeave} disabled={busy}>Leave group</button>
          <p className={styles.hint}>Only members can read a group. Managers and admins cannot.</p>
        </div>
      )}
    </aside>
  )
}
