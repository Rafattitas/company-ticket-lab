# Email notifications

TicketDesk queues an email when a ticket status, technician assignment, or
routing department actually changes, or when IT posts a public reply. Repeating
the same value does not create another event/email. Internal notes, employee
replies, and new ticket submissions do not send email. The recipient is the
email address entered by the requester; it is not verified by the system.

## What the email contains

Only the ticket reference, status at the time of the event, and a generic update
reason. It never includes descriptions, screenshots, comment text, staff
identities, or private tracking tokens. Users open the private link saved at
submission to see details. Email replies are not ingested by TicketDesk.

## Configure SMTP

Sending is off by default. Supply your own SMTP service and authorized sender.
Copy `deploy/mail.env.example` to `/etc/company-ticket/mail.env` on production;
Compose loads that optional file directly. Make it `root:root`, mode `0600`, and
edit the credential on the server. Do not paste the password into chat, commit
it to Git, or add it to workflow logs. `SMTP_PASSWORD_FILE` is also supported
when your deployment separately mounts a readable credential file.

Required: `SMTP_ENABLED=true`, `SMTP_HOST`, `SMTP_FROM`. Port defaults to 587.
If your relay requires login, add `SMTP_USER` and `SMTP_PASSWORD`. Port 465 uses
implicit TLS; other ports require STARTTLS. Certificate validation stays on.
`PUBLIC_APP_URL` is optional and must be an origin such as
`https://tickets.example.com`, with no path, credentials, query, or fragment.

For quickstart, put the same settings in `.env.mail` (ignored by Git). Keep the
file private to your user. Compose optional env files require version 2.24+.
Never configure CI with production SMTP: its tests use isolated fake delivery.

After changing production mail settings, recreate only the backend:

```bash
sudo docker compose \
  --env-file /etc/company-ticket/images.env \
  --env-file /etc/company-ticket/host.env \
  --file /srv/company-ticket/repository/deploy/compose.yaml \
  up --detach --wait --wait-timeout 120 --no-deps --force-recreate backend
```

Recreate the frontend afterwards if its Nginx upstream caches the old backend
address. The backend joins a dedicated bridge for outbound SMTP, publishes no
API port, and retains the internal database network.

## Reliability and monitoring

Migration `008_email_notifications.sql` adds an outbox and database triggers.
Changes and their notifications commit atomically. The worker processes one
notification every five seconds, claims it with a five-minute lease, and retries
up to six attempts with increasing delay (2/4/8/16/32/60 minutes). Unsent records
older than 24 hours expire when delivery runs, avoiding an old backlog flood
when SMTP is first enabled. Existing historical events are not backfilled.
The outbox contains recipients and is included in database backups.

An SMTP failure does not undo the saved ticket update. Invalid SMTP settings
leave the API available and show an administrator configuration warning. In
Reports & targets, administrators see pending/sending/sent/failed/expired counts.
`sent` means SMTP accepted the message; inbox delivery, spam handling, bounces,
and sender-domain SPF/DKIM configuration belong to the mail provider.

Delivery is at least once: a process crash after SMTP acceptance but before the
outbox update can produce a duplicate. A stable Message-ID helps identify it,
but does not guarantee deduplication. Failed/expired messages are retained for
review; there is no automatic purge or resend button in this version. Worker
logs contain notification IDs and bounded error codes, never raw SMTP errors
or credentials. Do not expose the outbox/status endpoint publicly.

## Verify an enabled installation

Use a controlled employee inbox: change a test ticket status or add a public IT
reply, refresh the delivery counts, and check the inbox. Add an internal note
and confirm no email is sent. Check the spam folder/provider logs for accepted
messages that do not arrive. Until this real-inbox test succeeds, deployment
health alone is not evidence of working email delivery.
