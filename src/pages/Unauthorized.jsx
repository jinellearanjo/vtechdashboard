// src/pages/Unauthorized.jsx
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './ErrorPage.module.css'

export default function Unauthorized() {
  const navigate = useNavigate()
  const { role } = useAuth()

  const back = role === 'admin'
    ? '/admin'
    : role === 'manager'
    ? '/manager'
    : role === 'employee'
    ? '/employee'
    : '/login'

  return (
    <div className={styles.page}>
      <div className={styles.panel}>
        <span className={styles.code}>403</span>
        <h1 className={styles.heading}>Access denied</h1>
        <p className={styles.body}>
          You do not have permission to view this page.
          Contact your administrator if you believe this is an error.
        </p>
        <button className={styles.button} onClick={() => navigate(back)}>
          Return to dashboard
        </button>
      </div>
    </div>
  )
}
