// src/components/TaskDocuments.jsx
// Document submissions for a task. Employees upload; managers/admins review each file:
// accept (copied to a Google Drive folder) or reject with a note.
// Who can see / upload / review / delete is enforced by RLS and the database; the UI reflects it.

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  ACCEPT, MAX_BYTES, validateFile, formatBytes,
  listTaskDocuments, uploadTaskDocument, getDocumentUrl, deleteTaskDocument,
  rejectDocument, pushToDrive,
} from '../lib/documents'
import { DRIVE_FOLDERS, driveFolderLabel } from '../lib/driveFolders'
import { formatDateTime } from '../lib/dateUtils'
import styles from './TaskDocuments.module.css'

const STATUS_LABELS = {
  pending_review: 'Pending review',
  accepted:       'Accepted',
  rejected:       'Rejected',
}

export default function TaskDocuments({ taskId, showToast }) {
  const { profile, isManager } = useAuth()
  const inputRef = useRef(null)

  const [docs,      setDocs]      = useState([])
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [busyId,    setBusyId]    = useState(null)
  const [review,    setReview]    = useState(null) // { docId, mode: 'accept' | 'reject' }
  const [folder,    setFolder]    = useState('general')
  const [note,      setNote]      = useState('')

  useEffect(() => {
    let active = true
    listTaskDocuments(taskId)
      .then(d => { if (active) setDocs(d) })
      .catch(e => { if (active) setLoadError(e.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [taskId])

  const reload = async () => {
    try { setDocs(await listTaskDocuments(taskId)) }
    catch (e) { showToast(e.message, 'error') }
  }

  const openReview = (docId, mode) => {
    setReview({ docId, mode })
    setFolder('general')
    setNote('')
  }
  const closeReview = () => setReview(null)

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
    if (uploaded) showToast(uploaded === 1 ? 'Document submitted for review.' : `${uploaded} documents submitted for review.`)
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

  const handleAccept = async (doc) => {
    setBusyId(doc.id)
    try {
      await pushToDrive(doc.id, folder)
      closeReview()
      await reload()
      showToast(`Accepted and saved to Google Drive (${driveFolderLabel(folder)}).`)
    } catch (err) {
      showToast(err.message, 'error')
    }
    setBusyId(null)
  }

  const handleReject = async (doc) => {
    if (!note.trim()) { showToast('Add a note explaining what needs to change.', 'error'); return }
    setBusyId(doc.id)
    try {
      await rejectDocument(doc.id, note.trim())
      closeReview()
      await reload()
      showToast('Submission rejected. The note is visible to the team.')
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
          <h2 id="docs-heading" className={styles.title}>Submissions</h2>
          <p className={styles.hint}>
            PDF, Office, image, text or CSV files, up to {MAX_BYTES / 1024 / 1024} MB each.
            A manager reviews every file.
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
          {uploading ? 'Uploading…' : 'Submit document'}
        </button>
      </div>

      {loading && <p className={styles.empty}>Loading submissions…</p>}
      {loadError && <p className={styles.error} role="alert">Could not load submissions. {loadError}</p>}
      {!loading && !loadError && docs.length === 0 && (
        <p className={styles.empty}>Nothing submitted yet.</p>
      )}

      {docs.length > 0 && (
        <ul className={styles.list}>
          {docs.map(doc => {
            const isOpen    = review?.docId === doc.id
            const canDelete = isManager || (doc.uploaded_by === profile.id && doc.status !== 'accepted')
            const busy      = busyId === doc.id
            return (
              <li key={doc.id} className={styles.item}>
                <div className={styles.row}>
                  <div className={styles.info}>
                    <div className={styles.nameLine}>
                      <button
                        type="button"
                        className={styles.fileName}
                        onClick={() => handleDownload(doc)}
                        disabled={busy}
                        title="Download"
                      >
                        {doc.filename}
                      </button>
                      <span className={`${styles.badge} ${styles[`badge_${doc.status}`]}`}>
                        {STATUS_LABELS[doc.status] ?? doc.status}
                      </span>
                    </div>
                    <span className={styles.meta}>
                      {formatBytes(doc.size_bytes)} · {uploaderName(doc)} · {formatDateTime(doc.created_at)}
                    </span>

                    {doc.status === 'rejected' && doc.reviewer_note && (
                      <p className={styles.note}>
                        <strong>Reviewer note:</strong> {doc.reviewer_note}
                      </p>
                    )}
                    {doc.status === 'accepted' && isManager && doc.drive_file_url && (
                      <a
                        className={styles.driveLink}
                        href={doc.drive_file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open in Google Drive{doc.drive_folder ? ` · ${driveFolderLabel(doc.drive_folder)}` : ''}
                      </a>
                    )}
                  </div>

                  <div className={styles.actions}>
                    {isManager && doc.status !== 'accepted' && (
                      <button
                        type="button"
                        className={styles.acceptBtn}
                        onClick={() => openReview(doc.id, 'accept')}
                        disabled={busy}
                      >
                        Accept
                      </button>
                    )}
                    {isManager && doc.status === 'pending_review' && (
                      <button
                        type="button"
                        className={styles.rejectBtn}
                        onClick={() => openReview(doc.id, 'reject')}
                        disabled={busy}
                      >
                        Reject
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={() => handleDelete(doc)}
                        disabled={busy}
                        aria-label={`Delete ${doc.filename}`}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {isManager && isOpen && review.mode === 'accept' && (
                  <div className={styles.panel}>
                    <label className={styles.panelLabel} htmlFor={`folder-${doc.id}`}>
                      File in Google Drive folder
                    </label>
                    <div className={styles.panelRow}>
                      <select
                        id={`folder-${doc.id}`}
                        className={styles.input}
                        value={folder}
                        onChange={e => setFolder(e.target.value)}
                        disabled={busy}
                      >
                        {DRIVE_FOLDERS.map(f => (
                          <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                      </select>
                      <button type="button" className={styles.uploadBtn} onClick={() => handleAccept(doc)} disabled={busy}>
                        {busy ? 'Saving…' : 'Accept and save to Drive'}
                      </button>
                      <button type="button" className={styles.cancelBtn} onClick={closeReview} disabled={busy}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {isManager && isOpen && review.mode === 'reject' && (
                  <div className={styles.panel}>
                    <label className={styles.panelLabel} htmlFor={`note-${doc.id}`}>
                      What needs to change? (shown to the team)
                    </label>
                    <textarea
                      id={`note-${doc.id}`}
                      className={styles.textarea}
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      maxLength={1000}
                      rows={3}
                      disabled={busy}
                    />
                    <div className={styles.panelRow}>
                      <button type="button" className={styles.rejectSolidBtn} onClick={() => handleReject(doc)} disabled={busy || !note.trim()}>
                        {busy ? 'Saving…' : 'Reject submission'}
                      </button>
                      <button type="button" className={styles.cancelBtn} onClick={closeReview} disabled={busy}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
