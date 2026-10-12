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
  individual tickets, and attachments require IT authorization.
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
