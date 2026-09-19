// src/components/Navbar.jsx
// Top navigation bar. Renders across all authenticated pages.
// Includes: logo, role-based nav links, theme toggle, user dropdown.

import { useState, useRef, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './Navbar.module.css'

const ROLE_LABELS = {
  admin:    'Administrator',
  manager:  'Project Manager',
  employee: 'Contributor',
}

export default function Navbar() {
  const { profile, role, isAdmin, isManager, theme, toggleTheme, signOut } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close dropdown on Escape
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') setDropdownOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const isActive = (path) => location.pathname.startsWith(path)

  const handleSignOut = async () => {
    setDropdownOpen(false)
    await signOut()
    navigate('/login')
  }

  const dashboardPath = isAdmin
    ? '/admin'
    : isManager
    ? '/manager'
    : '/employee'

  return (
    <header className={styles.navbar} role="banner">
      <div className={styles.inner}>

        {/* Left — Logo + nav links */}
        <div className={styles.left}>
          <Link to={dashboardPath} className={styles.logo} aria-label="Verlyn Tech — home">
            <span className={styles.logoMark}>VT</span>
            <span className={styles.logoName}>Verlyn Tech</span>
          </Link>

          <nav className={styles.nav} aria-label="Primary navigation">
            {/* Employee nav */}
            <Link
              to="/employee"
              className={`${styles.navLink} ${isActive('/employee') ? styles.navLinkActive : ''}`}
              aria-current={isActive('/employee') ? 'page' : undefined}
            >
              My Tasks
            </Link>

            {/* Manager nav */}
            {isManager && (
              <>
                <Link
                  to="/manager"
                  className={`${styles.navLink} ${isActive('/manager') ? styles.navLinkActive : ''}`}
                  aria-current={isActive('/manager') ? 'page' : undefined}
                >
                  Dashboard
                </Link>
                <Link
                  to="/manager/tasks"
                  className={`${styles.navLink} ${isActive('/manager/tasks') ? styles.navLinkActive : ''}`}
                  aria-current={isActive('/manager/tasks') ? 'page' : undefined}
                >
                  Tasks
                </Link>
                <Link
                  to="/manager/team"
                  className={`${styles.navLink} ${isActive('/manager/team') ? styles.navLinkActive : ''}`}
                  aria-current={isActive('/manager/team') ? 'page' : undefined}
                >
                  Team
                </Link>
              </>
            )}

            {/* Admin nav */}
            {isAdmin && (
              <Link
                to="/admin"
                className={`${styles.navLink} ${isActive('/admin') ? styles.navLinkActive : ''}`}
                aria-current={isActive('/admin') ? 'page' : undefined}
              >
                Admin
              </Link>
            )}
          </nav>
        </div>

        {/* Right — Theme toggle + user dropdown */}
        <div className={styles.right}>

          {/* Theme toggle */}
          <button
            className={styles.themeToggle}
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
          </button>

          {/* User dropdown */}
          <div className={styles.userMenu} ref={dropdownRef}>
            <button
              className={styles.userButton}
              onClick={() => setDropdownOpen(o => !o)}
              aria-haspopup="true"
              aria-expanded={dropdownOpen}
              aria-label="User menu"
            >
              <span className={styles.avatar} aria-hidden="true">
                {profile?.first_name?.[0]?.toUpperCase() ?? '?'}
              </span>
              <span className={styles.userInfo}>
                <span className={styles.userName}>
                  {profile?.first_name} {profile?.last_name}
                </span>
                <span className={styles.userRole}>
                  {ROLE_LABELS[role] ?? role}
                </span>
              </span>
              <svg
                className={`${styles.chevron} ${dropdownOpen ? styles.chevronOpen : ''}`}
                width="12" height="12" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.5"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {dropdownOpen && (
              <div
                className={styles.dropdown}
                role="menu"
                aria-label="User options"
              >
                <div className={styles.dropdownHeader}>
                  <span className={styles.dropdownEmail}>
                    {profile?.username}
                  </span>
                  <span className={`${styles.roleBadge} ${styles[`role_${role}`]}`}>
                    {ROLE_LABELS[role] ?? role}
                  </span>
                </div>

                <div className={styles.dropdownDivider} role="separator" />

                <Link
                  to="/profile"
                  className={styles.dropdownItem}
                  role="menuitem"
                  onClick={() => setDropdownOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Profile
                </Link>

                <Link
                  to="/terms"
                  className={styles.dropdownItem}
                  role="menuitem"
                  onClick={() => setDropdownOpen(false)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  Terms of Service
                </Link>

                <div className={styles.dropdownDivider} role="separator" />

                <button
                  className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                  role="menuitem"
                  onClick={handleSignOut}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
