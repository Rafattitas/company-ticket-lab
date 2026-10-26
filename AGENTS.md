# TicketDesk: guide for AI contributors

Read this file before changing the project. Verify behavior against the current
source; this guide is context, not proof that a feature is implemented.

## Product and entry points

TicketDesk is a self-hosted IT support-ticket application. Employees use `/` to
submit their name, email, phone, priority, issue description, and an optional
image. IT staff use `/admin` to sign in, triage, assign, and resolve tickets.
Admin, Agent, and Viewer permissions are enforced by the backend.

Start with `README.md`, `CONTRIBUTING.md`, and `docs/architecture.md`. For account
behavior, read `docs/accounts-and-permissions.md`.

## Source map

| Path | Responsibility |
|---|---|
| `frontend/src/App.jsx` | Employee portal, login, password change, dashboard, account management |
| `frontend/src/App.css`, `index.css` | UI layout and styling |
| `frontend/nginx.conf` | Static files and `/api/` reverse proxy |
| `backend/server.js` | Startup, migration/bootstrap sequence, health checks, error handling, shutdown |
| `backend/routes/tickets.js` | Ticket validation, parameterized queries, attachments, permission checks |
| `backend/routes/conversations.js` | Private tracking access, public replies, internal notes, activity reads |
| `backend/routes/operations.js`, `frontend/src/Operations.jsx` | Department/SLA administration, reports, and service indicators |
| `backend/auth.js` | Password hashing, sessions, authorization, account routes, bootstrap admin |
| `backend/db.js` | PostgreSQL connection and password-file support |
| `backend/migrate.js`, `migrations/` | Ordered migrations and `schema_migrations` ledger |
| `backend/test/` | Node test runner tests using injected database substitutes |
| `compose.quickstart.yaml`, `.env.example` | Local installation from source |
| `deploy/compose.yaml` | Production services, networks, secrets, limits, and health checks |
| `deploy/integration-test.sh` | Temporary database/API environment and cleanup |
| `deploy/production-deploy.sh` | Reviewed source of the VM deployment command |
| `.github/workflows/pipeline.yml` | Verification, tested-image publication, approved deployment |

## Invariants to preserve

- Public ticket creation must remain usable without an IT login. Ticket lists,
  individual tickets, and attachments require IT authorization. The separate
  `/api/tracking/:id` endpoints authorize only the ticket matching a private
  token sent in `X-Ticket-Token`. Never make the general ticket API public.
- Admin can manage accounts and update tickets; Agent can read/update tickets;
  Viewer can only read tickets. Hiding UI controls is not authorization.
- On an empty accounts table the initial login defaults to `admin` / `admin`.
  Bootstrap settings apply only to initial account creation; changing environment
  variables must not reset existing passwords.
- `must_change_password` blocks dashboard permissions on the server until the
  password is replaced. New accounts and password resets follow this flow too.
- Preserve scrypt password hashes, hashed session tokens, HttpOnly/SameSite
  cookies, session invalidation, and safeguards for the last active admin.
- Use parameterized SQL. Validate inputs and image types/size on the backend.
  Attachments currently live in PostgreSQL, so backups include them.
- Tracking links keep the raw token in the URL fragment, never query strings
  or paths; store only its SHA-256 hash. Return it only at ticket creation.
  Public timeline reads must exclude internal notes, assignment events, contact
  details, and staff identity. A shared tracking link grants bearer access;
  do not describe it as proof of employee identity.
- Record status/assignment changes atomically with their before/after values
  and server-authenticated actor. Do not log a change when the value is unchanged.
- SLA deadlines are snapshots on ticket creation, in elapsed hours. Only a public
  staff reply sets first response; internal notes do not. Reopening clears the
  resolution timestamp but keeps original deadlines. Do not invent legacy timing.
- Report period metrics use creation time, while workload/overdue totals span all
  outstanding tickets. Aggregate in PostgreSQL, never over the 200-ticket UI page.
  See `docs/service-management.md` before changing these definitions.
- Add a new numbered SQL migration for schema changes. Do not rewrite migrations
  already applied to a persistent database. Check backward compatibility:
  rolling back an image does not roll back the database schema.
- Never commit production secrets, private keys, tokens, dumps, real employee
  data, `.env`, `node_modules`, or build output. Use placeholders in examples.
- Preserve digest/SHA pins, container restrictions, and the documented Trivy
  gate. Do not suppress findings just to make CI green.

## Development and verification

Work on a focused branch and submit a PR, following `CONTRIBUTING.md`. Preserve
unrelated local changes. Use existing CommonJS modules, React patterns, and
dependency injection instead of introducing a new framework unnecessarily.

From the repository root, run relevant checks:

```bash
(cd backend && npm ci && npm test)
(cd frontend && npm ci && npm run lint && npm run build)
git diff --check
```

For shell edits, run `bash -n` on changed scripts. For workflow edits, run
actionlint with `.github/actionlint.yaml`, which declares custom runner labels.
For database, auth, API, or image changes, build the affected images and run:

```bash
sudo bash deploy/integration-test.sh <backend-image> <postgres-image>
bash deploy/scan-images.sh <backend-image> <frontend-image> <postgres-image>
```

The integration script creates isolated temporary resources. Never point it at
the production database or substitute production credentials. CI remains the
authoritative clean-environment check. Report what ran and what did not run;
do not claim runtime verification from a syntax check.

## Deployment boundaries

Pull requests run `verify`. Pushes to `main` verify, publish the exact tested
images to GHCR as `sha-<full-commit-sha>`, then wait for `production` approval.
Deployment runs on the VM's self-hosted runner via:

```text
sudo -n /usr/local/sbin/company-ticket-deploy <full-commit-sha>
```

The root-owned command is a separately installed copy of
`deploy/production-deploy.sh`. Editing or merging the repository file does not
update that installed copy. See `docs/deployment.md` for the explicit sync and
verification procedure. This distinction previously caused a deployment to
roll back when an old smoke check requested the newly protected ticket list.

Use a public endpoint for anonymous smoke checks. `/api/tickets` is expected to
return 401 without a session; never weaken authentication to satisfy deployment.
The current deployment checks `/api`, which can be served by the SPA fallback;
Compose health checks provide backend/database readiness. Do not describe that
HTTP check alone as proof that authenticated ticket operations work.

Production image references and host settings live under `/etc/company-ticket/`;
secrets are in its `secrets/` directory. PostgreSQL administration is published
on VM loopback port 15432 through a dedicated management bridge, accessed by an
SSH tunnel. Keep the application/database internal network boundary intact.

Get explicit maintainer authorization before merging a PR or approving a
production deployment. Do not alter root-owned scripts, sudoers, volumes,
network publication, or backups as a side effect of a documentation task.

## Completion notes

Update relevant docs when behavior changes. Explain resulting behavior, tests,
migration implications, and limitations in the PR. Never call TicketDesk fully
production-ready solely because CI passes: current risks and the scanning scope
are recorded in `README.md` and `docs/security-scanning.md`.

## Email notification invariants

`backend/email.js` processes the database outbox from migration 008. Never email
internal notes, descriptions, attachments, staff identity, or tracking tokens.
Only real status/routing changes and public staff replies enqueue notifications.
SMTP is opt-in, TLS is mandatory, and credentials stay outside Git. API health
must not depend on SMTP availability. SMTP acceptance is not inbox delivery.
Read `docs/email-notifications.md` for leases, retries, expiry, and host setup.

Dashboard SMTP settings live in `backend/mail-settings.js` and migration 009.
Only accounts:manage can read/write/test; responses contain a password-present
flag, never plaintext/ciphertext. Preserve AES-GCM encryption and the separate
persistent key volume. Dashboard settings override environment settings and
reload automatically. Do not forward a saved password to a changed SMTP
server/port/username without re-entry. Test emails use saved settings and require
TLS, same-origin mutation checks, and a send cooldown.

## Knowledge content

Migration 010 and `backend/routes/content.js` implement public published-only
knowledge reads and admin-only content writes. Never expose drafts through list,
search, or ID lookup. Use plain text in React, not dangerous HTML rendering.
`frontend/src/Knowledge.jsx` contains the employee help center and admin editor.
Reply templates require tickets:update to read, accounts:manage to edit. Inserting
a template appends to a draft and never sends or changes visibility automatically.
Preserve the 5,000-character reply limit. See docs/knowledge-and-replies.md.
Capacity limits and an unexecuted staging-only k6 scenario are documented in
docs/capacity-and-load-testing.md; do not claim a 5,000-user benchmark from CI.
