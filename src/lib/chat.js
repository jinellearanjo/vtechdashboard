// src/lib/chat.js
// Chat data access. Who can see or do what is decided by RLS and the database functions
// (see supabase/migrations/*_chat.sql); these helpers only wrap the calls and turn errors into Error objects.

import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from '../context/AuthContext'

export const MAX_MESSAGE_LENGTH = 4000
export const PAGE_SIZE = 50
export const CHAT_READ_EVENT = 'vt:chat-read'

const MESSAGE_COLUMNS = 'id, channel_id, sender_id, body, created_at, edited_at, deleted_at'

const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data
}

// ── Reads ────────────────────────────────────────────────────

export async function fetchOverview() {
  const rows = unwrap(await supabase.rpc('get_channel_overview')) ?? []
  // bigint columns can arrive as strings; normalise to numbers
  return rows.map(r => ({ ...r, unread_count: Number(r.unread_count), member_count: Number(r.member_count) }))
}

export async function fetchDirectory() {
  return unwrap(await supabase.rpc('get_directory')) ?? []
}

export async function fetchChannelMembers(channelId) {
  return unwrap(await supabase.rpc('get_channel_members', { p_channel: channelId })) ?? []
}

// Newest `limit` messages (optionally older than `before`), returned oldest-first.
export async function fetchMessages(channelId, { before = null, limit = PAGE_SIZE } = {}) {
  let query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (before) query = query.lt('created_at', before)
  const rows = unwrap(await query) ?? []
  return rows.reverse()
}

// ── Messages ─────────────────────────────────────────────────

export async function sendMessage(channelId, senderId, body) {
  return unwrap(
    await supabase
      .from('messages')
      .insert({ channel_id: channelId, sender_id: senderId, body })
      .select(MESSAGE_COLUMNS)
      .single()
  )
}

export async function editMessage(id, body) {
  const rows = unwrap(await supabase.from('messages').update({ body }).eq('id', id).select(MESSAGE_COLUMNS))
  if (!rows?.length) throw new Error('You can only edit your own messages.')
  return rows[0]
}

// Soft delete: the database blanks the text.
export async function deleteMessage(id) {
  const rows = unwrap(
    await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', id).select(MESSAGE_COLUMNS)
  )
  if (!rows?.length) throw new Error('You do not have permission to delete this message.')
  return rows[0]
}

export async function markRead(channelId) {
  unwrap(await supabase.rpc('mark_channel_read', { p_channel: channelId }))
  window.dispatchEvent(new Event(CHAT_READ_EVENT))
}

// ── Conversations ────────────────────────────────────────────

export async function openDirectMessage(userId) {
  return unwrap(await supabase.rpc('get_or_create_dm', { p_other: userId }))
}

export async function createGroupChat(title, memberIds) {
  return unwrap(await supabase.rpc('create_group_chat', { p_title: title, p_member_ids: memberIds }))
}

export async function addGroupMembers(channelId, userIds) {
  unwrap(await supabase.rpc('add_channel_members', { p_channel: channelId, p_user_ids: userIds }))
}

export async function removeGroupMember(channelId, userId) {
  unwrap(await supabase.rpc('remove_channel_member', { p_channel: channelId, p_user_id: userId }))
}

// Managers and admins only (RLS): public channels everyone joins automatically.
export async function createPublicChannel({ name, title, description }, userId) {
  return unwrap(
    await supabase
      .from('channels')
      .insert({ name, title, description: description || null, type: 'public', created_by: userId })
      .select('id')
      .single()
  ).id
}

export async function updateChannel(id, patch) {
  const rows = unwrap(await supabase.from('channels').update(patch).eq('id', id).select('id'))
  if (!rows?.length) throw new Error('You do not have permission to change this channel.')
}

// "Marketing & Sales!" -> "marketing-sales"
export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

// ── Unread badge ─────────────────────────────────────────────

export function useUnreadTotal() {
  const { profile } = useAuth()
  const userId = profile?.id
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!userId) return
    let active = true

    const refresh = async () => {
      const { data } = await supabase.rpc('get_unread_total')
      if (active) setTotal(Number(data ?? 0))
    }

    refresh()
    const channel = supabase
      // unique per hook instance: the navbar and the home page both use this hook at the same time
      .channel(`unread-badge-${userId}-${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'channel_members', filter: `user_id=eq.${userId}` }, refresh)
      .subscribe()
    window.addEventListener(CHAT_READ_EVENT, refresh)

    return () => {
      active = false
      window.removeEventListener(CHAT_READ_EVENT, refresh)
      supabase.removeChannel(channel)
    }
  }, [userId])

  return total
}
