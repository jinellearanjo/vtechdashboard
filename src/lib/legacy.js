// src/lib/legacy.js
// Legacy accounts are accounts without an email address: they sign in with a username and password, using a
// synthetic address derived from the username. Older legacy accounts were passwordless: the app kept a random
// password in this browser and signed in from just the username. That path is kept only so those accounts can
// sign in once and set a real password (see Profile). Set VITE_ALLOW_DEVICE_LOGIN=false once everyone has.

export const legacyEmail = (username) => `${username.trim().toLowerCase()}@legacy.verlyntech.internal`

export const deviceKey = (username) => `vt-legacy-${username.trim().toLowerCase()}`

export const deviceLoginAllowed = import.meta.env.VITE_ALLOW_DEVICE_LOGIN !== 'false'

export function getDeviceCredential(username) {
  if (!username?.trim()) return null
  try {
    const raw = localStorage.getItem(deviceKey(username))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.email && parsed?.password ? parsed : null
  } catch {
    return null
  }
}

export const hasDeviceCredential = (username) => getDeviceCredential(username) !== null

export function clearDeviceCredential(username) {
  try { localStorage.removeItem(deviceKey(username)) } catch { /* storage unavailable */ }
}
