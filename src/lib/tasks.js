// src/lib/tasks.js
// Task queries shared by the home page.

import { supabase } from './supabase'

const COLUMNS = `
  id, title, status, deadline, assigned_to, team_id,
  team:teams(id, name),
  assignee:profiles!tasks_assigned_to_fkey(first_name, last_name)
`

// Tasks assigned to me or to a team I belong to. (Explicit filter: managers and admins can read every task,
// so relying on RLS alone would show them everyone's.)
export async function fetchMyTasks(userId) {
  const { data: memberships } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
  const teamIds = (memberships ?? []).map(m => m.team_id)
  const mine = teamIds.length
    ? `assigned_to.eq.${userId},team_id.in.(${teamIds.join(',')})`
    : `assigned_to.eq.${userId}`

  const { data, error } = await supabase.from('tasks').select(COLUMNS).or(mine)
  if (error) throw error
  return data ?? []
}

// Everything the caller's RLS lets them see (managers and admins: all tasks).
export async function fetchAllTasks() {
  const { data, error } = await supabase.from('tasks').select(COLUMNS)
  if (error) throw error
  return data ?? []
}

export async function countPendingReviews() {
  const { count, error } = await supabase
    .from('task_documents')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending_review')
  if (error) return 0
  return count ?? 0
}
