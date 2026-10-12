const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createTrackingRouter, createConversationRouter, tokenHash } = require("../routes/conversations");
const { createAuthentication } = require("../auth");

const token = "a".repeat(64);
async function withApi(pool, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/tracking", createTrackingRouter(pool));
  app.use("/api/tickets", createConversationRouter(pool, createAuthentication(pool)));
  app.use((error, request, response, next) => { void next; response.status(500).json({ error: error.message }); });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
const noDatabase = { query() { throw new Error("Unexpected database access"); } };

test("tracking rejects missing, malformed, and query-string tokens without querying", async () => {
  await withApi(noDatabase, async (base) => {
    for (const path of ["/api/tracking/1", `/api/tracking/1?token=${token}`, "/api/tracking/no-id"]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal((await fetch(`${base}/api/tracking/1`, { headers: { "X-Ticket-Token": "short" } })).status, 404);
  });
});

test("tracking binds ticket ID and token hash and hides invalid links", async () => {
  await withApi({ async query(sql, values) {
    assert.match(sql, /id = \$1 AND tracking_token_hash = \$2/);
    assert.deepEqual(values, [2, tokenHash(token)]);
    return { rowCount: 0, rows: [] };
  } }, async (base) => {
    const response = await fetch(`${base}/api/tracking/2`, { headers: { "X-Ticket-Token": token } });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "tracking_not_found" });
  });
});

test("public timeline queries filter internal notes, staff identity, and assignment events", async () => {
  let calls = 0;
  await withApi({ async query(sql) {
    calls++;
    if (calls === 1) {
      assert.doesNotMatch(sql, /requester_email|requester_phone|assigned_to/);
      return { rowCount: 1, rows: [{ id: "1", title: "VPN issue" }] };
    }
    if (calls === 2) {
      assert.match(sql, /AND internal = FALSE/);
      assert.match(sql, /THEN 'IT support'/);
      return { rows: [{ id: "3", body: "Please retry", internal: false, author_name: "IT support" }] };
    }
    assert.match(sql, /kind IN \('created', 'status_changed'\)/);
    assert.doesNotMatch(sql, /actor_name/);
    return { rows: [] };
  } }, async (base) => {
    const response = await fetch(`${base}/api/tracking/1`, { headers: { "X-Ticket-Token": token } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).comments[0].author_name, "IT support");
    assert.equal(calls, 3);
  });
});

test("employee cannot create an internal note or forge a staff author", async () => {
  const pool = { async query(sql, values) {
    if (sql.includes("tracking_token_hash")) return { rowCount: 1, rows: [{ id: "1" }] };
    assert.deepEqual(values, ["1", "hello", "employee", "Employee", null, false]);
    return { rowCount: 1, rows: [{ body: "hello", author_name: "Employee", internal: false }] };
  } };
  await withApi(pool, async (base) => {
    const send = (body) => fetch(`${base}/api/tracking/1/comments`, { method: "POST", headers: { "content-type": "application/json", "X-Ticket-Token": token }, body: JSON.stringify(body) });
    assert.equal((await send({ body: "hello", internal: true })).status, 400);
    assert.equal((await send({ body: "  " })).status, 400);
    assert.equal((await send({ body: "x".repeat(5001) })).status, 400);
    const response = await send({ body: " hello ", author_kind: "staff", author_name: "admin" });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).comment.author_name, "You");
  });
});

test("anonymous and viewer users cannot add staff comments", async () => {
  await withApi({ async query(sql) {
    assert.match(sql, /JOIN user_accounts/);
    return { rowCount: 1, rows: [{ id: "7", role: "viewer", username: "viewer", display_name: "Viewer", must_change_password: false }] };
  } }, async (base) => {
    const options = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "not allowed" }) };
    assert.equal((await fetch(`${base}/api/tickets/1/comments`, options)).status, 401);
    options.headers.cookie = `ticketdesk_session=${token}`;
    assert.equal((await fetch(`${base}/api/tickets/1/comments`, options)).status, 403);
  });
});

test("temporary-password accounts cannot read conversation", async () => {
  await withApi({ async query() {
    return { rows: [{ id: "7", role: "admin", must_change_password: true }] };
  } }, async (base) => {
    const response = await fetch(`${base}/api/tickets/1/conversation`, { headers: { cookie: `ticketdesk_session=${token}` } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "password_change_required");
  });
});

test("agent notes use the authenticated actor, ignoring submitted identity", async () => {
  await withApi({ async query(sql, values) {
    if (sql.includes("FROM auth_sessions")) {
      return { rows: [{ id: "7", role: "agent", display_name: "Support Agent", must_change_password: false }] };
    }
    assert.match(sql, /WITH updated AS/);
    assert.deepEqual(values, [1, "investigation", "staff", "Support Agent", "7", true]);
    return { rowCount: 1, rows: [{ id: "8", body: "investigation", internal: true, author_name: "Support Agent" }] };
  } }, async (base) => {
    const response = await fetch(`${base}/api/tickets/1/comments`, {
      method: "POST", headers: { cookie: `ticketdesk_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ body: " investigation ", internal: true, author_name: "Impersonated admin" }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).comment.author_name, "Support Agent");
  });
});
