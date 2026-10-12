const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createAuthentication, hashPassword, verifyPassword } = require("../auth");

async function withAuthApi(pool, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthentication(pool).router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("hashes passwords with a random salt and verifies them", async () => {
  const first = await hashPassword("a-long-test-password");
  const second = await hashPassword("a-long-test-password");
  assert.notEqual(first, second);
  assert.equal(first.includes("a-long-test-password"), false);
  assert.equal(await verifyPassword("a-long-test-password", first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
});

test("requires authentication for the current-user endpoint", async () => {
  await withAuthApi({ query: async () => { throw new Error("database should not be queried"); } }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
  });
});

test("prevents a viewer from managing accounts", async () => {
  const pool = {
    async query(sql) {
      assert.match(sql, /FROM auth_sessions/);
      return { rowCount: 1, rows: [{ id: "2", username: "viewer", display_name: "View User", role: "viewer" }] };
    },
  };
  await withAuthApi(pool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/accounts`, {
      headers: { cookie: `ticketdesk_session=${"a".repeat(64)}` },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "permission_denied" });
  });
});
