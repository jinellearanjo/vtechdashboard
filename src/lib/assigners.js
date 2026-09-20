// src/lib/assigners.js
// Employees can only read their own profiles row (RLS), so embedding the assigner's profile in a
// tasks query returns null for them. This RPC returns just id + name for the people who assigned
// the caller's tasks, without exposing any other profile column.

import { supabase } from './supabase'

export async function fetchAssignerMap() {
  const { data, error } = await supabase.rpc('get_task_assigners')
  if (error) {
    console.error('Assigner lookup failed:', error.message)
    return {}
  }
  return Object.fromEntries((data ?? []).map(a => [a.id, a]))
}
