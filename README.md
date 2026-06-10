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
- `PORTAL_ADMIN_SECRET`
- Vercel Blob variables from the linked Blob store

Optional email invite variables:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `CLIENTVAULT_PUBLIC_URL`
- `CLIENTVAULT_SUPPORT_EMAIL`

Optional Base44/Sage meeting integrations:

- `BASE44_APP_ID`
- `BASE44_SERVER_URL` such as `https://base44.app`
- `BASE44_APP_BASE_URL`
- `BASE44_FUNCTIONS_VERSION`
- `BASE44_ACCESS_TOKEN` or `BASE44_TOKEN`
- `BASE44_SERVICE_TOKEN` if your Base44 backend exposes service-role access
- `BASE44_FATHOM_MODE=remote` to call `base44.functions.invoke("importFathomMeetings", {})` and forward `/api/fathom-webhook` to the Base44 `fathomWebhook` function
- `FATHOM_API_KEY` and `FATHOM_WEBHOOK_SECRET` for the local Vercel Fathom fallback mode

`BASE44_APP_ID` must be the deployed Sage/Base44 app id. The sample id in a generated Base44 README may not point to the deployed app; `/api/base44-diagnostics` shows the exact integration and function URLs the CRM will call.

Meeting note generation and meeting chat use the Base44 SDK call `base44.integrations.Core.InvokeLLM(...)`.

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
- Automatic Resend portal invite emails when portal access is published.
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
