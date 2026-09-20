// src/components/chat/ChatModals.jsx
// Dialogs: new public channel (managers), new group chat, new direct message, edit channel details.

import { useState } from 'react'
import Modal from '../Modal'
import { slugify } from '../../lib/chat'
import { fullName, initials } from './chatUtils'
import styles from './Chat.module.css'

function useSubmit(action, onDone) {
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await action()
      onDone()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return { busy, error, submit }
}

// ── New public channel ─────────────────────────────────────────
export function NewChannelModal({ onClose, onCreate }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const name = slugify(title)

  const { busy, error, submit } = useSubmit(
    () => onCreate({ name, title: title.trim(), description: description.trim() }),
    onClose
  )

  return (
    <Modal title="Create a channel" onClose={onClose}>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ch-title">Channel name</label>
          <input id="ch-title" className={styles.input} value={title} onChange={e => setTitle(e.target.value)} maxLength={60} required />
          <span className={styles.fieldHint}>
            {name ? <>Shown as <strong>#{name}</strong>. Everyone joins automatically.</> : 'Everyone joins public channels automatically.'}
          </span>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ch-desc">Description (optional)</label>
          <input id="ch-desc" className={styles.input} value={description} onChange={e => setDescription(e.target.value)} maxLength={200} />
        </div>
        {error && <div className={styles.formError} role="alert">{error}</div>}
        <div className={styles.formActions}>
          <button type="button" className={styles.btn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || !name}>
            {busy ? 'Creating…' : 'Create channel'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── People picker helper ───────────────────────────────────────
function useFiltered(people, me) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const list = people
    .filter(p => p.id !== me.id)
    .filter(p => !q || fullName(p).toLowerCase().includes(q))
  return { query, setQuery, list }
}

// ── New group chat ─────────────────────────────────────────────
export function NewGroupModal({ people, me, onClose, onCreate }) {
  const [title, setTitle]       = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const { query, setQuery, list } = useFiltered(people, me)

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const { busy, error, submit } = useSubmit(() => onCreate(title.trim(), [...selected]), onClose)

  return (
    <Modal title="Start a group chat" onClose={onClose}>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="grp-title">Group name</label>
          <input id="grp-title" className={styles.input} value={title} onChange={e => setTitle(e.target.value)} maxLength={60} required />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="grp-search">Add people ({selected.size} selected)</label>
          <input id="grp-search" className={styles.input} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name" />
          <ul className={styles.pickList}>
            {list.length === 0 && <li className={styles.sidebarEmpty} style={{ padding: 'var(--space-3)' }}>No one matches.</li>}
            {list.map(p => (
              <li key={p.id}>
                <label className={styles.pickItem}>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className={styles.avatar} aria-hidden="true">{initials(p)}</span>
                  <span>{fullName(p)}</span>
                  <span className={styles.pickRole}>{p.role}</span>
                </label>
              </li>
            ))}
          </ul>
          <span className={styles.fieldHint}>Only members can read a group. Managers and admins cannot.</span>
        </div>

        {error && <div className={styles.formError} role="alert">{error}</div>}
        <div className={styles.formActions}>
          <button type="button" className={styles.btn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || !title.trim() || selected.size === 0}>
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── New direct message ─────────────────────────────────────────
export function NewDmModal({ people, me, onClose, onPick }) {
  const { query, setQuery, list } = useFiltered(people, me)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const pick = async (person) => {
    setBusyId(person.id)
    setError(null)
    try {
      await onPick(person.id)
      onClose()
    } catch (e) {
      setError(e.message)
      setBusyId(null)
    }
  }

  return (
    <Modal title="New direct message" onClose={onClose}>
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="dm-search">Who do you want to message?</label>
          <input id="dm-search" className={styles.input} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name" />
        </div>
        <ul className={styles.pickList}>
          {list.length === 0 && <li className={styles.sidebarEmpty} style={{ padding: 'var(--space-3)' }}>No one matches.</li>}
          {list.map(p => (
            <li key={p.id}>
              <button type="button" className={styles.pickItem} onClick={() => pick(p)} disabled={busyId !== null}>
                <span className={styles.avatar} aria-hidden="true">{initials(p)}</span>
                <span>{fullName(p)}</span>
                <span className={styles.pickRole}>{busyId === p.id ? 'Opening…' : p.role}</span>
              </button>
            </li>
          ))}
        </ul>
        {error && <div className={styles.formError} role="alert">{error}</div>}
      </div>
    </Modal>
  )
}

// ── Edit channel / group details ───────────────────────────────
export function EditChannelModal({ channel, onClose, onSave }) {
  const isPublic = channel.type === 'public'
  const [title, setTitle] = useState(channel.title ?? '')
  const [description, setDescription] = useState(channel.description ?? '')

  const { busy, error, submit } = useSubmit(
    () => onSave({
      title: title.trim(),
      ...(isPublic ? { description: description.trim() || null } : {}),
    }),
    onClose
  )

  return (
    <Modal title={isPublic ? 'Edit channel' : 'Rename group'} onClose={onClose}>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="edit-title">Name</label>
          <input id="edit-title" className={styles.input} value={title} onChange={e => setTitle(e.target.value)} maxLength={60} required />
        </div>
        {isPublic && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="edit-desc">Description</label>
            <input id="edit-desc" className={styles.input} value={description} onChange={e => setDescription(e.target.value)} maxLength={200} />
          </div>
        )}
        {error && <div className={styles.formError} role="alert">{error}</div>}
        <div className={styles.formActions}>
          <button type="button" className={styles.btn} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || !title.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
