// src/lib/profile.js
// Editing your own profile, changing your password, and deleting your account.
// What you may change is enforced by the database (guard_profile_update); these helpers just call it.

import { supabase } from './supabase'

export const friendlyProfileError = (error) =>
  error.code === '23505' ? 'That username is already taken.' : error.message

export async function updateDetails(userId, values) {
  const { data, error } = await supabase.from('profiles').update(values).eq('id', userId).select('id')
  if (error) throw new Error(friendlyProfileError(error))
  if (!data?.length) throw new Error('Your details could not be saved.')
}

// Re-checks the current password first, since updateUser alone only needs a live session.
export async function changePassword(email, currentPassword, newPassword) {
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (verifyError) throw new Error('Your current password is incorrect.')

  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
}

// Sends confirmation links to both the current and new address (Supabase's "Secure email change"
// default) — the address on file only updates once both are clicked. Re-checks the current password
// first, same as changePassword above.
export async function changeEmail(email, currentPassword, newEmail) {
  const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (verifyError) throw new Error('Your current password is incorrect.')

  const { error } = await supabase.auth.updateUser(
    { email: newEmail },
    { emailRedirectTo: `${window.location.origin}/profile` },
  )
  if (error) throw new Error(error.message)
}

// null when deletion is allowed, otherwise the reason in plain words.
export async function checkAccountDeletion() {
  const { data, error } = await supabase.rpc('check_account_deletion')
  if (error) throw new Error(error.message)
  return data
}

export async function verifyPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error('That password is incorrect.')
}

export async function deleteAccount() {
  const { error } = await supabase.rpc('delete_my_account')
  if (error) throw new Error(error.message)
}

// ── Private date of birth (only the owner can read or write it) ──
export async function fetchBirthdate(userId) {
  const { data, error } = await supabase
    .from('profile_private')
    .select('date_of_birth')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.date_of_birth ?? null
}

export async function saveBirthdate(userId, value) {
  const { error } = await supabase.from('profile_private').upsert({ id: userId, date_of_birth: value || null })
  if (error) throw new Error(friendlyProfileError(error))
}

// For an old passwordless legacy account that is signed in on its own device: no current password to check.
export async function setFirstPassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
}
