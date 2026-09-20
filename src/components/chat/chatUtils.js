// src/components/chat/chatUtils.js
// Pure helpers for the chat UI (names, links in messages, grouping and date labels).

export const fullName = (person) =>
  person ? `${person.first_name ?? ''} ${person.last_name ?? ''}`.trim() || 'Unknown' : 'Former user'

export const initials = (person) =>
  person ? `${person.first_name?.[0] ?? ''}${person.last_name?.[0] ?? ''}`.toUpperCase() || '?' : '?'

/** Display title for any conversation: person's name for DMs, otherwise the channel/group title. */
export function conversationTitle(channel, directoryById) {
  if (channel.type === 'direct') return fullName(directoryById.get(channel.dm_user_id))
  return channel.title || channel.name
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/g
const TRAILING_PUNCT = /[.,;:!?)\]}]+$/

/**
 * Split text into plain and http(s) link parts. Trailing punctuation stays outside the link.
 * Only http/https is ever linked, so nothing like "javascript:" can become a href.
 */
export function splitLinks(text) {
  const parts = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0]
    const trail = url.match(TRAILING_PUNCT)?.[0] ?? ''
    if (trail) url = url.slice(0, -trail.length)

    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) })
    if (url) parts.push({ type: 'link', value: url })
    if (trail) parts.push({ type: 'text', value: trail })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}

export const formatClock = (iso) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso)
  if (sameDay(d, now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  })
}

const FIVE_MINUTES = 5 * 60 * 1000

/**
 * Turn a chronological message list into render items: day separators and messages,
 * where `compact` means "same sender within 5 minutes, hide the name/avatar".
 */
export function groupMessages(messages) {
  const items = []
  let prev = null
  for (const m of messages) {
    const newDay = !prev || !sameDay(new Date(prev.created_at), new Date(m.created_at))
    if (newDay) items.push({ type: 'day', key: `day-${m.created_at.slice(0, 10)}-${m.id}`, label: dayLabel(m.created_at) })

    const compact = !newDay && prev.sender_id === m.sender_id && m.sender_id !== null &&
      new Date(m.created_at) - new Date(prev.created_at) < FIVE_MINUTES
    items.push({ type: 'message', key: m.id, message: m, compact })
    prev = m
  }
  return items
}

/** Insert or replace a message by id, keeping chronological order (used for realtime + optimistic echoes). */
export function upsertMessage(list, message) {
  const i = list.findIndex(m => m.id === message.id)
  if (i >= 0) {
    const next = list.slice()
    next[i] = { ...next[i], ...message }
    return next
  }
  const next = [...list, message]
  next.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
  return next
}
