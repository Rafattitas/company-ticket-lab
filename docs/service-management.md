# Departments, service targets, and reports

## Routing and assignment

Employees can choose an active department when opening a ticket. A blank choice
routes to the active `IT Support` department, if available. Initial departments
are IT Support, Infrastructure, and Applications. Categories remain a separate
description of the issue type.

Admins manage departments from **Reports & targets**. Disabling a department
removes it from new routing choices; existing tickets and report history remain.
Agents and Admins can change a ticket's department and select an active Admin or
Agent as its technician. Viewers cannot assign or edit tickets. Assignment and
department changes appear in the internal activity log.

Old free-text assignees remain visible as legacy assignments. Selecting a
technician links the ticket to an account ID. Existing assignments are retained
if a technician is later disabled or demoted; IT can reassign those tickets.
Departments organize work, not access: all IT roles can still read tickets across
departments. This release does not implement department membership or automatic
load balancing.

## Service-level targets (SLA)

| Priority | First response | Resolution |
|---|---|---|
| Urgent | 1 hour | 8 hours |
| High | 4 hours | 24 hours |
| Normal | 8 hours | 72 hours |
| Low | 24 hours | 120 hours |

Admins can change these policies. Durations must be whole hours between 1 and
8,760, and resolution cannot be shorter than response. Each new ticket snapshots
its deadlines when created, so policy changes affect future tickets only.

Targets count elapsed time including nights/weekends. There is no business-hours
calendar, paused/waiting state, escalation notification, or automatic reopening.
The first public staff reply records `first_response_at`. Internal notes and
employee replies do not stop that timer. Switching to Resolved or Closed records
`resolved_at`; switching between terminal states preserves that timestamp.
Reopening clears it and retains the original deadlines.

Queue cards display deadlines and overdue/met status. Their clock refreshes every
minute; use **Refresh queue** to fetch new replies/state changes. Tickets created
before migration 007 have no deadlines and are marked as legacy. No historical
response/resolution times are fabricated.

## Reports

Reports use database aggregates over all tickets, independently of the dashboard's
200-ticket queue page. IT accounts can read reports; only Admins change settings.
Choose a 7, 30, 90, or 365-day period and use **Refresh report** for a new snapshot.

- Created/resolved totals, department counts, and time averages use tickets
  created within the selected rolling period. Resolved includes Closed.
- Average resolution uses currently resolved tickets with recorded resolution
  times and SLA deadlines. Average response uses recorded first public replies.
  A missing average displays “Not measured yet”, not zero.
- Workload, unassigned, and overdue totals include **all** currently Open or
  In-progress tickets, including ones older than the period. No-SLA legacy work
  remains in workload totals but does not count as overdue.
- Response overdue means an outstanding ticket has no first response and its
  response deadline passed. Resolution overdue uses its resolution deadline.
- Workload groups linked technicians by account ID, with separate legacy/free-text
  assignments and unassigned work. Disabled technicians remain visible if work
  is still assigned to them.
- Daily requests are grouped by UTC creation date; the chart shows the latest
  30 dates with activity, while totals cover the whole selected period.

This is a current snapshot, not a historical workload-at-time report. Reopened
tickets leave the current resolved totals until resolved again. Reports are not
exported as CSV/PDF in this release.

## Schema and API

Migration `007_departments_and_sla.sql` adds department/policy tables, technician
IDs, deadlines, response/resolution timestamps, and a creation trigger. Changes
are additive and preserve existing tickets. Backups include these fields/tables.

| Method | Path | Access |
|---|---|---|
| GET | `/api/operations/departments` | Public active department names/IDs only |
| GET | `/api/operations/departments/all` | Admin |
| POST | `/api/operations/departments` | Admin; `{ "name": "…" }` |
| PATCH | `/api/operations/departments/:id` | Admin; `{ "active": false }` |
| GET | `/api/operations/staff` | IT read permission |
| GET | `/api/operations/slas` | IT read permission |
| PATCH | `/api/operations/slas/:priority` | Admin; response_hours/resolution_hours |
| GET | `/api/operations/reports?days=30` | IT read permission; days 1–365 |
| PATCH | `/api/tickets/:id/department` | IT update permission; department_id |
| PATCH | `/api/tickets/:id/assignment` | IT update permission; assignee_id or null |

The legacy `assigned_to` input remains supported for backward compatibility;
the UI uses `assignee_id`. Department choices must be active and technician IDs
must reference active Admin/Agent accounts. The private employee tracking API
continues to omit internal routing, assignee identity, and internal events.
