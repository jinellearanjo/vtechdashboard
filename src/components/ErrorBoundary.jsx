// src/components/ErrorBoundary.jsx
// Class-based React error boundary. Catches runtime errors in the component
// tree and renders a fallback rather than a blank screen.
// Usage: wrap <App /> or individual route subtrees.

import { Component } from 'react'
import styles from './ErrorBoundary.module.css'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // In production, send to an error reporting service here.
    console.error('ErrorBoundary caught:', error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.href = '/'
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className={styles.page}>
        <div className={styles.panel}>
          <span className={styles.code}>500</span>
          <h1 className={styles.heading}>Something went wrong</h1>
          <p className={styles.body}>
            An unexpected error occurred. The error has been logged.
            If this persists, contact your system administrator.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre className={styles.detail}>
              {this.state.error.toString()}
            </pre>
          )}
          <button className={styles.button} onClick={this.handleReset}>
            Return to home
          </button>
        </div>
      </div>
    )
  }
}
