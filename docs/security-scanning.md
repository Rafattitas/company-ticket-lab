# Image vulnerability scanning

## Pipeline behavior

GitHub Actions runs `deploy/scan-images.sh` after building the backend, frontend, and PostgreSQL images. Trivy reports HIGH and CRITICAL findings for each image before the script applies the blocking gate.

The gate fails on fixable HIGH or CRITICAL findings in:

- the complete backend image;
- the complete frontend image;
- operating-system packages in the PostgreSQL image.

`--ignore-unfixed` keeps findings without an available fix visible in the summary without permanently blocking every release. Findings must be reviewed again when base images or Trivy vulnerability data change.

## PostgreSQL scope exception

PostgreSQL language-library and binary findings are reported but are not currently part of the blocking gate. On 2026-09-16, Trivy reported 21 HIGH and 1 CRITICAL finding in the `gosu` binary included by the upstream PostgreSQL image.

The CRITICAL finding, CVE-2025-68121, concerns Go TLS session resumption. In this image, `gosu` switches the process user during PostgreSQL startup. The affected TLS behavior appears unrelated to that use, but reachability has not been verified with `govulncheck`.

This is a documented review item, not a declaration that the finding is harmless. A passing gate is not independent approval for a production deployment.

## Local scan

After building all three images, run:

```bash
bash deploy/scan-images.sh \
  company-ticket-backend:ci \
  company-ticket-frontend:ci \
  company-ticket-postgres:ci
```

The script exits nonzero when a finding inside the configured gate is detected. In CI, that stops the workflow before image publication.

## Secret scanning

Secrets are stored outside the repository. A filesystem scan can be run before publication:

```bash
docker run --rm \
  --mount type=bind,src="$PWD",dst=/repo,readonly \
  aquasec/trivy:0.74.0 \
  fs --scanners secret --exit-code 1 --quiet /repo
```

Never commit generated password files, private keys, GitHub tokens, database dumps, or production `.env` files.

## References

- [Go issue for CVE-2025-68121](https://github.com/golang/go/issues/77113)
- [`gosu` security policy](https://github.com/tianon/gosu/security)
