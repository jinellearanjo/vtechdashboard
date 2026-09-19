// src/pages/DashboardRouter.jsx
// Reads the authenticated user's role and redirects to the correct dashboard.
// This is what /dashboard resolves to — it never renders any UI itself.

import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PageLoader from '../components/PageLoader'

export default function DashboardRouter() {
  const { role, loading } = useAuth()

  if (loading) return <PageLoader />

  if (role === 'admin')    return <Navigate to="/admin"    replace />
  if (role === 'manager')  return <Navigate to="/manager"  replace />
  if (role === 'employee') return <Navigate to="/employee" replace />

  // Profile exists but role is unrecognised — should not happen in production
  return <Navigate to="/unauthorized" replace />
}
