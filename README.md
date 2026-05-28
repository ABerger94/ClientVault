# ClientVault CRM

A server-backed CRM and client portal for private client management.

## Run

Install dependencies and run through Vercel so API routes are available:

```sh
npm install
npx vercel dev
```

The static HTML files can still be opened directly for visual inspection, but real CRM persistence and login require the API routes.

## Production Environment

Required Vercel environment variables:

- `CLIENTVAULT_ADMIN_EMAIL`
- `CLIENTVAULT_ADMIN_PASSWORD`
- `CLIENTVAULT_SESSION_SECRET`
- Vercel Blob variables from the linked Blob store

Recommended before long-term production use:

- `POSTGRES_URL`
- `POSTGRES_URL_NON_POOLING`

When Postgres is configured, CRM state, portal records, portal updates, and audit events use the database. Without Postgres, they use private Vercel Blob as a server-side fallback so records are no longer stored in the browser.

## Features

- Server-side admin login with HttpOnly signed session cookies.
- Server-side CRM persistence through Vercel APIs.
- Clients, first-class contact management, deals, projects, tasks, notes, activity audit, and dashboard.
- Onboarding checklists, onboarding questionnaires, meeting scheduling, and upcoming event tracking.
- Account health scoring, weighted pipeline forecast, delivery risk, and automation cues.
- Public landing page with Admin Login and Client Login entry points.
- Separate client portal login backed by Vercel serverless functions.
- Portal-side write APIs for meeting requests, confirmations, questionnaires, support requests, and onboarding steps.
- Automatic portal sync on admin/client login when a sync secret is saved.
- Pipeline board with stage movement.
- Global client/contact search.
- JSON backup export and restore.
- 15-minute inactivity auto-lock.
- Strict Content Security Policy.

## Security Notes

Client records are no longer stored in browser `localStorage`. The browser keeps only UI state and the optional portal sync secret. Admin authentication is handled server-side and sessions are stored in HttpOnly cookies.

For a stronger v2, replace the single admin password with a full auth provider, add staff/client roles, normalize the CRM JSON into relational tables, and enable automated database backups.
