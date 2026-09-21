// src/pages/Privacy.jsx
// Privacy policy. Public (no sign-in needed). It describes what the app actually does; if you change how data is
// collected, shared or deleted, update the matching section. Reuses the Terms page layout.

import { Link } from 'react-router-dom'
import styles from './Terms.module.css'

const LAST_UPDATED = '2026-09-20'
const COMPANY      = 'Verlyn Tech'
const CONTACT      = 'verlyntech@gmail.com'

export default function Privacy() {
  return (
    <div className={styles.page}>
      <div className={styles.panel}>

        <div className={styles.docHeader}>
          <Link to="/login" className={styles.back}>← Back</Link>
          <div className={styles.logoRow}>
            <span className={styles.logoMark}>VT</span>
            <span className={styles.logoName}>{COMPANY}</span>
          </div>
          <h1 className={styles.heading}>Privacy Policy</h1>
          <p className={styles.meta}>Last updated: {LAST_UPDATED}</p>
        </div>

        <div className={styles.body}>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>1. About this policy</h2>
            <p>
              This policy explains what personal information the {COMPANY} company dashboard (&ldquo;the Service&rdquo;)
              collects, who can see it, where it is kept, and how you can change or delete it. The Service is a private
              tool for {COMPANY} team members; accounts are issued by invitation.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>2. What we collect</h2>
            <ul className={styles.list}>
              <li><strong>Account details:</strong> your name, username, date of birth, and (for email accounts) your email address. Passwords are stored only in hashed form by our sign-in provider; we never see them.</li>
              <li><strong>Profile photo</strong> (optional). It is cropped and resized on your device before upload, which removes camera and location data.</li>
              <li><strong>Work information:</strong> tasks assigned to you or your teams, deadlines and statuses, team membership, and documents you submit with review notes.</li>
              <li><strong>Messages</strong> you send in channels, group chats and direct messages.</li>
              <li><strong>Activity records:</strong> a log of administrative and work events (for example role changes, invitations, task changes, document reviews). It records who did what and when; it does not contain your messages.</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>3. How it is used</h2>
            <p>
              Only to run the Service: signing you in, assigning and tracking work, letting the team communicate,
              reviewing submitted documents, and keeping the Service secure. We do not sell personal information and we
              do not use it for advertising.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>4. Who can see what</h2>
            <ul className={styles.list}>
              <li><strong>Your name, photo and role</strong> are visible to everyone who is signed in.</li>
              <li><strong>Your date of birth</strong> is visible only to you. Managers and administrators cannot see it.</li>
              <li><strong>Your email address</strong> is used to sign in and is not shown to other users.</li>
              <li><strong>Tasks and submitted documents</strong> are visible to the people assigned to them (including a whole team for team tasks), and to managers and administrators.</li>
              <li><strong>Public channels</strong> are visible to everyone signed in. <strong>Group chats and direct messages</strong> are visible only to their members; managers and administrators cannot read them. Managers and administrators can delete messages in public channels.</li>
              <li><strong>The activity log</strong> is visible to administrators.</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>5. Where it is kept and who helps us run it</h2>
            <ul className={styles.list}>
              <li><strong>Supabase</strong> provides our database, sign-in and file storage.</li>
              <li><strong>Vercel</strong> hosts the website.</li>
              <li><strong>Google</strong>: when a manager accepts a submitted document, a copy is saved to the company&rsquo;s Google Drive (through a Google Apps Script owned by the company). People with access to those Drive folders can see it.</li>
            </ul>
            <p>
              These providers process data on our behalf to deliver the Service. Profile photos are stored so that
              anyone who has the exact (randomly named) link can open them; the links are only shown to signed-in users.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>6. Cookies and browser storage</h2>
            <p>
              The Service stores your sign-in session and your light/dark preference in your browser&rsquo;s local storage.
              It does not use advertising or tracking cookies. Some older legacy accounts also keep a saved sign-in in
              the browser until a password is set; it is removed at that point.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>7. Keeping and deleting your information</h2>
            <p>
              Information is kept while your account exists. You can edit your details and photo, change your password,
              and delete your account yourself from your profile page. When you delete your account:
            </p>
            <ul className={styles.list}>
              <li>your profile, photo, date of birth and sign-in are removed, and you are removed from teams and group chats;</li>
              <li>your messages remain, shown as &ldquo;Former user&rdquo;, and direct messages remain visible to the other person;</li>
              <li>documents you submitted and completed tasks remain with the work they belong to, without your name;</li>
              <li>copies of documents already saved to Google Drive remain there;</li>
              <li>the activity log keeps an entry that the account was deleted.</li>
            </ul>
            <p>
              An account cannot be deleted while tasks that are still open are assigned to it, or if it is the only
              administrator account. Data removed from the Service may remain briefly in our providers&rsquo; systems
              before it is permanently erased.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>8. Security</h2>
            <p>
              Data is encrypted in transit, access is limited by role, and passwords are hashed. No system is perfectly
              secure; if you suspect your account has been accessed by someone else, change your password and tell an
              administrator straight away.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>9. Your choices and contact</h2>
            <p>
              To ask what we hold about you, to correct something you cannot change yourself, or to raise a concern,
              contact <a href={`mailto:${CONTACT}`} className={styles.link}>{CONTACT}</a> or your administrator.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionHeading}>10. Changes</h2>
            <p>
              We may update this policy as the Service changes. The date at the top shows when it last changed; material
              changes will be announced to team members.
            </p>
          </section>

        </div>

        <div className={styles.docFooter}>
          <p className={styles.footerText}>
            © {new Date().getFullYear()} {COMPANY}. All rights reserved.
          </p>
          <Link to="/terms" className={styles.footerLink}>Terms of Service</Link>
          {' · '}
          <Link to="/login" className={styles.footerLink}>Return to login</Link>
        </div>
      </div>
    </div>
  )
}
