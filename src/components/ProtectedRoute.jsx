// src/components/ProtectedRoute.jsx
// Wraps any route that requires authentication and optionally a specific role.
// Redirects unauthenticated users to /login.
// Redirects authenticated users without sufficient role to /unauthorized.

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from '../pages/ErrorPage.module.css'

export default function ProtectedRoute({ children, requiredRole }) {
  const { session, profile, loading, signOut } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="route-loading" aria-live="polite" aria-label="Loading">
        <div className="route-loading__spinner" />
      </div>
    )
  }

  // Not authenticated
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Authenticated but the profile could not be loaded (loading is already false here)
  if (!profile) {
    return (
      <div className={styles.page}>
        <div className={styles.panel}>
          <h1 className={styles.heading}>Could not load your profile</h1>
          <p className={styles.body}>
            You are signed in, but your account profile could not be loaded.
            Sign out and try again, or contact your administrator.
          </p>
          <button className={styles.button} onClick={signOut}>Sign out</button>
        </div>
      </div>
    )
  }

  // Role check
  if (requiredRole) {
    const hierarchy = { employee: 1, manager: 2, admin: 3 }
    const userLevel     = hierarchy[profile.role] ?? 0
    const requiredLevel = hierarchy[requiredRole] ?? 0

    if (userLevel < requiredLevel) {
      return <Navigate to="/unauthorized" replace />
    }
  }

  return children
}
