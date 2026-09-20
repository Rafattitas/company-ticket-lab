# Contributing

## Workflow

1. Synchronize `main`.
2. Create a short-lived branch.
3. Make one focused change.
4. Run the relevant local checks.
5. Commit with a clear message.
6. Push the branch and open a pull request.
7. Merge only after the `verify` job succeeds.
8. Delete merged local and remote branches.

Do not commit directly to `main`.

## Branch names

Use a short category and description:

```text
feat/ticket-filtering
fix/backend-validation
ci/cache-images
cd/deployment-guard
docs/platform-documentation
ops/backup-retention
```

## Commit messages

Use an imperative description with an optional scope:

```text
feat(backend): add ticket API endpoint
fix(postgres): patch runtime package
ci: scan container images with Trivy
docs: document platform operations
```

## Required checks

Backend:

```bash
npm ci
npm test
```

Frontend:

```bash
npm ci
npm run lint
npm run build
```

Workflow syntax:

```bash
docker run --rm \
  --mount type=bind,src="$PWD",dst=/repo,readonly \
  --workdir /repo \
  rhysd/actionlint:1.7.12
```

The GitHub `verify` job repeats these checks in a clean environment, builds all container images, runs the temporary integration environment, and applies the Trivy gate.

## Secrets and generated files

Never commit:

- database passwords;
- private SSH keys;
- GitHub tokens;
- `.env` files containing credentials;
- `node_modules/`;
- Vite `dist/` output;
- database dumps.

Production secrets belong under `/etc/company-ticket/secrets/` on the VM. Image references belong in `/etc/company-ticket/images.env`; `deploy/images.env.example` contains placeholders only.

Before committing, inspect staged content:

```bash
git diff --cached --check
git diff --cached --stat
git status --short
```

## Pull requests

A pull request should explain:

- the problem being solved;
- the resulting behavior;
- how the change was validated;
- any deployment, migration, or rollback concern.

Pull requests run `verify`. Image publication and production deployment are intentionally skipped until the change is merged to `main`.
