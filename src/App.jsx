// src/App.jsx
// Root component. Defines all routes and wraps them with auth context.
// Role-based redirect from /dashboard determines which dashboard renders.

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import PageLoader from './components/PageLoader'

// Lazy-loaded pages for code splitting
const Login           = lazy(() => import('./pages/Login'))
const Signup          = lazy(() => import('./pages/Signup'))
const ForgotPassword  = lazy(() => import('./pages/ForgotPassword'))
const ResetPassword   = lazy(() => import('./pages/ResetPassword'))
const DashboardRouter = lazy(() => import('./pages/DashboardRouter'))
const Home            = lazy(() => import('./pages/Home'))
const Chat            = lazy(() => import('./pages/Chat'))
const Profile         = lazy(() => import('./pages/Profile'))
const ManagerDashboard  = lazy(() => import('./pages/ManagerDashboard'))
const EmployeeDashboard = lazy(() => import('./pages/EmployeeDashboard'))
const TaskDetail      = lazy(() => import('./pages/TaskDetail'))
const AdminPanel      = lazy(() => import('./pages/AdminPanel'))
const Terms           = lazy(() => import('./pages/Terms'))
const Privacy         = lazy(() => import('./pages/Privacy'))
const Unauthorized    = lazy(() => import('./pages/Unauthorized'))
const NotFound        = lazy(() => import('./pages/NotFound'))

function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login"  element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route path="/terms"  element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />

        {/* Root redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Role-based dashboard router */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardRouter />
            </ProtectedRoute>
          }
        />

        {/* Home + chat: every signed-in user */}
        <Route path="/home" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
        <Route path="/chat/:channelId" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />

        {/* Manager routes */}
        <Route
          path="/manager/*"
          element={
            <ProtectedRoute requiredRole="manager">
              <ManagerDashboard />
            </ProtectedRoute>
          }
        />

        {/* Employee routes */}
        <Route
          path="/employee/*"
          element={
            <ProtectedRoute requiredRole="employee">
              <EmployeeDashboard />
            </ProtectedRoute>
          }
        />

        {/* Task detail — accessible by any authenticated user (RLS filters data) */}
        <Route
          path="/tasks/:id"
          element={
            <ProtectedRoute>
              <TaskDetail />
            </ProtectedRoute>
          }
        />

        {/* Admin panel */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute requiredRole="admin">
              <AdminPanel />
            </ProtectedRoute>
          }
        />

        {/* Utility routes */}
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route path="*"             element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
