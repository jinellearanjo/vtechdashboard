// src/lib/departments.js
// Department channels: a restricted subset of the public "department" channels a person must be
// approved into (up to 3 at a time). Administrators are automatically in every department.

import { supabase } from './supabase'

export const MAX_DEPARTMENTS = 3

const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data
}

// Every department, with the caller's status: null (not requested), 'pending', 'approved', 'denied'.
export async function listDepartments() {
  return unwrap(await supabase.rpc('list_departments')) ?? []
}

export async function requestDepartments(channelIds) {
  unwrap(await supabase.rpc('request_department_access', { p_channels: channelIds }))
}

export async function withdrawDepartment(channelId) {
  unwrap(await supabase.rpc('withdraw_department_access', { p_channel: channelId }))
}

// ── Admin ────────────────────────────────────────────────────

export async function fetchAllDepartmentAccess() {
  const { data, error } = await supabase
    .from('department_access')
    .select(`
      user_id, channel_id, status, requested_at, decided_at,
      user:profiles!department_access_user_id_fkey(id, first_name, last_name, avatar_path),
      channel:channels!department_access_channel_id_fkey(id, name, title),
      decider:profiles!department_access_decided_by_fkey(first_name, last_name)
    `)
    .order('requested_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function decideDepartmentAccess(userId, channelId, approve) {
  unwrap(await supabase.rpc('decide_department_access', { p_user: userId, p_channel: channelId, p_approve: approve }))
}

export async function grantDepartmentAccess(userId, channelId) {
  unwrap(await supabase.rpc('grant_department_access', { p_user: userId, p_channel: channelId }))
}

export async function revokeDepartmentAccess(userId, channelId) {
  unwrap(await supabase.rpc('revoke_department_access', { p_user: userId, p_channel: channelId }))
}
