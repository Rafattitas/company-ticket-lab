const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createAuthentication } = require("../auth");
const { createOperationsRouter } = require("../routes/operations");
const cookie = `ticketdesk_session=${"a".repeat(64)}`;
async function withApi(role, query, run, mustChange = false) {
  const pool = { async query(sql, values) {
    if (sql.includes("FROM auth_sessions")) return { rows: [{ id: "1", role, must_change_password: mustChange }] };
    return query(sql, values);
  } };
  const app = express(); app.use(express.json());
  app.use("/api/operations", createOperationsRouter(pool, createAuthentication(pool)));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
const noQuery = () => { throw new Error("Unexpected query"); };
test("anonymous reports and staff directory are protected", async () => {
  await withApi("admin", noQuery, async (base) => {
    for (const path of ["reports", "staff", "slas"]) assert.equal((await fetch(`${base}/api/operations/${path}`)).status, 401);
  });
});
test("agents and viewers cannot modify departments or SLA policies", async () => {
  for (const role of ["agent", "viewer"]) await withApi(role, noQuery, async (base) => {
    for (const [path, method, body] of [["departments", "POST", { name: "Team" }], ["slas/high", "PATCH", { response_hours: 1, resolution_hours: 2 }]]) {
      const response = await fetch(`${base}/api/operations/${path}`, { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
      assert.equal(response.status, 403);
    }
  });
});
test("temporary password cannot read reports", async () => {
  await withApi("admin", noQuery, async (base) => {
    assert.equal((await fetch(`${base}/api/operations/reports`, { headers: { cookie } })).status, 403);
  }, true);
});
test("admin SLA validation rejects reversed, fractional, and unbounded targets", async () => {
  await withApi("admin", noQuery, async (base) => {
    for (const [response_hours, resolution_hours] of [[4, 2], [0, 8], [1.5, 4], [1, 8761], ["1", 8]]) {
      const response = await fetch(`${base}/api/operations/slas/high`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ response_hours, resolution_hours }) });
      assert.equal(response.status, 400);
    }
  });
});
test("viewer reports bind period and aggregate all tickets", async () => {
  let queried = false;
  await withApi("viewer", async (sql, values) => {
    queried = true;
    assert.deepEqual(values, [7]);
    assert.match(sql, /current_work AS/); assert.doesNotMatch(sql, /LIMIT 200/);
    return { rows: [{ period_summary: { created: 300 }, current_summary: { outstanding: 250 }, workload: [], departments: [], daily: [] }] };
  }, async (base) => {
    assert.equal((await fetch(`${base}/api/operations/reports?days=0`, { headers: { cookie } })).status, 400);
    const response = await fetch(`${base}/api/operations/reports?days=7`, { headers: { cookie } });
    assert.equal(response.status, 200); assert.equal((await response.json()).period_summary.created, 300); assert.equal(queried, true);
  });
});
