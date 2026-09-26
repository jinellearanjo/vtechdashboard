// src/components/chat/ChannelSidebar.jsx
// Channels (public), group chats (private) and direct messages, with unread badges.

import { Link } from 'react-router-dom'
import Avatar from '../Avatar'
import { conversationTitle } from './chatUtils'
import styles from './Chat.module.css'

function Row({ channel, active, title, icon, person }) {
  const unread = channel.unread_count
  return (
    <Link
      to={`/chat/${channel.id}`}
      className={[styles.convo, active ? styles.convoActive : '', unread > 0 ? styles.convoUnread : ''].join(' ')}
      aria-current={active ? 'page' : undefined}
    >
      {person !== undefined
        ? <Avatar person={person} size={24} />
        : <span className={styles.convoIcon} aria-hidden="true">{icon}</span>}
      <span className={styles.convoLabel}>{title}</span>
      {unread > 0 && (
        <span className={styles.unread} aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>
      )}
    </Link>
  )
}

const groupIcon = (title) =>
  title.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'G'

export default function ChannelSidebar({
  channels, activeId, directoryById, isManager, onNewChannel, onNewGroup, onNewDm,
}) {
  const titleOf = (c) => conversationTitle(c, directoryById)
  const byTitle = (a, b) => titleOf(a).localeCompare(titleOf(b))

  const live       = channels.filter(c => !c.archived_at)
  const openChans  = live.filter(c => c.type === 'public' && c.access === 'open').sort(byTitle)
  const depChans   = live.filter(c => c.type === 'public' && c.access === 'department').sort(byTitle)
  const groups     = live.filter(c => c.type === 'private')       // already newest activity first
  const dms        = live.filter(c => c.type === 'direct')
  const archived   = channels.filter(c => c.archived_at).sort(byTitle)

  return (
    <nav className={styles.sidebar} aria-label="Conversations">
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>Channels</span>
          {isManager && (
            <button type="button" className={styles.addBtn} onClick={onNewChannel} aria-label="Create a channel" title="Create a channel">+</button>
          )}
        </div>
        {openChans.length === 0 && <p className={styles.sidebarEmpty}>No channels yet.</p>}
        {openChans.map(c => (
          <Row key={c.id} channel={c} active={c.id === activeId} title={titleOf(c)} icon="#" />
        ))}
      </div>

      {depChans.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <span>Departments</span>
          </div>
          {depChans.map(c => (
            <Row key={c.id} channel={c} active={c.id === activeId} title={titleOf(c)} icon="🔒" />
          ))}
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>Group chats</span>
          <button type="button" className={styles.addBtn} onClick={onNewGroup} aria-label="Start a group chat" title="Start a group chat">+</button>
        </div>
        {groups.length === 0 && <p className={styles.sidebarEmpty}>No groups yet.</p>}
        {groups.map(c => (
          <Row key={c.id} channel={c} active={c.id === activeId} title={titleOf(c)} icon={groupIcon(titleOf(c))} />
        ))}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span>Direct messages</span>
          <button type="button" className={styles.addBtn} onClick={onNewDm} aria-label="New direct message" title="New direct message">+</button>
        </div>
        {dms.length === 0 && <p className={styles.sidebarEmpty}>No conversations yet.</p>}
        {dms.map(c => (
          <Row key={c.id} channel={c} active={c.id === activeId} title={titleOf(c)} person={directoryById.get(c.dm_user_id) ?? null} />
        ))}
      </div>

      {archived.length > 0 && (
        <details className={styles.archived}>
          <summary>Archived ({archived.length})</summary>
          <div className={styles.section}>
            {archived.map(c => (
              <Row key={c.id} channel={c} active={c.id === activeId} title={titleOf(c)} icon={c.type === 'public' ? '#' : groupIcon(titleOf(c))} />
            ))}
          </div>
        </details>
      )}
    </nav>
  )
}
