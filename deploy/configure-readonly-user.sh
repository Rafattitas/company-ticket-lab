#!/usr/bin/env bash
set -Eeuo pipefail

repo_dir="${REPO_DIR:-/srv/company-ticket/repository}"
compose_file="$repo_dir/deploy/compose.yaml"
image_env="${IMAGE_ENV:-/etc/company-ticket/images.env}"
host_env="${HOST_ENV:-/etc/company-ticket/host.env}"

for required_file in \
  "$compose_file" \
  "$image_env" \
  "$host_env" \
  /etc/company-ticket/secrets/postgres_readonly_password
do
  if [ ! -f "$required_file" ]; then
    echo "Required file is missing: $required_file" >&2
    exit 1
  fi
done

compose=(
  docker compose
  --env-file "$image_env"
  --env-file "$host_env"
  --file "$compose_file"
)

if ! "${compose[@]}" ps --status running postgres --quiet | grep -q .; then
  echo "PostgreSQL is not running." >&2
  exit 1
fi

reader_password="$(cat /etc/company-ticket/secrets/postgres_readonly_password)"

# A fixed hexadecimal format lets psql receive the password through standard
# input without exposing it in process arguments or shell tracing.
if [[ ! "$reader_password" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Read-only password must contain exactly 64 hexadecimal characters." >&2
  exit 1
fi

{
  printf '\\set reader_password %s\n' "$reader_password"
  cat <<'SQL'
SELECT format(
  'CREATE ROLE ticket_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
  :'reader_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'ticket_reader'
) \gexec

ALTER ROLE ticket_reader
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  PASSWORD :'reader_password';
ALTER ROLE ticket_reader SET default_transaction_read_only = on;

GRANT CONNECT ON DATABASE ticket_db TO ticket_reader;
GRANT USAGE ON SCHEMA public TO ticket_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ticket_reader;

ALTER DEFAULT PRIVILEGES FOR ROLE ticket_app IN SCHEMA public
  GRANT SELECT ON TABLES TO ticket_reader;
SQL
} | "${compose[@]}" exec -T postgres \
  psql --username=postgres --dbname=ticket_db --set=ON_ERROR_STOP=1

echo "Read-only PostgreSQL role ticket_reader is configured."
