#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 BACKEND_IMAGE POSTGRES_IMAGE" >&2
  exit 2
fi

backend_image="$1"
postgres_image="$2"
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
suffix="$(date +%s)-$$"
network_name="company-ticket-ci-${suffix}"
volume_name="company-ticket-ci-data-${suffix}"
postgres_name="company-ticket-ci-postgres-${suffix}"
backend_name="company-ticket-ci-backend-${suffix}"
secret_dir="$(mktemp -d)"

cleanup() {
  docker rm -f "$backend_name" "$postgres_name" >/dev/null 2>&1 || true
  docker volume rm "$volume_name" >/dev/null 2>&1 || true
  docker network rm "$network_name" >/dev/null 2>&1 || true
  rm -rf "$secret_dir"
}

trap cleanup EXIT

wait_for_postgres() {
  for attempt in $(seq 1 90); do
    if docker exec "$postgres_name" \
      pg_isready --host=127.0.0.1 --username=postgres --dbname=postgres >/dev/null 2>&1; then
      return 0
    fi

    sleep 1
  done

  docker logs "$postgres_name"
  return 1
}

wait_for_backend() {
  for attempt in $(seq 1 90); do
    status="$(docker inspect \
      --format '{{.State.Health.Status}}' \
      "$backend_name")"

    if [ "$status" = "healthy" ]; then
      return 0
    fi

    sleep 1
  done

  docker logs "$backend_name"
  return 1
}

umask 077
openssl rand -base64 32 > "$secret_dir/postgres_admin_password"
openssl rand -base64 32 > "$secret_dir/postgres_app_password"

chown root:987 "$secret_dir/postgres_app_password"
chmod 0640 "$secret_dir/postgres_app_password"

docker network create --internal "$network_name" >/dev/null
docker volume create "$volume_name" >/dev/null

docker run --detach \
  --name "$postgres_name" \
  --network "$network_name" \
  --network-alias postgres \
  --mount "type=volume,src=${volume_name},dst=/var/lib/postgresql/data" \
  --mount "type=bind,src=${secret_dir}/postgres_admin_password,dst=/run/secrets/postgres_admin_password,readonly" \
  --env POSTGRES_PASSWORD_FILE=/run/secrets/postgres_admin_password \
  --env POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 \
  "$postgres_image" >/dev/null

wait_for_postgres

app_password="$(cat "$secret_dir/postgres_app_password")"

docker exec -i \
  --env APP_PASSWORD="$app_password" \
  "$postgres_name" \
  sh -c 'psql --username postgres --dbname postgres --set=ON_ERROR_STOP=1 --set=app_password="$APP_PASSWORD"' <<'SQL'
SELECT format(
  'CREATE ROLE ticket_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
  :'app_password'
) \gexec

CREATE DATABASE ticket_db OWNER ticket_app;
REVOKE ALL ON DATABASE ticket_db FROM PUBLIC;
SQL

unset app_password

docker run --rm \
  --entrypoint sh \
  --network "$network_name" \
  --mount "type=bind,src=${repo_dir}/backend/migrations,dst=/migrations,readonly" \
  --mount "type=bind,src=${secret_dir}/postgres_app_password,dst=/run/secrets/postgres_app_password,readonly" \
  "$postgres_image" \
  -ceu 'export PGPASSWORD="$(cat /run/secrets/postgres_app_password)"; for migration in /migrations/*.sql; do psql --host=postgres --username=ticket_app --dbname=ticket_db --set=ON_ERROR_STOP=1 --file="$migration"; done'

docker run --detach \
  --name "$backend_name" \
  --network "$network_name" \
  --network-alias backend \
  --group-add 987 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --mount "type=bind,src=${secret_dir}/postgres_app_password,dst=/run/secrets/postgres_app_password,readonly" \
  --env NODE_ENV=production \
  --env DB_HOST=postgres \
  --env DB_PORT=5432 \
  --env DB_NAME=ticket_db \
  --env DB_USER=ticket_app \
  --env DB_PASSWORD_FILE=/run/secrets/postgres_app_password \
  --env ADMIN_USERNAME=ci-admin \
  --env ADMIN_PASSWORD=ci-admin-password-12345 \
  "$backend_image" >/dev/null

wait_for_backend

docker run --rm \
  --network "$network_name" \
  node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 \
  node -e '
const baseUrl = "http://backend:3000";
let cookie = "";

async function request(path, options) {
  const requestOptions = options || {};
  requestOptions.headers = { ...(requestOptions.headers || {}), ...(cookie ? { cookie } : {}) };
  const response = await fetch(`${baseUrl}${path}`, requestOptions);
  if (response.headers.get("set-cookie")) {
    cookie = response.headers.get("set-cookie").split(";")[0];
  }
  const body = response.status === 204 ? null : await response.json();

  if (!response.ok) {
    throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

(async () => {
  await request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ci-admin", password: "ci-admin-password-12345" }),
  });

  const blockedBeforePasswordChange = await fetch(`${baseUrl}/api/tickets`, { headers: { cookie } });
  if (blockedBeforePasswordChange.status !== 403) {
    throw new Error("Temporary password unexpectedly received ticket access");
  }

  await request("/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      current_password: "ci-admin-password-12345",
      new_password: "ci-admin-password-changed-12345",
    }),
  });

  await request("/api/auth/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "ci-agent",
      display_name: "CI support agent",
      password: "ci-agent-password-12345",
      role: "agent",
    }),
  });

  await request("/api/auth/logout", { method: "POST" });
  cookie = "";
  await request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ci-agent", password: "ci-agent-password-12345" }),
  });

  await request("/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      current_password: "ci-agent-password-12345",
      new_password: "ci-agent-password-changed-12345",
    }),
  });

  const forbiddenAccounts = await fetch(`${baseUrl}/api/auth/accounts`, { headers: { cookie } });
  if (forbiddenAccounts.status !== 403) {
    throw new Error("Agent unexpectedly received account-management permission");
  }

  const created = await request("/api/tickets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "CI integration ticket",
      description: "Created by the temporary integration test",
      requester_name: "CI pipeline",
      requester_email: "ci@example.com",
      requester_phone: "+20 100 000 0000",
      category: "Software",
      priority: "high",
      attachment: {
        file_name: "test.png",
        content_type: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
    }),
  });

  await request(`/api/tickets/${created.ticket.id}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "in_progress" }),
  });

  const listed = await request("/api/tickets");
  const exists = listed.tickets.some(
    (ticket) => ticket.id === created.ticket.id && ticket.status === "in_progress",
  );

  if (!exists) {
    throw new Error("Created ticket was not returned by GET /api/tickets");
  }

  const attachment = await fetch(`${baseUrl}/api/tickets/${created.ticket.id}/attachment`, {
    headers: { cookie },
  });
  if (!attachment.ok || attachment.headers.get("content-type") !== "image/png") {
    throw new Error("Ticket attachment was not returned correctly");
  }

  console.log("Integration test passed");
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
'

echo "Integration test passed; cleanup runs on exit."
