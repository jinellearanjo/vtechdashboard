// src/components/chat/EmojiPicker.jsx
// A small fixed set of common emoji in a popover. Deliberately not a full picker library, to keep
// the bundle light — this covers ordinary reactions and message flourishes.

import { useEffect, useRef } from 'react'
import styles from './Chat.module.css'

const EMOJI_GRID = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅',
  '😢', '😭', '😡', '🥳', '😴', '🤯', '😱', '🙄', '😉', '🤝',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '✅', '❌', '❤️',
  '🔥', '🎉', '🚀', '⭐', '💯', '✨', '☕', '📌', '📎', '⏰',
]

export default function EmojiPicker({ onPick, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div ref={ref} className={styles.emojiPopover} role="dialog" aria-label="Choose an emoji">
      <div className={styles.emojiGrid}>
        {EMOJI_GRID.map(e => (
          <button
            key={e}
            type="button"
            className={styles.emojiBtn}
            onClick={() => onPick(e)}
            aria-label={`Insert ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  )
}
