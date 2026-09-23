// src/pages/Chat.jsx
// Messaging: public channels, group chats and direct messages.
//   /chat            conversation list (and the first channel on wide screens)
//   /chat/:channelId one conversation

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Navbar from '../components/Navbar'
import Toast from '../components/Toast'
import ChannelSidebar from '../components/chat/ChannelSidebar'
import MessageThread from '../components/chat/MessageThread'
import MembersPanel from '../components/chat/MembersPanel'
import { NewChannelModal, NewGroupModal, NewDmModal, EditChannelModal } from '../components/chat/ChatModals'
import { conversationTitle } from '../components/chat/chatUtils'
import {
  fetchOverview, fetchDirectory, markRead, openDirectMessage, createGroupChat,
  createPublicChannel, updateChannel,
} from '../lib/chat'
import styles from '../components/chat/Chat.module.css'

export default function Chat() {
  const { channelId } = useParams()
  const navigate = useNavigate()
  const { profile, isManager, isAdmin } = useAuth()

  const [overview,    setOverview]    = useState(null)  // null = loading
  const [directory,   setDirectory]   = useState([])
  const [error,       setError]       = useState(null)
  const [modal,       setModal]       = useState(null)  // 'channel' | 'group' | 'dm' | 'edit'
  const [membersOpen, setMembersOpen] = useState(false)
  const [toast,       setToast]       = useState(null)

  const showToast = useCallback((message, type = 'success') => setToast({ message, type }), [])

  const refreshOverview = useCallback(async () => {
    try {
      setOverview(await fetchOverview())
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // ── Load ─────────────────────────────────────────────────
  useEffect(() => {
    let active = true
    fetchOverview()
      .then(list => { if (active) { setOverview(list); setError(null) } })
      .catch(e => { if (active) setError(e.message) })
    fetchDirectory()
      .then(list => { if (active) setDirectory(list) })
      .catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])

  // Sidebar changes live: new messages (unread counts), new/renamed channels, membership changes.
  useEffect(() => {
    let timer
    const soon = () => { clearTimeout(timer); timer = setTimeout(refreshOverview, 300) }
    const live = supabase
      .channel('chat-overview')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_members' }, soon)
      .subscribe()
    return () => { clearTimeout(timer); supabase.removeChannel(live) }
  }, [refreshOverview])

  const directoryById = useMemo(() => new Map(directory.map(p => [p.id, p])), [directory])
  const active = overview?.find(c => c.id === channelId) ?? null

  // On wide screens /chat opens the first channel straight away.
  useEffect(() => {
    if (!overview || channelId) return
    if (!window.matchMedia('(min-width: 961px)').matches) return
    const first = overview.filter(c => !c.archived_at && c.type === 'public').sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''))[0]
      ?? overview.find(c => !c.archived_at)
    if (first) navigate(`/chat/${first.id}`, { replace: true })
  }, [overview, channelId, navigate])

  // ── Actions ──────────────────────────────────────────────
  const handleRead = useCallback(async (id) => {
    try { await markRead(id) } catch { /* not critical */ }
    setOverview(list => list?.map(c => (c.id === id ? { ...c, unread_count: 0 } : c)) ?? list)
  }, [])

  const go = async (id) => {
    await refreshOverview()
    navigate(`/chat/${id}`)
  }

  const handleNewChannel = async (values) => go(await createPublicChannel(values, profile.id))
  const handleNewGroup   = async (title, ids) => go(await createGroupChat(title, ids))
  const handleNewDm      = async (userId) => go(await openDirectMessage(userId))

  const handleSaveDetails = async (patch) => {
    await updateChannel(active.id, patch)
    await refreshOverview()
    showToast('Saved.')
  }

  const handleToggleArchive = async () => {
    const archiving = !active.archived_at
    const label = active.type === 'public' ? 'channel' : 'group'
    if (archiving && !window.confirm(`Archive this ${label}? It becomes read-only for everyone.`)) return
    try {
      await updateChannel(active.id, { archived_at: archiving ? new Date().toISOString() : null })
      await refreshOverview()
      showToast(archiving ? 'Archived.' : 'Restored.')
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const canManage = active
    ? (active.type === 'public' ? isManager : active.type === 'private' ? active.my_role === 'owner' : false)
    : false

  const layoutView = channelId ? 'thread' : 'list'

  return (
    <div className={styles.shell}>
      <Navbar />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <div className={styles.layout} data-view={layoutView}>
        {overview === null && !error && <div className={styles.centerState}>Loading conversations…</div>}
        {error && overview === null && (
          <div className={styles.centerState} role="alert">Could not load chat. {error}</div>
        )}

        {overview !== null && (
          <ChannelSidebar
            channels={overview}
            activeId={channelId}
            directoryById={directoryById}
            isManager={isManager}
            onNewChannel={() => setModal('channel')}
            onNewGroup={() => setModal('group')}
            onNewDm={() => setModal('dm')}
          />
        )}

        {overview !== null && (
          <section className={styles.threadArea} aria-label="Conversation">
            {!channelId && <div className={styles.centerState}>Choose a channel or start a conversation.</div>}
            {channelId && !active && (
              <div className={styles.centerState}>This conversation doesn&rsquo;t exist, or you don&rsquo;t have access to it.</div>
            )}
            {active && (
              <MessageThread
                key={active.id}
                channel={active}
                me={profile}
                directoryById={directoryById}
                isManager={isManager}
                title={conversationTitle(active, directoryById)}
                canManage={canManage}
                onRead={handleRead}
                onBack={() => navigate('/chat')}
                onToggleMembers={() => setMembersOpen(o => !o)}
                onEditDetails={() => setModal('edit')}
                onToggleArchive={handleToggleArchive}
                showToast={showToast}
              />
            )}
          </section>
        )}

        {active && active.type !== 'direct' && membersOpen && (
          <MembersPanel
            key={active.id}
            channel={active}
            me={profile}
            directory={directory}
            onClose={() => setMembersOpen(false)}
            onChanged={refreshOverview}
            onLeft={async () => { setMembersOpen(false); await refreshOverview(); navigate('/chat') }}
            showToast={showToast}
          />
        )}
      </div>

      {modal === 'channel' && <NewChannelModal onClose={() => setModal(null)} onCreate={handleNewChannel} isAdmin={isAdmin} />}
      {modal === 'group'   && <NewGroupModal people={directory} me={profile} onClose={() => setModal(null)} onCreate={handleNewGroup} />}
      {modal === 'dm'      && <NewDmModal people={directory} me={profile} onClose={() => setModal(null)} onPick={handleNewDm} />}
      {modal === 'edit' && active && <EditChannelModal channel={active} onClose={() => setModal(null)} onSave={handleSaveDetails} />}
    </div>
  )
}
