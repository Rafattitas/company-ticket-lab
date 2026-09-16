# Company Ticket Lab

A production-style Docker and DevOps training lab for a ticket application on an Ubuntu Server VM.

## Architecture

Browser -> SSH tunnel -> Nginx/React frontend -> Express API -> PostgreSQL

Nginx serves the React files and forwards /api requests to the backend.
Backend and PostgreSQL communicate on an internal Docker network.
Only the frontend is published on the VM loopback address, 127.0.0.1:8080.

## Implemented

- Multi-stage Dockerfiles for Backend and Frontend.
- Docker Compose with health checks, resource limits, and separate networks.
- PostgreSQL data in an external Docker volume.
- Host-managed secret files outside Git.
- Backend unit tests and Frontend lint/build checks.
- GitHub Actions CI configured to build and check the images.
- Trivy reports for all images and a scoped vulnerability gate.
- Database backup and restore drill.

## Security status

This is a training lab, not an approved production deployment.
The current Trivy gate scope and open gosu review are documented in
[docs/security-scanning.md](docs/security-scanning.md).

## Next steps

Publish the repository, run CI on GitHub, then add CD, Vault, and offline mirroring.
