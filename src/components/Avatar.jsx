// src/components/Avatar.jsx
// A person's photo, or their initials when they have none (or the image fails to load).

import { useState } from 'react'
import { avatarUrl } from '../lib/avatars'
import { initials } from './chat/chatUtils'
import styles from './Avatar.module.css'

export default function Avatar({ person, size = 32, className = '' }) {
  const url = avatarUrl(person?.avatar_path)
  const [failedUrl, setFailedUrl] = useState(null)
  const showImage = url && url !== failedUrl

  return (
    <span
      className={`${styles.avatar} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      aria-hidden="true"
    >
      {showImage
        ? <img className={styles.image} src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} />
        : initials(person)}
    </span>
  )
}
