// src/lib/driveFolders.js
// Google Drive folders an accepted submission can be filed into. `key` must match the list in
// supabase/functions/push-to-drive/index.ts (the server rejects anything else), and each key needs a
// matching secret (see docs/DRIVE_SETUP.md).

export const DRIVE_FOLDERS = [
  { key: 'general',     label: 'General' },
  { key: 'marketing',   label: 'Marketing' },
  { key: 'legal',       label: 'Legal' },
  { key: 'technical',   label: 'Technical' },
  { key: 'sales',       label: 'Sales' },
  { key: 'automations', label: 'Automations' },
  { key: 'finance',     label: 'Finance' },
  { key: 'lead-gen',    label: 'Lead Gen' },
]

export const driveFolderLabel = (key) =>
  DRIVE_FOLDERS.find(f => f.key === key)?.label ?? key
