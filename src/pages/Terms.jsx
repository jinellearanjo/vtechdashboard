// src/pages/Terms.jsx
// Generic Terms of Service page. Linked from login, signup footer,
// and the user dropdown. Opens in a new tab from signup.

import { Link } from 'react-router-dom'
import styles from './Terms.module.css'

const LAST_UPDATED = '2026-01-01'
const COMPANY      = 'Verlyn Tech'
const CONTACT      = 'verlyntech@gmail.com'

export default function Terms() {
  return (
    <div className={styles.page}>
      <div className={styles.panel}>

        {/* Header */}
        <div className={styles.docHeader}>
          <Link to="/login" className={styles.back}>← Back</Link>
          <div className={styles.logoRow}>
            <span className={styles.logoMark}>VT</span>
            <span className={styles.logoName}>{COMPANY}</span>
          </div>
          <h1 className={styles.heading}>Terms of Service</h1>
          <p className={styles.meta}>Last updated: {LAST_UPDATED}</p>
        </div>

        <div className={styles.body}>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>1. Acceptance of terms</h2>
            <p>
              By accessing or using the {COMPANY} task management platform
              ("the Service"), you agree to be bound by these Terms of Service.
              If you do not agree, you may not access the Service.
              These terms apply to all users, including administrators, project
              managers, and contributors.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>2. Description of service</h2>
            <p>
              The Service provides a task management and team coordination tool
              for internal organisational use. Features include task assignment,
              deadline tracking, team management, and administrative oversight.
              The Service is made available on a private, invitation-only basis.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>3. Eligibility and accounts</h2>
            <p>
              Access is restricted to individuals who have been issued a valid
              account by an authorised administrator. You are responsible for
              maintaining the confidentiality of your credentials and for all
              activity conducted under your account. You must notify your
              administrator immediately upon suspecting unauthorised access.
            </p>
            <p>
              Legacy accounts — accounts created without an email address — sign in
              with a username and password and can only hold the Contributor role.
              You are responsible for keeping that password private. Legacy
              accounts cannot be recovered by email if the password is forgotten;
              contact your administrator.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>4. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul className={styles.list}>
              <li>Use the Service for any purpose outside your authorised organisational role.</li>
              <li>Attempt to gain access to accounts, data, or systems beyond your permission level.</li>
              <li>Upload, transmit, or store unlawful, harmful, or confidential third-party information without authorisation.</li>
              <li>Interfere with or disrupt the integrity or performance of the Service.</li>
              <li>Reverse engineer, decompile, or otherwise attempt to extract the source code of the Service.</li>
              <li>Share your credentials or allow any other individual to use your account.</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>5. Data and privacy</h2>
            <p>
              The Service collects and stores personal data including your name,
              date of birth, date of joining, username, and email address where
              applicable. This data is used solely to operate and administer the
              Service and is not shared with third parties.
            </p>
            <p>
              All activity within the Service, including task creation, status
              updates, and administrative actions, is subject to audit logging.
              Audit logs are retained for operational and compliance purposes and
              are accessible to system administrators.
            </p>
            <p>
              By using the Service you consent to this data collection and
              processing. You may request deletion of your account and associated
              data by contacting your administrator.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>6. Intellectual property</h2>
            <p>
              All content, interfaces, and software comprising the Service are
              the property of {COMPANY} or its licensors. Nothing in these terms
              grants you any right to use {COMPANY}'s trademarks, logos, or
              proprietary information without prior written consent.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>7. Role-based access and responsibilities</h2>
            <p>
              Access to features is determined by your assigned role.
              Administrators are responsible for the correct assignment of roles
              and for the issuance of invite codes. Administrators must not grant
              elevated access beyond what an individual's organisational function
              requires.
            </p>
            <p>
              Project managers are responsible for the accuracy and appropriateness
              of task assignments and deadlines under their management.
              Contributors are responsible for keeping their assigned task statuses
              current and accurate.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>8. Limitation of liability</h2>
            <p>
              The Service is provided on an "as is" and "as available" basis.
              {' '}{COMPANY} makes no warranties, express or implied, regarding
              availability, accuracy, or fitness for a particular purpose.
              To the fullest extent permitted by law, {COMPANY} shall not be
              liable for any indirect, incidental, special, or consequential
              damages arising from your use of or inability to use the Service.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>9. Termination</h2>
            <p>
              {COMPANY} reserves the right to suspend or terminate your access
              to the Service at any time, with or without notice, if you violate
              these terms or if your employment or organisational affiliation ends.
              Upon termination, your right to use the Service ceases immediately.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>10. Modifications to terms</h2>
            <p>
              {COMPANY} may revise these terms at any time. Continued use of the
              Service following notice of revision constitutes acceptance of the
              updated terms. The date of the most recent revision is indicated
              at the top of this document.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>11. Governing law</h2>
            <p>
              These terms shall be governed by and construed in accordance with
              applicable law. Any disputes arising under or in connection with
              these terms shall be subject to the exclusive jurisdiction of the
              competent courts in the relevant jurisdiction.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>12. Contact</h2>
            <p>
              Questions regarding these terms should be directed to your system
              administrator or to{' '}
              <a href={`mailto:${CONTACT}`} className={styles.link}>{CONTACT}</a>.
            </p>
          </section>

        </div>

        <div className={styles.docFooter}>
          <p className={styles.footerText}>
            © {new Date().getFullYear()} {COMPANY}. All rights reserved.
          </p>
          <Link to="/login" className={styles.footerLink}>Return to login</Link>
        </div>
      </div>
    </div>
  )
}
