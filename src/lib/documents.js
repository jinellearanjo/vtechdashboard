// src/lib/documents.js
// Task document submission: private Storage bucket + task_documents table.
// Access is enforced by RLS (see supabase/migrations/*_task_documents.sql); the checks here are
// for fast feedback only. The bucket enforces the same size and type limits server-side.

import { supabase } from './supabase'

export const BUCKET    = 'task-docs'
export const MAX_BYTES = 10 * 1024 * 1024 // keep in sync with the bucket + table constraint

// extension -> content type (derived from the extension because browsers often leave file.type empty)
const TYPES = {
  pdf:  'application/pdf',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:  'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:  'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt:  'text/plain',
  csv:  'text/csv',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
}

export const ACCEPT = Object.keys(TYPES).map(ext => `.${ext}`).join(',')

const extensionOf = (name) => name.includes('.') ? name.split('.').pop().toLowerCase() : ''

export function validateFile(file) {
  if (!file)              return 'No file selected.'
  if (file.size === 0)    return `"${file.name}" is empty.`
  if (file.size > MAX_BYTES) {
    return `"${file.name}" is too large (max ${MAX_BYTES / 1024 / 1024} MB).`
  }
  if (!TYPES[extensionOf(file.name)]) {
    return `"${file.name}": file type not allowed. Use PDF, Office, image, text or CSV files.`
  }
  return null
}

// Storage keys reject some characters; keep the extension, cap the length.
export function safeFilename(name) {
  const ext  = extensionOf(name)
  const base = (ext ? name.slice(0, -(ext.length + 1)) : name)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 80) || 'file'
  return `${base}.${ext}`
}

export function formatBytes(n) {
  if (n < 1024)             return `${n} B`
  if (n < 1024 * 1024)      return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const DOC_COLUMNS = `
  id, task_id, filename, size_bytes, mime_type, created_at, uploaded_by, storage_path,
  uploader:profiles!task_documents_uploaded_by_fkey(first_name, last_name)
`

export async function listTaskDocuments(taskId) {
  const { data, error } = await supabase
    .from('task_documents')
    .select(DOC_COLUMNS)
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function uploadTaskDocument(taskId, file, userId) {
  const problem = validateFile(file)
  if (problem) throw new Error(problem)

  const contentType = TYPES[extensionOf(file.name)]
  const path = `${taskId}/${crypto.randomUUID()}-${safeFilename(file.name)}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType, upsert: false })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('task_documents')
    .insert({
      task_id:      taskId,
      uploaded_by:  userId,
      storage_path: path,
      filename:     file.name.slice(0, 200),
      size_bytes:   file.size,
      mime_type:    contentType,
    })
    .select(DOC_COLUMNS)
    .single()

  if (error) {
    // don't leave an orphaned file behind
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  return data
}

// Short-lived link; `download` makes the browser save the file instead of rendering it inline.
export async function getDocumentUrl(doc) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, 60, { download: doc.filename })
  if (error) throw error
  return data.signedUrl
}

// Row first, then the file: a leftover file is invisible, a row pointing at a missing file is not.
export async function deleteTaskDocument(doc) {
  const { data, error } = await supabase
    .from('task_documents')
    .delete()
    .eq('id', doc.id)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('You do not have permission to delete this document.')

  await supabase.storage.from(BUCKET).remove([doc.storage_path])
}

// The DB cascade removes rows when a task is deleted but cannot remove the files in Storage.
// Call getTaskFilePaths() BEFORE deleting the task, then removeFiles() after it succeeds.
export async function getTaskFilePaths(taskId) {
  const { data } = await supabase
    .from('task_documents')
    .select('storage_path')
    .eq('task_id', taskId)
  return (data ?? []).map(d => d.storage_path)
}

export async function removeFiles(paths) {
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths)
}
