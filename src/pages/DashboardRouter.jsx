// src/pages/DashboardRouter.jsx
// What /dashboard resolves to: sends any signed-in user with a valid role to the home page.
// It never renders any UI itself.

import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PageLoader from '../components/PageLoader'

export default function DashboardRouter() {
  const { role, loading } = useAuth()

  if (loading) return <PageLoader />

  // Everyone lands on the home page; role-specific dashboards are linked from the navbar.
  if (role === 'admin' || role === 'manager' || role === 'employee') {
    return <Navigate to="/home" replace />
  }

  // Profile exists but role is unrecognised — should not happen in production
  return <Navigate to="/unauthorized" replace />
}
