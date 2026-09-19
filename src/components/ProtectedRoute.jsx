// src/components/ProtectedRoute.jsx
// Wraps any route that requires authentication and optionally a specific role.
// Redirects unauthenticated users to /login.
// Redirects authenticated users without sufficient role to /unauthorized.

import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, requiredRole }) {
  const { session, profile, loading } = useAuth()
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

  // Authenticated but profile not yet loaded
  if (!profile) {
    return (
      <div className="route-loading" aria-live="polite" aria-label="Loading profile">
        <div className="route-loading__spinner" />
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
