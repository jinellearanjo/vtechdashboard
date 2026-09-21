// src/lib/avatars.js
// Profile photos: validated, cropped to a square and re-encoded in the browser (which also drops EXIF data such
// as GPS location), then stored in the public `avatars` bucket under <user id>/<random>.jpg.

import { supabase } from './supabase'

export const AVATAR_BUCKET   = 'avatars'
export const AVATAR_SIZE     = 256
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024
export const AVATAR_ACCEPT   = 'image/jpeg,image/png,image/webp'

const ACCEPTED_TYPES = AVATAR_ACCEPT.split(',')

// Photos are shown by plain URL; this is computed locally, no request is made.
export const avatarUrl = (path) =>
  path ? supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl : null

/** Largest centred square inside a width x height image. */
export function centerSquareCrop(width, height) {
  const size = Math.min(width, height)
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size }
}

export function validateImage(file) {
  if (!file) return 'No file selected.'
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Use a JPG, PNG or WebP image.'
  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_SOURCE_BYTES) return `That image is too large (max ${MAX_SOURCE_BYTES / 1024 / 1024} MB).`
  return null
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' applies the camera's rotation, so phone photos aren't sideways
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch { /* fall back to <img> below */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image.')) }
    img.src = url
  })
}

/** Returns a 256x256 JPEG Blob ready to upload. */
export async function prepareAvatar(file) {
  const problem = validateImage(file)
  if (problem) throw new Error(problem)

  const image  = await loadImage(file)
  const width  = image.naturalWidth  || image.width
  const height = image.naturalHeight || image.height
  const { sx, sy, size } = centerSquareCrop(width, height)

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'                 // JPEG has no transparency
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  if (typeof image.close === 'function') image.close()

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('Could not process that image.')
  return blob
}

/** Uploads the photo, points the profile at it, then removes the previous file. Returns the new path. */
export async function uploadAvatar(userId, blob, previousPath = null) {
  const path = `${userId}/${crypto.randomUUID()}.jpg`

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' })
  if (uploadError) throw new Error(uploadError.message)

  const { data, error } = await supabase
    .from('profiles')
    .update({ avatar_path: path })
    .eq('id', userId)
    .select('id')
  if (error || !data?.length) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path])
    throw new Error(error?.message ?? 'Could not save your photo.')
  }

  if (previousPath) await supabase.storage.from(AVATAR_BUCKET).remove([previousPath])
  return path
}

/** Clears the profile's photo and deletes the file. Safe to call when there is no photo. */
export async function removeAvatar(userId, path) {
  if (!path) return
  const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', userId)
  if (error) throw new Error(error.message)
  await supabase.storage.from(AVATAR_BUCKET).remove([path])
}
