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
  local result=$?
  if [ "$result" -ne 0 ]; then
    docker logs --tail 40 "$backend_name" 2>/dev/null || true
  fi
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
    throw new Error(`${requestOptions.method || "GET"} ${path}: ${response.status}: ${JSON.stringify(body)}`);
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

  const ciDepartment = await request("/api/operations/departments", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "CI Service Desk" }),
  });
  await request("/api/operations/slas/high", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ response_hours: 2, resolution_hours: 12 }),
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
      department_id: ciDepartment.department.id,
      attachment: {
        file_name: "test.png",
        content_type: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      },
    }),
  });

  const deadlineHours = (deadline) => (new Date(deadline) - new Date(created.ticket.created_at)) / 3600000;
  if (deadlineHours(created.ticket.response_due_at) !== 2 || deadlineHours(created.ticket.resolution_due_at) !== 12 || created.ticket.department_name !== "CI Service Desk") {
    throw new Error("New ticket did not snapshot the configured SLA/department");
  }
  const staffDirectory = await request("/api/operations/staff");
  const ciAgent = staffDirectory.staff.find((item) => item.display_name === "CI support agent");
  if (!ciAgent) throw new Error("Assignable staff directory is incomplete");

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

  const jsonHeaders = { "content-type": "application/json" };
  await request(`/api/tickets/${created.ticket.id}/assignment`, {
    method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ assignee_id: ciAgent.id }),
  });
  await request(`/api/tickets/${created.ticket.id}/status`, {
    method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ status: "in_progress" }),
  });
  await request(`/api/tickets/${created.ticket.id}/comments`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ body: "Private investigation note", internal: true }),
  });
  const beforePublicReply = await request(`/api/tickets/${created.ticket.id}`);
  if (beforePublicReply.ticket.first_response_at) throw new Error("Internal note incorrectly stopped the response timer");
  await request(`/api/tickets/${created.ticket.id}/comments`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ body: "Please restart the device.", internal: false }),
  });
  const afterPublicReply = await request(`/api/tickets/${created.ticket.id}`);
  if (!afterPublicReply.ticket.first_response_at) throw new Error("Public reply did not stop the response timer");
  const staffThread = await request(`/api/tickets/${created.ticket.id}/conversation`);
  if (staffThread.comments.length !== 2 || !staffThread.comments.some((item) => item.internal)) {
    throw new Error("Staff conversation lost the internal note");
  }
  const statusEvents = staffThread.events.filter((item) => item.kind === "status_changed");
  if (statusEvents.length !== 1 || statusEvents[0].old_value !== "open" || statusEvents[0].new_value !== "in_progress" || statusEvents[0].actor_name !== "CI support agent") {
    throw new Error("Status audit did not preserve actor/before/after or recorded a no-op");
  }
  if (!staffThread.events.some((item) => item.kind === "assignment_changed" && item.new_value === "CI support agent")) {
    throw new Error("Assignment audit is missing");
  }

  // Tracking never uses the staff cookie or puts its token in a URL.
  const trackingPath = `/api/tracking/${created.ticket.id}`;
  const trackingHeaders = { "X-Ticket-Token": created.tracking_token };
  const publicResponse = await fetch(`${baseUrl}${trackingPath}`, { headers: trackingHeaders });
  const publicThread = await publicResponse.json();
  if (!publicResponse.ok || publicThread.comments.length !== 1 || publicThread.comments[0].author_name !== "IT support") {
    throw new Error("Employee cannot read the public IT reply");
  }
  if (JSON.stringify(publicThread).includes("Private investigation note") || JSON.stringify(publicThread).includes("CI support agent") || publicThread.events.some((item) => item.kind === "assignment_changed") || publicThread.ticket.requester_email) {
    throw new Error("Public tracking leaked private staff or contact data");
  }
  const employeeReply = await fetch(`${baseUrl}${trackingPath}/comments`, {
    method: "POST", headers: { ...jsonHeaders, ...trackingHeaders }, body: JSON.stringify({ body: "Restarted; it works now.", author_kind: "staff" }),
  });
  if (employeeReply.status !== 201 || (await employeeReply.json()).comment.author_kind !== "employee") {
    throw new Error("Employee reply was not recorded with the correct identity");
  }
  const privateAttempt = await fetch(`${baseUrl}${trackingPath}/comments`, {
    method: "POST", headers: { ...jsonHeaders, ...trackingHeaders }, body: JSON.stringify({ body: "forged note", internal: true }),
  });
  if (privateAttempt.status !== 400) throw new Error("Employee created an internal note");
  const invalidLink = await fetch(`${baseUrl}${trackingPath}`, { headers: { "X-Ticket-Token": "0".repeat(64) } });
  if (invalidLink.status !== 404) throw new Error("Invalid tracking token was accepted");
  const other = await request("/api/tickets", {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ title: "Second CI ticket", requester_name: "Other employee", requester_email: "other@example.com", requester_phone: "123456789" }),
  });
  const crossTicket = await fetch(`${baseUrl}/api/tracking/${other.ticket.id}`, { headers: trackingHeaders });
  if (crossTicket.status !== 404) throw new Error("Tracking token authorized a different ticket");
  const trackedImage = await fetch(`${baseUrl}${trackingPath}/attachment`, { headers: trackingHeaders });
  if (!trackedImage.ok || trackedImage.headers.get("content-type") !== "image/png") throw new Error("Tracked attachment was not returned");
  const listedAgain = await request("/api/tickets");
  if (JSON.stringify(listedAgain).includes(created.tracking_token) || JSON.stringify(listedAgain).includes("tracking_token_hash")) {
    throw new Error("IT ticket list leaked tracking secrets");
  }
  const report = await request("/api/operations/reports?days=30");
  if (Number(report.period_summary.created) !== 2 || Number(report.current_summary.outstanding) !== 2 || !report.workload.some((row) => String(row.user_id) === String(ciAgent.id) && Number(row.outstanding) === 1)) {
    throw new Error("Report totals or technician workload are incorrect");
  }
  const resolved = await request(`/api/tickets/${created.ticket.id}/status`, { method: "PATCH", headers: jsonHeaders, body: JSON.stringify({ status: "resolved" }) });
  if (!resolved.ticket.resolved_at) throw new Error("Resolution timestamp was not recorded");
  const resolvedReport = await request("/api/operations/reports");
  if (Number(resolvedReport.period_summary.resolved) !== 1 || Number(resolvedReport.current_summary.outstanding) !== 1 || resolvedReport.period_summary.average_resolution_hours == null) {
    throw new Error("Resolved report metrics are incorrect");
  }
  const agentPolicyEdit = await fetch(`${baseUrl}/api/operations/slas/high`, { method: "PATCH", headers: { ...jsonHeaders, cookie }, body: JSON.stringify({ response_hours: 1, resolution_hours: 2 }) });
  if (agentPolicyEdit.status !== 403) throw new Error("Agent changed a service policy");

  console.log("Integration test passed");
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
'

echo "Integration test passed; cleanup runs on exit."

# Database fixtures exercise overdue work and reports beyond the queue page size.
docker exec -i "$backend_name" node <<'JS'
const pool = require("./db");
(async () => {
  const past = new Date(Date.now() - 3600000).toISOString();
  await pool.query("UPDATE tickets SET response_due_at = $1, resolution_due_at = $1 WHERE title = $2", [past, "Second CI ticket"]);
  await pool.query(`INSERT INTO tickets(title, requester_name, requester_email, requester_phone)
    SELECT 'Report volume ticket ' || n, 'Test employee', 'volume@example.com', '123456789'
    FROM generate_series(1, 205) n`);
  const login = await fetch("http://127.0.0.1:3000/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "ci-agent", password: "ci-agent-password-changed-12345" }),
  });
  if (!login.ok) throw new Error("Report fixture login failed");
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await fetch("http://127.0.0.1:3000/api/operations/reports", { headers: { cookie } });
  if (!response.ok) throw new Error("Report fixture request failed");
  const report = await response.json();
  if (Number(report.period_summary.created) !== 207 || Number(report.current_summary.outstanding) !== 206 || Number(report.current_summary.response_overdue) !== 1 || Number(report.current_summary.resolution_overdue) !== 1) {
    throw new Error("All-ticket report or overdue counts are incorrect");
  }
  const before = await pool.query("SELECT response_due_at, resolution_due_at FROM tickets WHERE title = $1", ["CI integration ticket"]);
  await pool.query("UPDATE sla_policies SET response_hours = 1, resolution_hours = 3 WHERE priority = $1", ["high"]);
  const after = await pool.query("SELECT response_due_at, resolution_due_at FROM tickets WHERE title = $1", ["CI integration ticket"]);
  if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) throw new Error("Policy edit changed an existing SLA snapshot");
  console.log("SLA overdue and all-ticket report integration passed");
})().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
JS
