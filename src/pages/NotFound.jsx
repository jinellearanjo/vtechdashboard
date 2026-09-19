// src/pages/NotFound.jsx
import { useNavigate } from 'react-router-dom'
import styles from './ErrorPage.module.css'

export default function NotFound() {
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <span className={styles.code}>404</span>
        <h1 className={styles.heading}>Page not found</h1>
        <p className={styles.body}>
          The page you are looking for does not exist or has been moved.
        </p>
        <button className={styles.button} onClick={() => navigate(-1)}>
          Go back
        </button>
      </div>
    </div>
  )
}
