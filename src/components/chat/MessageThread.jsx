// src/components/chat/MessageThread.jsx
// One conversation: header, message list (realtime), composer, edit and delete.
// Mount it with key={channel.id} so switching conversations starts from a clean state.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import {
  MAX_MESSAGE_LENGTH, PAGE_SIZE, fetchMessages, sendMessage, editMessage, deleteMessage,
  fetchReactions, addReaction, removeReaction,
} from '../../lib/chat'
import Avatar from '../Avatar'
import EmojiPicker from './EmojiPicker'
import { fullName, splitLinks, formatClock, groupMessages, upsertMessage } from './chatUtils'
import styles from './Chat.module.css'

function MessageText({ text }) {
  return splitLinks(text).map((part, i) =>
    part.type === 'link'
      ? <a key={i} href={part.value} target="_blank" rel="noopener noreferrer">{part.value}</a>
      : part.value
  )
}

// reactions state shape: { [messageId]: [{ user_id, emoji }] }
function groupReactions(rows) {
  const out = {}
  for (const r of rows) (out[r.message_id] ??= []).push({ user_id: r.user_id, emoji: r.emoji })
  return out
}
function addToGroup(state, r) {
  const list = state[r.message_id] ?? []
  if (list.some(x => x.user_id === r.user_id && x.emoji === r.emoji)) return state
  return { ...state, [r.message_id]: [...list, { user_id: r.user_id, emoji: r.emoji }] }
}
function removeFromGroup(state, r) {
  const list = state[r.message_id]
  if (!list) return state
  return { ...state, [r.message_id]: list.filter(x => !(x.user_id === r.user_id && x.emoji === r.emoji)) }
}
// [{ emoji, count, mine }] sorted by first-used order
function summarizeReactions(list, meId) {
  const order = []
  const counts = new Map()
  for (const r of list ?? []) {
    if (!counts.has(r.emoji)) { counts.set(r.emoji, { count: 0, mine: false }); order.push(r.emoji) }
    const entry = counts.get(r.emoji)
    entry.count++
    if (r.user_id === meId) entry.mine = true
  }
  return order.map(emoji => ({ emoji, ...counts.get(emoji) }))
}

export default function MessageThread({
  channel, me, directoryById, isManager, title, canManage,
  onRead, onBack, onToggleMembers, onEditDetails, onToggleArchive, showToast,
}) {
  const [messages,     setMessages]     = useState([])
  const [loaded,       setLoaded]       = useState(false)
  const [loadError,    setLoadError]    = useState(null)
  const [hasMore,      setHasMore]      = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [draft,        setDraft]        = useState('')
  const [sending,      setSending]      = useState(false)
  const [editing,      setEditing]      = useState(null) // { id, text }
  const [showJump,     setShowJump]     = useState(false)
  const [reactions,    setReactions]    = useState({}) // messageId -> [{ user_id, emoji }]
  const [openPicker,   setOpenPicker]   = useState(null) // message id whose reaction picker is open
  const [composerPickerOpen, setComposerPickerOpen] = useState(false)

  const listRef     = useRef(null)
  const stickRef    = useRef(true)   // keep the view pinned to the newest message
  const preserveRef = useRef(null)   // scrollHeight before older messages were added
  const textareaRef = useRef(null)
  const messageIdsRef = useRef(new Set()) // kept fresh below; read by the reactions subscription

  const archived = Boolean(channel.archived_at)

  // ── Initial load ───────────────────────────────────────────
  useEffect(() => {
    let active = true
    fetchMessages(channel.id)
      .then(async list => {
        if (!active) return
        setMessages(list)
        setHasMore(list.length === PAGE_SIZE)
        setLoaded(true)
        onRead(channel.id)
        const r = await fetchReactions(list.map(m => m.id))
        if (active) setReactions(groupReactions(r))
      })
      .catch(e => { if (active) setLoadError(e.message) })
    return () => { active = false }
  }, [channel.id, onRead])

  // ── Realtime: new, edited and deleted messages in this conversation ──
  useEffect(() => {
    const live = supabase
      .channel(`thread-${channel.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channel.id}` },
        ({ new: m }) => {
          setMessages(list => upsertMessage(list, m))
          if (!stickRef.current) setShowJump(true)
          if (m.sender_id !== me.id) onRead(channel.id)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${channel.id}` },
        ({ new: m }) => setMessages(list => upsertMessage(list, m))
      )
      .subscribe()

    // Reactions have no channel_id column, so this listens globally and ignores anything for a
    // message that isn't part of this thread (checked against the ref below, kept fresh every render).
    const reactionsChannel = supabase
      .channel(`reactions-${channel.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, ({ new: r }) => {
        if (!messageIdsRef.current.has(r.message_id)) return
        setReactions(prev => addToGroup(prev, r))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, ({ old: r }) => {
        if (!messageIdsRef.current.has(r.message_id)) return
        setReactions(prev => removeFromGroup(prev, r))
      })
      .subscribe()

    return () => { supabase.removeChannel(live); supabase.removeChannel(reactionsChannel) }
  }, [channel.id, me.id, onRead])

  useEffect(() => { messageIdsRef.current = new Set(messages.map(m => m.id)) }, [messages])

  // ── Scrolling ──────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (preserveRef.current !== null) {
      el.scrollTop = el.scrollHeight - preserveRef.current
      preserveRef.current = null
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, loaded])

  const handleScroll = () => {
    const el = listRef.current
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    stickRef.current = nearBottom
    setShowJump(prev => (prev === !nearBottom ? prev : !nearBottom))
  }

  const jumpToLatest = () => {
    const el = listRef.current
    stickRef.current = true
    el.scrollTop = el.scrollHeight
    setShowJump(false)
  }

  const loadOlder = async () => {
    if (loadingOlder || messages.length === 0) return
    setLoadingOlder(true)
    try {
      const older = await fetchMessages(channel.id, { before: messages[0].created_at })
      preserveRef.current = listRef.current.scrollHeight
      setMessages(list => older.reduce(upsertMessage, list))
      setHasMore(older.length === PAGE_SIZE)
    } catch (e) {
      showToast(e.message, 'error')
    }
    setLoadingOlder(false)
  }

  // ── Sending ────────────────────────────────────────────────
  const resizeComposer = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || sending || archived) return
    if (text.length > MAX_MESSAGE_LENGTH) {
      showToast(`Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`, 'error')
      return
    }
    setSending(true)
    try {
      const sent = await sendMessage(channel.id, me.id, text)
      stickRef.current = true
      setMessages(list => upsertMessage(list, sent))
      setDraft('')
      requestAnimationFrame(resizeComposer)
    } catch (e) {
      showToast(e.message, 'error')
    }
    setSending(false)
    textareaRef.current?.focus()
  }

  const handleComposerKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Edit / delete ──────────────────────────────────────────
  const saveEdit = async () => {
    const text = editing.text.trim()
    if (!text) { showToast('A message cannot be empty. Delete it instead.', 'error'); return }
    try {
      const updated = await editMessage(editing.id, text)
      setMessages(list => upsertMessage(list, updated))
      setEditing(null)
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  const handleDelete = async (m) => {
    if (!window.confirm('Delete this message? This cannot be undone.')) return
    try {
      const updated = await deleteMessage(m.id)
      setMessages(list => upsertMessage(list, updated))
    } catch (e) {
      showToast(e.message, 'error')
    }
  }

  // ── Reactions ────────────────────────────────────────────────
  const toggleReaction = async (messageId, emoji) => {
    const mine = (reactions[messageId] ?? []).some(r => r.user_id === me.id && r.emoji === emoji)
    setOpenPicker(null)
    // optimistic
    setReactions(prev => mine
      ? removeFromGroup(prev, { message_id: messageId, user_id: me.id, emoji })
      : addToGroup(prev, { message_id: messageId, user_id: me.id, emoji }))
    try {
      if (mine) await removeReaction(messageId, me.id, emoji)
      else await addReaction(messageId, me.id, emoji)
    } catch (e) {
      // roll back on failure
      setReactions(prev => mine
        ? addToGroup(prev, { message_id: messageId, user_id: me.id, emoji })
        : removeFromGroup(prev, { message_id: messageId, user_id: me.id, emoji }))
      showToast(e.message, 'error')
    }
  }

  const items = useMemo(() => groupMessages(messages), [messages])
  const memberLabel = channel.type === 'direct' ? null : `${channel.member_count} ${channel.member_count === 1 ? 'member' : 'members'}`

  const handleEditKeyDown = useCallback((e) => {
    if (e.key === 'Escape') setEditing(null)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); saveEdit() }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- saveEdit closes over `editing`, which is what changes
  }, [editing])

  return (
    <>
      <header className={styles.threadHeader}>
        <div className={styles.headerMain}>
          <h1 className={styles.threadTitle}>
            {channel.type === 'public' ? '# ' : ''}{title}
          </h1>
          {channel.type === 'public' && channel.description && (
            <p className={styles.threadDesc}>{channel.description}</p>
          )}
          {channel.type === 'private' && <p className={styles.threadDesc}>Group chat · {memberLabel}</p>}
          {channel.type === 'direct'  && <p className={styles.threadDesc}>Direct message</p>}
        </div>

        <div className={styles.headerActions}>
          <button type="button" className={styles.backBtn} onClick={onBack}>&larr; All chats</button>
          {canManage && (
            <>
              <button type="button" className={styles.btn} onClick={onEditDetails}>Edit</button>
              <button type="button" className={styles.btn} onClick={onToggleArchive}>
                {archived ? 'Restore' : 'Archive'}
              </button>
            </>
          )}
          {channel.type !== 'direct' && (
            <button type="button" className={styles.btn} onClick={onToggleMembers}>{memberLabel}</button>
          )}
        </div>
      </header>

      {archived && <div className={styles.notice}>This conversation is archived. You can read it but not post.</div>}

      <div className={styles.listWrap}>
        <div className={styles.list} ref={listRef} onScroll={handleScroll} aria-live="polite" aria-label="Messages">
          {loadError && <p className={styles.empty} role="alert">Could not load messages. {loadError}</p>}
          {!loaded && !loadError && <p className={styles.empty}>Loading messages…</p>}
          {loaded && messages.length === 0 && (
            <p className={styles.empty}>No messages yet. Say hello.</p>
          )}

          {loaded && hasMore && (
            <button type="button" className={`${styles.btn} ${styles.olderBtn}`} onClick={loadOlder} disabled={loadingOlder}>
              {loadingOlder ? 'Loading…' : 'Load older messages'}
            </button>
          )}

          {items.map(item => {
            if (item.type === 'day') {
              return <div key={item.key} className={styles.dayDivider}>{item.label}</div>
            }

            const m = item.message
            const sender = directoryById.get(m.sender_id)
            const mine = m.sender_id === me.id
            const isDeleted = Boolean(m.deleted_at)
            const canEdit = mine && !isDeleted && !archived
            const canDelete = !isDeleted && !archived && (mine || (isManager && channel.type === 'public'))
            const isEditing = editing?.id === m.id

            return (
              <div key={item.key} className={`${styles.msg} ${item.compact ? styles.msgCompact : ''}`}>
                {item.compact
                  ? <span className={styles.avatarSpacer} aria-hidden="true" />
                  : <Avatar person={sender} size={32} />}

                <div className={styles.msgBody}>
                  {!item.compact && (
                    <div className={styles.msgMeta}>
                      <span className={styles.msgName}>{mine ? 'You' : fullName(sender)}</span>
                      <time className={styles.msgTime} dateTime={m.created_at}>{formatClock(m.created_at)}</time>
                    </div>
                  )}

                  {isDeleted ? (
                    <p className={styles.deleted}>This message was deleted.</p>
                  ) : isEditing ? (
                    <div className={styles.editBox}>
                      <textarea
                        className={styles.textarea}
                        value={editing.text}
                        onChange={e => setEditing({ id: m.id, text: e.target.value })}
                        onKeyDown={handleEditKeyDown}
                        maxLength={MAX_MESSAGE_LENGTH}
                        rows={2}
                        aria-label="Edit message"
                        autoFocus
                      />
                      <div className={styles.formActions}>
                        <button type="button" className={styles.btn} onClick={() => setEditing(null)}>Cancel</button>
                        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={saveEdit}>Save</button>
                      </div>
                    </div>
                  ) : (
                    <p className={styles.msgText}>
                      <MessageText text={m.body} />
                      {m.edited_at && <span className={styles.edited}>(edited)</span>}
                    </p>
                  )}

                  {!isDeleted && summarizeReactions(reactions[m.id], me.id).length > 0 && (
                    <div className={styles.reactionRow}>
                      {summarizeReactions(reactions[m.id], me.id).map(r => (
                        <button
                          key={r.emoji}
                          type="button"
                          className={`${styles.reactionPill} ${r.mine ? styles.reactionPillMine : ''}`}
                          onClick={() => toggleReaction(m.id, r.emoji)}
                          disabled={archived}
                          aria-pressed={r.mine}
                          aria-label={`${r.emoji} reaction, ${r.count} ${r.count === 1 ? 'person' : 'people'}${r.mine ? ', including you' : ''}`}
                        >
                          <span aria-hidden="true">{r.emoji}</span> {r.count}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {!isEditing && !isDeleted && !archived && (
                  <div className={styles.msgActions}>
                    <span className={styles.reactAnchor}>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => setOpenPicker(p => (p === m.id ? null : m.id))}
                        aria-label="Add a reaction"
                        title="React"
                      >
                        😊+
                      </button>
                      {openPicker === m.id && (
                        <EmojiPicker onPick={emoji => toggleReaction(m.id, emoji)} onClose={() => setOpenPicker(null)} />
                      )}
                    </span>
                    {canEdit && (
                      <button type="button" className={styles.actionBtn} onClick={() => setEditing({ id: m.id, text: m.body })}>Edit</button>
                    )}
                    {canDelete && (
                      <button type="button" className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => handleDelete(m)}>Delete</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {showJump && (
          <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.jump}`} onClick={jumpToLatest}>
            Latest messages &darr;
          </button>
        )}
      </div>

      <div className={styles.composer}>
        <div className={styles.composerField}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={draft}
            onChange={e => { setDraft(e.target.value); resizeComposer() }}
            onKeyDown={handleComposerKeyDown}
            placeholder={archived ? 'This conversation is archived' : `Message ${channel.type === 'public' ? '#' : ''}${title}`}
            rows={1}
            disabled={archived}
            aria-label="Write a message"
          />
          {draft.length > MAX_MESSAGE_LENGTH - 500 ? (
            <span className={`${styles.counter} ${draft.length > MAX_MESSAGE_LENGTH ? styles.counterOver : ''}`}>
              {draft.length} / {MAX_MESSAGE_LENGTH}
            </span>
          ) : (
            <span className={styles.composerHint}>Enter to send · Shift+Enter for a new line</span>
          )}
        </div>
        <button
          type="button"
          className={styles.btn}
          onClick={() => setComposerPickerOpen(o => !o)}
          disabled={archived}
          aria-label="Insert an emoji"
          title="Emoji"
        >
          😊
        </button>
        {composerPickerOpen && (
          <span className={styles.composerEmojiAnchor}>
            <EmojiPicker
              onPick={emoji => {
                setDraft(d => d + emoji)
                setComposerPickerOpen(false)
                textareaRef.current?.focus()
              }}
              onClose={() => setComposerPickerOpen(false)}
            />
          </span>
        )}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={handleSend}
          disabled={archived || sending || !draft.trim() || draft.length > MAX_MESSAGE_LENGTH}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </>
  )
}
