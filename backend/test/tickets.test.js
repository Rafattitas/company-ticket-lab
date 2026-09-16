const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const createTicketsRouter = require("../routes/tickets");

async function withApi(pool, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/tickets", createTicketsRouter(pool));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const databaseMustNotBeCalled = {
  query() {
    throw new Error("Invalid request reached the database");
  },
};

test("rejects an invalid ticket ID before querying the database", async () => {
  await withApi(databaseMustNotBeCalled, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tickets/not-a-number`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_ticket_id" });
  });
});

test("rejects an invalid status before querying the database", async () => {
  await withApi(databaseMustNotBeCalled, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tickets/1/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "deleted" }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_ticket_status" });
  });
});

test("creates a ticket with trimmed values and parameterized SQL", async () => {
  let queryValues;
  const pool = {
    async query(sql, values) {
      assert.match(sql, /VALUES \(\$1, \$2\)/);
      queryValues = values;
      return {
        rows: [{ id: "7", title: "VPN issue", description: "Needs access", status: "open" }],
      };
    },
  };

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "  VPN issue  ",
        description: "  Needs access  ",
      }),
    });

    assert.equal(response.status, 201);
    assert.equal((await response.json()).ticket.title, "VPN issue");
    assert.deepEqual(queryValues, ["VPN issue", "Needs access"]);
  });
});
