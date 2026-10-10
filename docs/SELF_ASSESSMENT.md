# Self-Assessment

## What I built

**Live:** https://rural-outreach-dashboard.onrender.com · **Code:** https://github.com/Anushka-Patil19/patient-dashboard

A working, deployed patient-encounter dashboard for rural telemedicine clinics. Nurses, doctors and administrators each get a different, server-enforced view of anonymised clinical data, with live updates and an append-only audit trail. I approached it primarily as a **security engineering** exercise: who can see what, how sessions fail safely, and how every change stays attributable. Then I made sure clinicians would find it quick to use on a phone at a busy PHC.

## Key architecture choices and trade-offs

| Decision | Why | Trade-off accepted |
|---|---|---|
| **One container serving API + SPA (same origin)** | No CORS configuration; the refresh cookie can be `SameSite=Strict`; one thing to deploy and monitor. | The frontend can't be scaled or CDN-cached separately from the API. Fine at pilot scale; static assets can move to a CDN later. |
| **Access token in memory + rotating httpOnly refresh cookie** | XSS can't read either token from storage, and CSRF can't use the cookie. Reuse detection turns a stolen refresh token into an alarm instead of a silent breach. | More moving parts than a single long-lived JWT. I had to handle concurrent refreshes (deduplicated in the client, plus a 15-second grace window on the server for two tabs). |
| **Role read from the database on every request** | Deactivating a user or changing their role takes effect on the next request, not 15 minutes later. | One indexed primary-key lookup per request. Negligible at this scale; cacheable for a few seconds if needed. |
| **Permission matrix, not role checks in routes** | One file answers "who can do what", which helps audits and future changes. | Row-level rules (nurse sees only their own entries) still live in the route. |
| **Admins see aggregates only** | Least privilege: analysing trends doesn't require reading a patient's notes. The audit log redacts clinical free text for the same reason. | An admin investigating a data-quality issue has to ask a doctor. That's deliberate. |
| **Hand-written SQL with `pg` instead of an ORM** | The analytics needs `date_trunc` and `generate_series` anyway; every query is reviewable; parameterisation is explicit. | More code than an ORM for simple CRUD, and no generated types. |
| **Pseudo ID + HMAC of external ID** | Duplicate registration is caught without storing Aadhaar or phone numbers. The HMAC key makes the hash resistant to brute-force reversal. | If `PSEUDONYM_SECRET` is lost, duplicate detection for existing patients stops working (care data is unaffected). The key must be backed up like any other secret. |
| **Optimistic locking instead of record locks** | Clinicians don't block each other. Conflicts are rare and the UI shows exactly which fields differ. | The second editor has to choose between their version and the other one; there is no field-level merge. |
| **Soft delete only** | Clinical and legal records shouldn't disappear, and the reason is required and audited. | Deleted rows count toward storage; analytics and lists filter them out with partial indexes. |
| **SSE for "real-time"** | It's all the requirement needs (server → client notifications), with no extra infrastructure. | It's in-process, so multiple instances would need Postgres `LISTEN/NOTIFY` or Redis. I documented that path. |

## UX decisions

- **Nurse home is the entry form**, not a dashboard they can't use. After a save, the form resets but keeps date, facility and visit type, so recording a queue of patients is fast.
- **Session expiry never loses work.** A sign-in dialog opens over the page; the original request is retried after signing in; drafts also persist in the tab.
- **Mobile-first form.** Single-column layout on phones, numeric keyboards for vitals, one-tap common symptoms, and a save bar that stays visible at the bottom.
- **Charts follow accessibility rules.** Colour-blind-safe palette (checked with a validator script), a legend plus direct labels, a table view for the trend chart, at most 3 comparison series with colours that stay attached to each diagnosis, and a properly selected dark mode.
- **Errors say what to do.** Field-level messages ("Diastolic BP must be lower than systolic"), a "this patient is already registered as PT-…" shortcut, and conflict banners naming the fields that differ.

## Edge cases handled

- **Session expiry during data entry**: silent refresh; re-login dialog; automatic retry; tab-scoped draft autosave.
- **Two clinicians editing the same encounter**: 409 with the latest version and a field-level comparison.
- **Invalid or incomplete data**: required fields, physiologic ranges, BP pairs, future dates, follow-up before visit, unknown diagnosis, unknown patient, unexpected fields, malformed JSON, malformed IDs. Database CHECK constraints act as a second layer.
- **Role violations**: 403 plus an `ACCESS_DENIED` audit entry; nurses get 403 on others' records; the UI hides what the role can't use.
- **Duplicate patient registration**, detected by HMAC with a one-click "use existing patient".
- **Brute force, token replay, deactivated users with live tokens, privilege changes mid-session.**
- **Empty periods in charts**, filled with zeros server-side so lines don't skip time.
- **Two tabs refreshing tokens at once**, so reuse detection doesn't log the user out.

## Testing

41 backend integration tests run against a real PostgreSQL, so constraints, triggers and SQL are tested rather than mocked. 7 frontend unit tests cover the validation and chart-colour logic. I also walked through every role end to end in a real browser, including the expired-session flow, on desktop and mobile viewports in light and dark mode.

GitHub Actions runs on every push. One job runs both test suites, the production build and `npm audit`. A second job builds the production Docker image, boots it against PostgreSQL and smoke-tests it: frontend served, security headers present, 401 without login, demo login works, analytics return data, container not running as root. Both jobs pass. After deploying to Render, I repeated the login and dashboard checks for all three roles against the live URL.

## Deployment

The app is deployed on Render from the `render.yaml` Blueprint: one Docker web service plus managed PostgreSQL. Render generates the secrets at deploy time, so none are committed to the repository. Migrations run automatically on start, and synthetic demo data is loaded on first boot. HTTPS, HSTS and the secure refresh cookie are active in production.

## Difficulties and how I solved them

- **Refresh-token reuse detection versus real browsers.** Strict reuse detection would log users out whenever two requests refresh with the same token at once, for example React's development double-render, a burst of parallel 401s, or two open tabs. I handled it with a deduplicated refresh promise in the client and a short grace window on the server that only applies to tokens revoked by normal rotation. Both cases have tests.
- **SSE with header-based auth.** `EventSource` can't send an `Authorization` header, and putting tokens in URLs leaks them into logs. I used `fetch` streaming instead and made the server close the stream when the token expires, so a revoked session can't keep listening.
- **Timezones.** PostgreSQL `DATE` values were being shifted by the server's local timezone. I parse them as plain strings, and "today" is always computed in IST so a clinic entering data at 11 pm isn't rejected as "in the future".
- **Local environment.** Docker wasn't usable on my machine (no WSL), so I added an `embedded-postgres` script. Reviewers can run the full stack with only Node.js installed. To avoid shipping a Dockerfile I had never built, I added a CI job that builds and smoke-tests the image on GitHub's runners before the Render deploy.

## What I would improve next

1. **Offline-first data entry** (service worker plus IndexedDB outbox) for clinics with intermittent connectivity. This matters most for rural use.
2. **MFA for doctors and admins** (TOTP), and a forced password change on first login after an admin reset.
3. **Encryption at rest for free-text fields** (envelope encryption with a KMS key), on top of the provider's disk encryption.
4. **DPDP workflows**: consent capture, data-principal access and erasure requests, a retention policy with automated purging of old drafts and tokens.
5. **Small-cell suppression** in analytics (hide counts under 5 by district and diagnosis) to reduce re-identification risk in sparse villages.
6. **Security monitoring**: forward `ACCESS_DENIED`, `LOGIN_FAILED` bursts and `REFRESH_TOKEN_REUSE` events to a SIEM with alert rules.
7. **Scale-out**: Postgres `LISTEN/NOTIFY` for events, Redis-backed rate limits, materialised daily aggregates for state-level dashboards.
8. **Playwright end-to-end tests in CI** (I ran the browser walkthrough locally and against the live site), plus axe accessibility checks.
9. **Production hosting**: the free Render tier sleeps when idle and its database expires after about 30 days. A real rollout would use a paid instance in an Indian region (data residency), automated backups and uptime monitoring.
