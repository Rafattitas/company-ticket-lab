#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 FULL_COMMIT_SHA" >&2
  exit 2
fi

release_sha="$1"

if [[ ! "$release_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Release SHA must contain exactly 40 lowercase hexadecimal characters." >&2
  exit 2
fi

repo_dir="/srv/company-ticket/repository"
compose_file="$repo_dir/deploy/compose.yaml"
image_env="/etc/company-ticket/images.env"
host_env="/etc/company-ticket/host.env"
backup_dir="/var/backups/company-ticket"
backup_retention_count=10
lock_file="/run/lock/company-ticket-deploy.lock"

# Serialize deployments so two workflow runs cannot modify Compose state or the
# active image reference file at the same time.
exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Another deployment is already running." >&2
  exit 1
fi

for required_file in \
  /etc/company-ticket/secrets/postgres_password \
  /etc/company-ticket/secrets/postgres_app_password \
  "$host_env" \
  "$image_env"
do
  if [ ! -f "$required_file" ]; then
    echo "Required file is missing: $required_file" >&2
    exit 1
  fi
done

# This root-owned file contains deployment settings rather than secrets. The
# address must belong to the VM so Docker cannot accidentally publish the UI on
# an unexpected interface.
set -a
# shellcheck disable=SC1090
source "$host_env"
set +a

if [[ ! "${FRONTEND_BIND_ADDRESS:-}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  echo "FRONTEND_BIND_ADDRESS must be an IPv4 address." >&2
  exit 1
fi

if ! ip -4 address show | grep -Fq " $FRONTEND_BIND_ADDRESS/"; then
  echo "FRONTEND_BIND_ADDRESS is not assigned to this host." >&2
  exit 1
fi

echo "Fetching source code..."
git -C "$repo_dir" fetch --quiet --prune origin main

# Accept only reviewed commits reachable from the remote main branch.
if ! git -C "$repo_dir" cat-file -e "${release_sha}^{commit}"; then
  echo "Commit does not exist: $release_sha" >&2
  exit 1
fi

if ! git -C "$repo_dir" merge-base --is-ancestor \
  "$release_sha" origin/main
then
  echo "Commit is not part of origin/main." >&2
  exit 1
fi

git -C "$repo_dir" checkout --quiet --detach "$release_sha"

candidate_env="$(mktemp /etc/company-ticket/images.env.candidate.XXXXXX)"
previous_env="$(mktemp /etc/company-ticket/images.env.previous.XXXXXX)"

# Keep the active references unchanged while Compose validates and pulls the
# candidate release.
cp "$image_env" "$previous_env"

cat > "$candidate_env" <<ENV
BACKEND_IMAGE=ghcr.io/rafattitas/company-ticket-backend:sha-${release_sha}
FRONTEND_IMAGE=ghcr.io/rafattitas/company-ticket-frontend:sha-${release_sha}
POSTGRES_IMAGE=ghcr.io/rafattitas/company-ticket-postgres:sha-${release_sha}
ENV

chmod 0644 "$candidate_env"

current_compose=(
  docker compose
  --env-file "$image_env"
  --env-file "$host_env"
  --file "$compose_file"
)

candidate_compose=(
  docker compose
  --env-file "$candidate_env"
  --env-file "$host_env"
  --file "$compose_file"
)

"${candidate_compose[@]}" config --quiet

install -d -m 0700 -o root -g root "$backup_dir"
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"

echo "Creating PostgreSQL backup..."

# Create both application data and cluster-role backups before changing images.
"${current_compose[@]}" exec -T postgres \
  pg_dump --username=postgres --dbname=ticket_db --format=custom \
  > "$backup_dir/${backup_stamp}_ticket_db.dump"

"${current_compose[@]}" exec -T postgres \
  pg_dumpall --username=postgres --globals-only \
  > "$backup_dir/${backup_stamp}_roles.sql"

chmod 0600 \
  "$backup_dir/${backup_stamp}_ticket_db.dump" \
  "$backup_dir/${backup_stamp}_roles.sql"

cat "$backup_dir/${backup_stamp}_ticket_db.dump" \
  | "${current_compose[@]}" exec -T postgres \
    pg_restore --list \
  > /dev/null

echo "Pulling release images..."
"${candidate_compose[@]}" pull

rollback_needed=0

rollback() {
  exit_code=$?

  # Image rollback restores the prior release. It cannot reverse a database
  # migration, which is why the validated pre-deployment backup is retained.
  if [ "$rollback_needed" -eq 1 ]; then
    echo "Deployment failed; restoring previous image references." >&2

    install -o root -g root -m 0644 \
      "$previous_env" "$image_env"

    docker compose \
      --env-file "$image_env" \
      --env-file "$host_env" \
      --file "$compose_file" \
      up --detach --wait --wait-timeout 120 || true
  fi

  rm -f "$candidate_env" "$previous_env"
  exit "$exit_code"
}

trap rollback ERR

install -o root -g root -m 0644 \
  "$candidate_env" "$image_env"

rollback_needed=1

docker compose \
  --env-file "$image_env" \
  --env-file "$host_env" \
  --file "$compose_file" \
  up --detach --wait --wait-timeout 120

curl --fail --silent --show-error \
  "http://${FRONTEND_BIND_ADDRESS}:8080/api/tickets" \
  > /dev/null

rollback_needed=0
trap - ERR

rm -f "$candidate_env" "$previous_env"

echo "Applying backup retention policy..."

# Backup filenames begin with sortable UTC timestamps. Keeping the first ten
# database dumps also keeps the matching role dump for each retained set.
mapfile -t backup_dumps < <(
  find "$backup_dir" \
    -maxdepth 1 \
    -type f \
    -name '*_ticket_db.dump' \
    -printf '%f\n' \
    | sort --reverse
)

if [ "${#backup_dumps[@]}" -gt "$backup_retention_count" ]; then
  for ((
    index=backup_retention_count;
    index<${#backup_dumps[@]};
    index++
  )); do
    backup_dump="${backup_dumps[$index]}"
    backup_prefix="${backup_dump%_ticket_db.dump}"

    rm -f -- \
      "$backup_dir/$backup_dump" \
      "$backup_dir/${backup_prefix}_roles.sql"

    echo "Removed old backup set: $backup_prefix"
  done
fi

echo "Deployment succeeded: $release_sha"

docker compose \
  --env-file "$image_env" \
  --env-file "$host_env" \
  --file "$compose_file" \
  ps
