# IT accounts and permissions

Employees submit tickets through `/` without an IT account. The `/admin` page is
the protected workspace for IT staff.

## First sign-in

On a fresh installation, sign in with username `admin` and temporary password
`admin`. Before opening the dashboard, replace it with a password of at least
12 characters. Enter the temporary password, the new password, and its
confirmation on the first-sign-in screen.

The requirement is enforced on the API: a logged-in account with
`must_change_password` cannot read or update tickets or manage accounts.
Changing `ADMIN_PASSWORD` after an account exists does not reset its password.
Local bootstrap settings are available in `.env.example`.

## Roles

| Capability | Admin | Agent | Viewer |
|---|---|---|---|
| Read/search/filter tickets and view images | Yes | Yes | Yes |
| Change ticket status and assignment | Yes | Yes | No |
| Create/manage IT accounts, roles, and password resets | Yes | No | No |

An Admin can create team accounts and choose their role. New accounts must
replace their temporary password on first sign-in. Administrator password resets
also require the user to choose a new password. The backend protects the last
active administrator against being disabled or demoted.

## Sessions and deployment

Passwords are stored as scrypt hashes. Session tokens are random, their hashes
are stored in PostgreSQL, and the browser receives an HttpOnly, SameSite=Strict
cookie. Sessions last 12 hours. `COOKIE_SECURE=true` enables the Secure cookie
attribute when serving through HTTPS; deployment configuration must pass that
setting to the backend.

The current LAN setup serves HTTP. Add and validate HTTPS and the Secure cookie
configuration before offering the system outside the trusted LAN. CI verifies
the implemented permissions and password-change flow; it does not replace a
deployment-specific security review.

Anonymous requests to `GET /api/tickets` return 401. This is expected after
authentication was added. Use Compose health checks and the public smoke check
for deployment validation, then use an authenticated account to inspect tickets.
