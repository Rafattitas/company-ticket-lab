# Read-only database access

Administrators can inspect `ticket_db` with DBeaver without publishing
PostgreSQL to the LAN. Docker binds PostgreSQL to `127.0.0.1:15432` on the VM,
and the workstation reaches that loopback port through SSH.

The PostgreSQL container remains on the internal application network and also
joins a dedicated `database_management` bridge. Docker requires a non-internal
gateway network to activate a published port. No other application service
joins this management bridge, and the published address remains host loopback.

```text
DBeaver localhost:15432
    → encrypted SSH connection to the VM
    → VM 127.0.0.1:15432
    → PostgreSQL container 5432
```

## Configure the VM

Generate a dedicated password on the Ubuntu VM. Do not commit or paste this
password into GitHub:

```bash
sudo install -d -m 0700 -o root -g root /etc/company-ticket/secrets

openssl rand -hex 32 \
  | sudo tee /etc/company-ticket/secrets/postgres_readonly_password \
  > /dev/null

sudo chown root:root \
  /etc/company-ticket/secrets/postgres_readonly_password
sudo chmod 0600 \
  /etc/company-ticket/secrets/postgres_readonly_password
```

After the Compose change is deployed, configure or rotate the role:

```bash
sudo bash /srv/company-ticket/repository/deploy/configure-readonly-user.sh
```

The script creates `ticket_reader` when needed, rotates its password to match
the secret file, grants access to `ticket_db`, and grants `SELECT` on current and
future tables created by `ticket_app`. It also sets transactions to read-only by
default.

## Open the SSH tunnel

Keep this PowerShell window open on the workstation:

```powershell
ssh -N -L 15432:127.0.0.1:15432 rafat@VM_LAN_IP
```

The first `15432` is the workstation port. The second address and port belong
to the VM. Closing the SSH process closes database access.

## Configure DBeaver Community

Create a PostgreSQL connection with:

| Setting | Value |
|---|---|
| Host | `127.0.0.1` |
| Port | `15432` |
| Database | `ticket_db` |
| Username | `ticket_reader` |
| Password | Contents of the VM read-only password file |

Use **Test Connection**, then expand:

```text
ticket_db → Schemas → public → Tables → tickets → View Data
```

The role can run `SELECT` queries. PostgreSQL rejects `INSERT`, `UPDATE`,
`DELETE`, schema changes, role changes, and database creation.

## Verify the role

On the VM:

```bash
sudo docker compose \
  --env-file /etc/company-ticket/images.env \
  --env-file /etc/company-ticket/host.env \
  --file /srv/company-ticket/repository/deploy/compose.yaml \
  exec -T postgres \
  psql --username=postgres --dbname=ticket_db \
  --command='\du+ ticket_reader'
```

Do not publish PostgreSQL as `0.0.0.0:5432` or as the VM LAN address. The SSH
tunnel provides encryption and requires an authenticated VM account.
