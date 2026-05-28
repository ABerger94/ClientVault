# ClientVault CRM

A dependency-free, local-first CRM for private client management.

## Run

Open `index.html` in a modern browser. No build step is required.

## Features

- Encrypted local vault using Web Crypto AES-GCM.
- PBKDF2 key derivation with 310,000 SHA-256 iterations.
- Clients, first-class contact management, deals, projects, tasks, notes, activity audit, and dashboard.
- Onboarding checklists, onboarding questionnaires, meeting scheduling, and upcoming event tracking.
- Account health scoring, weighted pipeline forecast, delivery risk, and automation cues.
- Public landing page with Admin Login and Client Login entry points.
- Separate client portal login backed by Vercel serverless functions and private Vercel Blob storage.
- Pipeline board with stage movement.
- Global client/contact search.
- Encrypted backup export and restore.
- 15-minute inactivity auto-lock.
- Strict Content Security Policy with no network connections.

## Security Notes

This is a local browser CRM. Data is encrypted before being saved to `localStorage`, and the passphrase is never stored. There is no recovery path if the passphrase is lost.

For production multi-user use, the next step should be a server-backed edition with account auth, role-based access control, database row-level permissions, immutable audit logs, and automated encrypted backups.
