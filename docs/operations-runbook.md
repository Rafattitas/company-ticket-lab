# Operations runbook

Run operational commands on the Ubuntu VM unless a section says otherwise.

## Service status

```bash
sudo docker compose \
  --env-file /etc/company-ticket/images.env \
  --env-file /etc/company-ticket/host.env \
  --file /srv/company-ticket/repository/deploy/compose.yaml \
  ps
```

All three services should report `healthy`.

## Application checks

```bash
source /etc/company-ticket/host.env
curl -fsS "http://${FRONTEND_BIND_ADDRESS}:8080/"
curl -fsS "http://${FRONTEND_BIND_ADDRESS}:8080/api/tickets"
```

The first command verifies Nginx and the compiled frontend. The second verifies the reverse proxy, backend, database connection, and ticket query.

## Logs

```bash
sudo docker compose \
  --env-file /etc/company-ticket/images.env \
  --env-file /etc/company-ticket/host.env \
  --file /srv/company-ticket/repository/deploy/compose.yaml \
  logs --tail 100 backend

sudo docker compose \
  --env-file /etc/company-ticket/images.env \
  --env-file /etc/company-ticket/host.env \
  --file /srv/company-ticket/repository/deploy/compose.yaml \
  logs --tail 100 frontend

sudo docker compose \
  --env-file /etc/company-ticket/images.env \
  --env-file /etc/company-ticket/host.env \
  --file /srv/company-ticket/repository/deploy/compose.yaml \
  logs --tail 100 postgres
```

Add `--follow` only while actively watching logs; stop it with `Ctrl+C`.

## Current release

```bash
sudo cat /etc/company-ticket/images.env

sudo git -C /srv/company-ticket/repository \
  log --oneline -1
```

The commit in the protected checkout should match the SHA used in all three image tags.

## Self-hosted runner

```bash
sudo systemctl status \
  actions.runner.Rafattitas-company-ticket-lab.lab-prod.service

sudo journalctl \
  -u actions.runner.Rafattitas-company-ticket-lab.lab-prod.service \
  --since "30 minutes ago" \
  --no-pager
```

If a deployment job remains queued, confirm:

1. the service is `active`;
2. GitHub shows the runner as online and idle;
3. the runner has `production` and `company-ticket` labels;
4. the production approval was granted.

## Backups

```bash
sudo find /var/backups/company-ticket \
  -maxdepth 1 \
  -type f \
  -printf '%TY-%Tm-%Td %TH:%TM %10s %f\n' \
  | sort --reverse
```

Each backup set contains:

```text
<timestamp>_ticket_db.dump
<timestamp>_roles.sql
```

The deployment script validates every new database dump with `pg_restore --list` and retains the latest ten sets. Restore operations should be rehearsed in a temporary PostgreSQL container before changing the active database.

## Disk usage

```bash
df -hT /var/lib/docker /var/backups/company-ticket
sudo docker system df
sudo du -sh /var/backups/company-ticket
```

Do not run broad prune commands without reviewing which images, containers, and volumes they will remove. The PostgreSQL external volume contains the active application data.

## Network checks

```bash
sudo docker network inspect company-ticket-internal
sudo ss -lntup
sudo ufw status verbose
sudo cat /etc/company-ticket/host.env
```

Expected host exposure:

- SSH on port `22` for administration and database tunnelling.
- Frontend on the configured VM LAN address at port `8080`.
- PostgreSQL on `127.0.0.1:15432` only.
- No host-published backend port.

From another device on the same LAN, open:

```text
http://<FRONTEND_BIND_ADDRESS>:8080
```

If the VM address is assigned by DHCP, reserve it on the router before relying
on this URL. The application currently has no login, so access to port `8080`
must be limited to the trusted LAN.

## Failed deployment

1. Open the failed `Deploy production` job and read the first failing command.
2. Check the VM service and container logs.
3. Read `/etc/company-ticket/images.env` to see whether rollback restored the previous release.
4. Confirm the API through the configured LAN address.
5. Keep the pre-deployment backup until the incident is resolved.

The deployment script attempts an image rollback when failure occurs after activating the new image references. Database changes made by a migration require a compatible database restore or forward fix; image rollback alone cannot reverse schema or data changes.

## Workstation access

Devices on the trusted LAN open `http://<VM-LAN-IP>:8080`. PostgreSQL remains
on VM loopback and requires the SSH tunnel described in
[Database access](database-access.md).
