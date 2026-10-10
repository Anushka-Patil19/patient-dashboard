# Rural Outreach Patient Dashboard

A secure, mobile-friendly web app for rural health centres and telemedicine NGOs. Clinicians record anonymised patient encounters (symptoms, diagnosis, treatment, vitals). Access is controlled by role, and administrators analyse disease trends such as monsoon dengue and malaria peaks or the chronic disease burden across districts.

| | |
|---|---|
| **Live demo** | **https://rural-outreach-dashboard.onrender.com** · demo password `Demo@2026!` for `admin@demo.local`, `doctor@demo.local`, `nurse@demo.local` (free tier: the first load after idling can take 30–60 s) |
| **Stack** | React 19 + Vite + Tailwind + Recharts · Node.js + Express 5 · PostgreSQL · Docker |
| **Docs** | [Architecture & security](docs/ARCHITECTURE.md) · [API reference](docs/API.md) · [Self-assessment](docs/SELF_ASSESSMENT.md) |

## Features

- **Role-based access** (enforced on the server, mirrored in the UI)
  - **Nurse**: registers patients, records encounters, and sees only the entries they made.
  - **Doctor**: views all encounters, edits them (with conflict detection), soft-deletes with a reason, and sees analytics.
  - **Admin**: sees aggregated analytics, the audit log and user management. Admins **cannot** open individual clinical records (least privilege).
- **Anonymised data**: no names, phone numbers or addresses. Each patient gets a random pseudo ID (`PT-7KQ2M9XA`) for their card. An optional ABHA, Aadhaar or phone number is stored only as a keyed HMAC, used to catch duplicate registrations.
- **Encounter create/read/update/delete** with validation on both client and server: plausible vitals ranges, BP pairs, no future dates, follow-up on or after the visit.
- **Interactive dashboard** with custom date ranges, day/week/month grouping and a district filter. It shows headline figures with change versus the previous period, encounters over time, a disease-trend comparison (with a table view), diagnosis, age-group and district breakdowns, and clinical risk flags.
- **Real-time updates** via Server-Sent Events. The dashboard and lists refresh when anyone saves a change.
- **Resilient sessions**: short-lived access tokens refresh silently. If the session fully expires mid-entry, a sign-in box appears over the form, nothing typed is lost, and the save completes after signing in again. Drafts are also kept in the browser tab (sessionStorage).
- **Append-only audit log**: logins, failures, changes (field-level diffs, with clinical free text redacted) and access-denied events. A database trigger blocks any UPDATE or DELETE on it.

## Quick start (local)

Requires **Node.js 20+**. You don't need Docker or a system PostgreSQL install. `npm run db:local` runs a real PostgreSQL server from npm binaries.

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env            # dev defaults work as-is
npm run db:local                # terminal 1: PostgreSQL on localhost:55432 (Ctrl+C to stop)
npm run migrate && npm run seed # terminal 2: schema + synthetic demo data
npm run dev                     # API on http://localhost:4000

# 2. Frontend (terminal 3)
cd frontend
npm install
npm run dev                     # http://localhost:5173 (proxies /api to :4000)
```

**With Docker instead:** `docker compose up --build`, then open http://localhost:4000. The database is seeded automatically.

### Demo accounts

All demo accounts use the password `Demo@2026!`. All data is synthetic: 220 patients and about 1,500 encounters over 12 months, with seasonal disease patterns.

| Role | Email |
|---|---|
| Admin | `admin@demo.local` |
| Doctor | `doctor@demo.local`, `doctor2@demo.local` |
| Nurse | `nurse@demo.local`, `nurse2@demo.local` |

## Testing

```bash
cd backend && npm test     # 41 API integration tests against a real PostgreSQL (needs db:local running)
cd frontend && npm test    # validation and chart-colour logic unit tests
```

Backend tests cover the critical paths:

| Area | What is verified |
|---|---|
| Authentication | Generic login errors (no account enumeration); lockout after 5 failures; disabled users rejected on existing tokens; `TOKEN_EXPIRED` signal; forged and `alg:none` JWTs rejected; refresh-token rotation; **replayed refresh token revokes the whole session family**; two tabs refreshing at once is tolerated; logout revokes |
| Role access | Every clinical endpoint requires auth; nurses can't edit or delete (403 **plus** an `ACCESS_DENIED` audit entry); nurses see only their own entries; admins see analytics but not records; role changes apply on the very next request |
| Encounters | 10 invalid-input cases return field-level errors; malformed JSON and IDs are handled; **optimistic locking returns 409 on stale edits**; audit diffs; soft delete; filters and pagination |
| Anonymisation | External ID never stored in clear text; duplicate detection by HMAC; search by pseudo ID or external ID |
| Analytics | Correct aggregates; deleted and out-of-range records excluded; empty days filled; range validation |
| Audit | UPDATE and DELETE on `audit_logs` fail at the database level; clinical free text redacted |

CI (`.github/workflows/ci.yml`) runs on every push:

- **test**: both test suites, the production build and `npm audit`.
- **docker**: builds the production image exactly as Render does, boots it against PostgreSQL, and smoke-tests it. It checks the frontend is served, security headers are present, unauthenticated access returns 401, the demo login works, analytics return data, and the container runs as non-root. This verifies the Dockerfile without needing Docker installed locally.

## Deployment

The app deploys as **one container**: the API serves the built React app from the same origin. Same-origin serving means no CORS setup and lets the refresh cookie be `SameSite=Strict`.

**Render (free tier):** push this repository to GitHub, then in Render choose **New → Blueprint** and select the repo. `render.yaml` provisions the web service and PostgreSQL, generates `JWT_SECRET` and `PSEUDONYM_SECRET`, and seeds the demo data on first boot.

**Any Docker host:** build the root `Dockerfile` and set the environment variables listed in `backend/.env.example`. Set `DATABASE_SSL=true` for managed databases that require TLS.

## Project structure

```
backend/
  src/
    app.js              Express app: security headers, rate limits, routes, static SPA
    routes/             auth, users, patients, encounters, analytics, audit-logs, events (SSE), meta
    middleware/         authenticate/authorize, Zod validation, error mapping
    lib/                permissions matrix, audit writer, pseudonymisation, tokens, event bus
    db/                 pool, SQL migrations, migration runner, seed
  tests/                Vitest + Supertest integration tests
frontend/
  src/
    api/client.js       fetch wrapper: in-memory token, refresh + retry, re-auth wait
    auth/               session context
    hooks/              data loading, live updates (SSE), chart theme
    pages/              Dashboard, Encounters, EncounterForm, Patients, AuditLog, Users, Login
docs/                   architecture, API, self-assessment
```
