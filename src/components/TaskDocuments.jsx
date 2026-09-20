// src/components/TaskDocuments.jsx
// Document submissions for a task: upload, list, download, delete.
// Who can see / upload / delete is enforced by RLS; the UI just reflects it.

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  ACCEPT, MAX_BYTES, validateFile, formatBytes,
  listTaskDocuments, uploadTaskDocument, getDocumentUrl, deleteTaskDocument,
} from '../lib/documents'
import { formatDateTime } from '../lib/dateUtils'
import styles from './TaskDocuments.module.css'

export default function TaskDocuments({ taskId, showToast }) {
  const { profile, isManager } = useAuth()
  const inputRef = useRef(null)

  const [docs,      setDocs]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [busyId,    setBusyId]    = useState(null)

  useEffect(() => {
    let active = true
    listTaskDocuments(taskId)
      .then(d => { if (active) setDocs(d) })
      .catch(e => { if (active) setLoadError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [taskId])

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-selecting the same file
    if (!files.length) return

    // validate everything first so a bad file doesn't leave a half-finished batch
    for (const file of files) {
      const problem = validateFile(file)
      if (problem) { showToast(problem, 'error'); return }
    }

    setUploading(true)
    let uploaded = 0
    for (const file of files) {
      try {
        const doc = await uploadTaskDocument(taskId, file, profile.id)
        setDocs(d => [doc, ...d])
        uploaded++
      } catch (err) {
        showToast(`Could not upload "${file.name}". ${err.message}`, 'error')
        break
      }
    }
    setUploading(false)
    if (uploaded) showToast(uploaded === 1 ? 'Document uploaded.' : `${uploaded} documents uploaded.`)
  }

  const handleDownload = async (doc) => {
    setBusyId(doc.id)
    try {
      window.location.assign(await getDocumentUrl(doc))
    } catch (err) {
      showToast('Could not download the file. ' + err.message, 'error')
    }
    setBusyId(null)
  }

  const handleDelete = async (doc) => {
    if (!window.confirm(`Delete "${doc.filename}"? This cannot be undone.`)) return
    setBusyId(doc.id)
    try {
      await deleteTaskDocument(doc)
      setDocs(d => d.filter(x => x.id !== doc.id))
      showToast('Document deleted.')
    } catch (err) {
      showToast(err.message, 'error')
    }
    setBusyId(null)
  }

  // Employees can't read other people's profile rows, so a manager's upload has no uploader
  // embed for them; every such document is by a manager or admin.
  const uploaderName = (doc) => {
    if (doc.uploader) return `${doc.uploader.first_name} ${doc.uploader.last_name}`
    return doc.uploaded_by ? 'Manager' : 'Former user'
  }

  return (
    <section className={styles.card} aria-labelledby="docs-heading">
      <div className={styles.header}>
        <div>
          <h2 id="docs-heading" className={styles.title}>Documents</h2>
          <p className={styles.hint}>
            PDF, Office, image, text or CSV files, up to {MAX_BYTES / 1024 / 1024} MB each.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className={styles.fileInput}
          onChange={handleFiles}
          disabled={uploading}
          aria-label="Choose documents to upload"
        />
        <button
          type="button"
          className={styles.uploadBtn}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          aria-busy={uploading}
        >
          {uploading ? 'Uploading…' : 'Upload document'}
        </button>
      </div>

      {loading && <p className={styles.empty}>Loading documents…</p>}
      {loadError && <p className={styles.error} role="alert">Could not load documents. {loadError}</p>}
      {!loading && !loadError && docs.length === 0 && (
        <p className={styles.empty}>No documents submitted yet.</p>
      )}

      {docs.length > 0 && (
        <ul className={styles.list}>
          {docs.map(doc => {
            const canDelete = isManager || doc.uploaded_by === profile.id
            return (
              <li key={doc.id} className={styles.item}>
                <div className={styles.info}>
                  <button
                    type="button"
                    className={styles.fileName}
                    onClick={() => handleDownload(doc)}
                    disabled={busyId === doc.id}
                    title="Download"
                  >
                    {doc.filename}
                  </button>
                  <span className={styles.meta}>
                    {formatBytes(doc.size_bytes)} · {uploaderName(doc)} · {formatDateTime(doc.created_at)}
                  </span>
                </div>
                {canDelete && (
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => handleDelete(doc)}
                    disabled={busyId === doc.id}
                    aria-label={`Delete ${doc.filename}`}
                  >
                    Delete
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
