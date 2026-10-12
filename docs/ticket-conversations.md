# Ticket follow-up and conversations

## Employee workflow

After submitting a new ticket, save the private link displayed on the receipt.
Open it to read the request, status updates, IT replies, and the original image,
then send additional details. Use **Refresh updates** to load new activity.
Updates are fetched on demand; email notifications and live push are not included.

The link has the form `/track/<ticket-id>#<random-token>`. The token stays in the
browser's URL fragment and is sent to the API in `X-Ticket-Token`, not as part of
a logged request URL. Only the SHA-256 hash is stored in PostgreSQL. The API
checks both the ID and hash on every request and returns 404 for invalid links.

Anyone with the full link can view this ticket and reply. Keep it private and
avoid sharing screenshots containing the address bar. The link does not verify
the employee's identity, does not currently expire, and has no self-service
recovery/revocation flow. Save it before leaving the receipt page; it is not
retrievable from the IT dashboard. Existing tickets have no tracking token and
continue to work in the IT dashboard.

## IT workflow

Open **Conversation & history** on a ticket card. Admins and Agents can choose:

- **Reply to employee**: visible on the private employee tracking page.
- **Internal note — IT only**: visible to authenticated IT staff, including Viewers.

Viewers can read the conversation but cannot post. Employee replies are marked
as employee messages, even if a request supplies a different author name/role.
The employee view uses **IT support** instead of staff names and omits assignee
changes, requester contact fields, and internal notes.

Status and assignment changes record the previous/new values, staff display name,
account ID, and timestamp in `ticket_events`. Updates and events commit as one
SQL statement; setting an unchanged value creates no event. Events cannot be
edited through the API. This is an application activity log, not an independently
tamper-proof audit system.

Each view returns up to the newest 100 comments and 100 events in chronological
order. Older entries remain in the database; this release has no history pagination.
Messages are plain text, limited to 5,000 characters, and cannot be edited/deleted
through the API. Replies remain available on resolved/closed tickets; replies
do not automatically reopen a ticket.

## API

| Method | Route | Authorization |
|---|---|---|
| `GET` | `/api/tracking/:id` | Matching `X-Ticket-Token`; public ticket fields and timeline |
| `POST` | `/api/tracking/:id/comments` | Matching token; `{ "body": "…" }` employee reply |
| `GET` | `/api/tracking/:id/attachment` | Matching token; original image |
| `GET` | `/api/tickets/:id/conversation` | IT `tickets:read` permission |
| `POST` | `/api/tickets/:id/comments` | IT `tickets:update`; `{ "body": "…", "internal": false }` |

`POST /api/tickets` returns `tracking_token` once alongside the new ticket.
General IT ticket responses never return the token or its hash. Tracking and
conversation responses use `Cache-Control: no-store`. Serve the application over
HTTPS before using private links across an untrusted network.

## Migration and validation

Migration `006_ticket_conversations.sql` adds a nullable tracking hash to tickets
and creates `ticket_comments` and `ticket_events`. Existing rows are preserved;
old changes are not reconstructed. Database backups include both new tables.
Rolling back an image leaves these additive schema changes in place.

Backend tests cover token validation, author spoofing, comment validation, and
role/password-change restrictions. The isolated integration test additionally
checks real database audit events, public/private separation, attachment access,
and cross-ticket token rejection.
