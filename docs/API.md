# API Reference

Base path: `/api`. Request and response bodies are JSON. Dates are `YYYY-MM-DD` (interpreted in IST). Timestamps are ISO-8601 UTC.

## Conventions

**Authentication.** Every endpoint except `/auth/login`, `/auth/refresh`, `/auth/logout` and `/health` requires an access token:

```
Authorization: Bearer <accessToken>
```

Access tokens last 15 minutes. The refresh token is an `httpOnly` cookie (`rt`, `Path=/api/auth`, `SameSite=Strict`) that the browser sends automatically to `/auth/refresh`.

**Errors** always have this shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Some fields are invalid",
             "details": [{ "field": "diastolicBp", "message": "Diastolic BP must be lower than systolic" }] } }
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `MALFORMED_JSON`, `BAD_REQUEST` | Invalid input. `details[]` holds field-level messages. |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, `ACCOUNT_DISABLED`, `INVALID_CREDENTIALS`, `SESSION_ENDED` | On `TOKEN_EXPIRED`, call `/auth/refresh` and retry. |
| 403 | `FORBIDDEN` | Role lacks permission. Recorded as `ACCESS_DENIED` in the audit log. |
| 404 | `NOT_FOUND` | |
| 409 | `VERSION_CONFLICT`, `PATIENT_EXISTS`, `DUPLICATE` | `details` carries the current record or the existing patient. |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 100 KB. |
| 423 | `ACCOUNT_LOCKED` | Too many failed logins; retry after 15 minutes. |
| 429 | `RATE_LIMITED` | |

**Pagination.** List endpoints accept `page` (default 1) and `pageSize` (default 20, maximum 100) and return `{ data, page, pageSize, total }`.

## Permissions

| Permission | ADMIN | DOCTOR | NURSE |
|---|:-:|:-:|:-:|
| `patient:create`, `patient:read` | | ✓ | ✓ |
| `encounter:create` | | ✓ | ✓ |
| `encounter:read:own` (own entries) | | ✓ | ✓ |
| `encounter:read:any` | | ✓ | |
| `encounter:update`, `encounter:delete` | | ✓ | |
| `analytics:read` | ✓ | ✓ | |
| `audit:read`, `user:manage` | ✓ | | |

---

## Auth

### `POST /auth/login`
```json
{ "email": "doctor@demo.local", "password": "Demo@2026!" }
```
**200**: sets the `rt` cookie and returns:
```json
{ "accessToken": "eyJ…", "expiresIn": 900,
  "user": { "id": "…", "email": "doctor@demo.local", "fullName": "Dr. Rahul Patil", "role": "DOCTOR",
            "facility": "PHC Trimbakeshwar", "permissions": ["patient:create", "…"] } }
```

### `POST /auth/refresh`
No body; uses the `rt` cookie. Rotates the refresh token and returns the same shape as login. Replaying an already-rotated token revokes the whole session family (**401 `SESSION_ENDED`**).

### `POST /auth/logout`
Revokes the session family and clears the cookie. **204**.

### `GET /auth/me`
Returns `{ user }` for the current token.

## Patients

### `GET /patients?q=&district=&page=&pageSize=`
`q` matches a pseudo-ID prefix (`PT-7K`) **or** an exact external ID (ABHA, Aadhaar or phone, compared by HMAC).
```json
{ "data": [{ "id": "…", "pseudoId": "PT-7KQ2M9XA", "birthYear": 1984, "ageBand": "25-44", "sex": "FEMALE",
             "district": "Nashik", "block": "Igatpuri", "encounterCount": 3, "lastEncounterDate": "2026-10-02",
             "createdAt": "…" }], "page": 1, "pageSize": 20, "total": 1 }
```

### `POST /patients`
```json
{ "birthYear": 1984, "sex": "FEMALE", "district": "Nashik", "block": "Igatpuri", "externalRef": "9876 5432 1098" }
```
`sex` is one of `MALE`, `FEMALE`, `OTHER`, `UNKNOWN`. `block` and `externalRef` are optional. **201** `{ data: Patient }`. **409 `PATIENT_EXISTS`** with `details: { id, pseudoId }` if the external ID is already registered.

### `GET /patients/:id`
Returns `{ data: Patient }`.

## Encounters

### `GET /encounters?from=&to=&diagnosis=&district=&patientId=&sort=&page=&pageSize=`
`sort` is one of `-encounter_date` (default), `encounter_date`, `-created_at`, `created_at`. Nurses only ever receive their own entries.

### `GET /encounters/:id`
Returns `{ data: Encounter }`. Nurses get 403 for encounters they did not create.

```json
{
  "id": "…", "version": 2,
  "patient": { "id": "…", "pseudoId": "PT-7KQ2M9XA", "sex": "FEMALE", "ageBand": "25-44", "ageAtEncounter": 42, "district": "Nashik" },
  "encounterDate": "2026-10-09", "encounterType": "IN_PERSON", "facility": "PHC Trimbakeshwar",
  "symptoms": ["fever", "headache"], "diagnosisCode": "DENGUE", "diagnosisLabel": "Dengue",
  "diagnosisNotes": "NS1 positive", "treatment": "Paracetamol, fluids",
  "temperatureC": 39.1, "systolicBp": 118, "diastolicBp": 76, "pulseBpm": null, "spo2Pct": null,
  "bloodGlucoseMgdl": null, "weightKg": null, "followUpDate": "2026-10-12",
  "createdBy": { "id": "…", "name": "Dr. Rahul Patil" }, "updatedBy": null,
  "createdAt": "…", "updatedAt": "…"
}
```

### `POST /encounters`
Body: `patientId` plus every field shown above except the server-managed ones (`id`, `version`, `patient`, `diagnosisLabel`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`).

| Field | Rules |
|---|---|
| `encounterDate` | Required; not in the future (IST); 2000 or later |
| `symptoms` | 1–20 strings; trimmed, lower-cased, de-duplicated |
| `diagnosisCode` | Must exist in `GET /meta` → `diagnoses` |
| `temperatureC` | 30–45 |
| `systolicBp` / `diastolicBp` | 50–300 / 30–200; supplied together; systolic > diastolic |
| `pulseBpm` | 20–250 |
| `spo2Pct` | 50–100 |
| `bloodGlucoseMgdl` | 20–800 |
| `weightKg` | 0.5–300 |
| `followUpDate` | On or after `encounterDate` |
| `facility` | Defaults to the user's facility |
| Unknown fields | Rejected |

**201** `{ data: Encounter }`.

### `PUT /encounters/:id`
Same body as POST minus `patientId`, plus the `version` you loaded. **200** with the incremented `version`. If someone saved first: **409 `VERSION_CONFLICT`** with `details.current` holding the latest record.

### `DELETE /encounters/:id`
```json
{ "reason": "Duplicate entry" }
```
Soft delete; the reason is required. **204**.

## Analytics

### `GET /analytics/summary?from=&to=&granularity=&district=&diagnosis=`

| Parameter | Values |
|---|---|
| `from`, `to` | Default: the last 90 days. Maximum range 3 years. |
| `granularity` | `auto` (default; day ≤ 45 days, week ≤ 200 days, else month), `day`, `week`, `month` |

```json
{
  "range": { "from": "2026-07-12", "to": "2026-10-09", "granularity": "week", "district": null, "diagnosis": null },
  "totals": { "encounters": 514, "patients": 199, "communicable": 319, "teleconsults": 107,
              "previousPeriodEncounters": 336, "followUpsNext7Days": 14 },
  "riskFlags": { "highGlucose": 32, "highBp": 61, "fever": 244, "lowSpo2": 17 },
  "trend": [{ "period": "2026-07-06", "total": 6, "VIRAL_FEVER": 2, "DENGUE": 1 }],
  "byDiagnosis": [{ "code": "VIRAL_FEVER", "label": "Viral fever", "communicable": true, "count": 106 }],
  "byAgeBand": [{ "band": "0-4", "count": 17 }],
  "bySex": [{ "sex": "FEMALE", "count": 305 }],
  "byDistrict": [{ "district": "Nashik", "count": 227 }]
}
```
`trend` has one entry per period, including empty ones. Risk flags count encounters with BP ≥ 140/90, glucose ≥ 200 mg/dL, temperature ≥ 38 °C or SpO₂ < 94 %.

## Audit log (admin)

### `GET /audit-logs?action=&entityType=&entityId=&userId=&from=&to=&page=&pageSize=`
- `action` is one of `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `REFRESH_TOKEN_REUSE`, `CREATE`, `UPDATE`, `DELETE`, `ACCESS_DENIED`.
- `entityType` is one of `encounter`, `patient`, `user`.
- Each row returns `{ id, occurredAt, user: { id, email, role }, action, entityType, entityId, changes, ip, userAgent, requestId }`.
- `changes` for an update looks like `{ "diagnosis_code": { "from": "VIRAL_FEVER", "to": "DENGUE" }, "treatment": { "changed": true } }`. Free-text clinical fields are redacted.

## Users (admin)

| Method | Path | Body / notes |
|---|---|---|
| GET | `/users` | All users |
| POST | `/users` | `{ email, fullName, role, facility?, password }`. Password: at least 10 characters with a letter and a digit. |
| PATCH | `/users/:id` | Any of `{ fullName, role, facility, isActive, password }`. Deactivating a user, changing their role or resetting their password revokes their sessions. Admins can't deactivate or demote themselves. |

## Other

| Method | Path | Notes |
|---|---|---|
| GET | `/meta` | `{ diagnoses[], districts[], sexes[], encounterTypes[] }` for forms and filters |
| GET | `/events` | `text/event-stream`. Events: `ready`, `change` with `{ type: "encounter.created" \| "encounter.updated" \| "encounter.deleted" \| "patient.created", id, at }`. The stream closes when the access token expires; reconnect with a fresh token. |
| GET | `/health` | `{ status: "ok" }` once the database is reachable (no auth) |

## Example (curl)

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"doctor@demo.local","password":"Demo@2026!"}' | jq -r .accessToken)

curl -s "http://localhost:4000/api/analytics/summary?from=2026-01-01&to=2026-10-09&district=Palghar" \
  -H "Authorization: Bearer $TOKEN" | jq .totals
```
