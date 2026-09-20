# Deployment

## Release model

Every merge to `main` starts the `CI/CD Pipeline` workflow.

| Job | Runner | Runs on pull request | Runs on `main` | Responsibility |
|---|---|---:|---:|---|
| `verify` | GitHub-hosted Ubuntu | Yes | Yes | Test, build, integrate, and scan |
| `publish` | GitHub-hosted Ubuntu | No | Yes | Push the tested images to GHCR |
| `deploy` | `lab-prod` self-hosted runner | No | Yes, after approval | Deploy the published commit to the VM |

The three images use the same traceable tag:

```text
ghcr.io/rafattitas/company-ticket-backend:sha-<full-commit-sha>
ghcr.io/rafattitas/company-ticket-frontend:sha-<full-commit-sha>
ghcr.io/rafattitas/company-ticket-postgres:sha-<full-commit-sha>
```

## Verification job

The verification job performs these steps in order:

1. Check out source without persisting GitHub credentials.
2. Install backend dependencies with `npm ci` and run unit tests.
3. Install frontend dependencies, run Oxlint, and build the Vite application.
4. Build backend, frontend, and PostgreSQL images.
5. Run a temporary integration environment with an isolated network, volume, database, role, migration, and API request.
6. Scan all three images with Trivy.
7. On `main`, export the exact tested images as a short-lived workflow artifact.

The integration script always removes its temporary containers, network, volume, and secret directory through an exit trap.

## Publish job

The publish job downloads and loads the image artifact produced by `verify`. It does not rebuild the images. This ensures GHCR receives the same image content that passed testing and scanning.

The job authenticates to GHCR with the workflow-scoped `GITHUB_TOKEN`, publishes all three images, and logs out even if a later command fails.

## Production approval

The `production` GitHub Environment:

- allows deployments from `main` only;
- requires the configured reviewer to approve the deployment;
- contains no database passwords or application secrets.

After approval, GitHub schedules the job only on a runner with all of these labels:

```text
self-hosted, Linux, X64, production, company-ticket
```

## Deployment host layout

| Path | Owner | Purpose |
|---|---|---|
| `/srv/company-ticket/repository` | `root:root` | Protected deployment checkout |
| `/usr/local/sbin/company-ticket-deploy` | `root:root`, mode `0755` | Installed deployment command |
| `/etc/company-ticket/images.env` | `root:root`, mode `0644` | Current GHCR image references; contains no secrets |
| `/etc/company-ticket/host.env` | `root:root`, mode `0644` | VM-specific LAN bind address; contains no secrets |
| `/etc/company-ticket/secrets/` | `root:root`, mode `0700` | PostgreSQL secret files |
| `/var/backups/company-ticket/` | `root:root`, mode `0700` | Logical database backups |
| `/var/lib/docker/` | Docker-managed | Images, containers, networks, and volumes |

The tracked `deploy/production-deploy.sh` file is the reviewed source for the installed command. Updating the tracked file does not automatically replace the root-owned copy; installation is a separate administrative action.

## Host network configuration

Before deploying this Compose version, verify the VM's current LAN address:

```bash
ip -4 address show scope global
```

Reserve that address in DHCP or configure a static address, then create the
root-owned host settings file. Replace the example address when the VM reports
a different value:

```bash
printf '%s\n' 'FRONTEND_BIND_ADDRESS=192.168.1.162' \
  | sudo tee /etc/company-ticket/host.env > /dev/null

sudo chown root:root /etc/company-ticket/host.env
sudo chmod 0644 /etc/company-ticket/host.env
```

The deployment command rejects an invalid address and an address that is not
assigned to the VM. Devices on the trusted LAN then use
`http://192.168.1.162:8080`, substituting the configured address.

## Deployment transaction

`company-ticket-deploy <full-commit-sha>` performs the following controls:

1. Acquires a lock so two deployments cannot run concurrently.
2. Validates the SHA format and confirms the commit belongs to `origin/main`.
3. Checks out the exact commit in the protected deployment repository.
4. Creates candidate image references without replacing the active file.
5. Validates the candidate Compose configuration.
6. Creates and validates a PostgreSQL database dump and a roles dump.
7. Pulls all candidate images from GHCR.
8. Atomically activates the candidate image reference file.
9. Runs `docker compose up --detach --wait`.
10. Calls the ticket API through the published frontend endpoint.
11. Keeps the latest ten local backup sets.
12. Prints the final Compose service state.

If Compose or the API check fails after activation, the error trap restores the previous image references and attempts to start the previous release.

## Manual verification

Run these commands on the VM after a deployment:

```bash
sudo docker compose \
  --env-file /etc/company-ticket/images.env \
  --env-file /etc/company-ticket/host.env \
  --file /srv/company-ticket/repository/deploy/compose.yaml \
  ps

source /etc/company-ticket/host.env
curl -fsS "http://${FRONTEND_BIND_ADDRESS}:8080/api/tickets"

sudo ls -lht /var/backups/company-ticket | head
```

Expected results:

- PostgreSQL, backend, and frontend are `healthy`.
- The API returns the existing tickets.
- A new pair of backup files exists for the deployment timestamp.

## Manual deployment

Manual execution is reserved for administrative recovery or testing:

```bash
sudo /usr/local/sbin/company-ticket-deploy <full-main-commit-sha>
```

The script rejects abbreviated SHAs, non-hexadecimal values, and commits that are not reachable from `origin/main`.
