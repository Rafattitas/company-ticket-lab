const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const createTicketsRouter = require("../routes/tickets");
const { tokenHash } = require("../routes/conversations");

async function withApi(pool, run) {
  const app = express();
  app.use(express.json({ limit: "7mb" }));
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
      assert.match(sql, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$12, \$13\)/);
      assert.match(sql, /INSERT INTO ticket_events/);
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
        requester_name: "  Salma  ",
        category: "  Network  ",
        priority: "high",
        requester_email: "  SALMA@example.com  ",
        requester_phone: " +20 100 123 4567 ",
      }),
    });

    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.ticket.title, "VPN issue");
    assert.match(created.tracking_token, /^[a-f0-9]{64}$/);
    assert.equal(queryValues[11], tokenHash(created.tracking_token));
    assert.notEqual(queryValues[11], created.tracking_token);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(queryValues.slice(0, 11), [
      "VPN issue",
      "Needs access",
      "Salma",
      "Network",
      "high",
      "salma@example.com",
      "+20 100 123 4567",
      null,
      null,
      null,
      null,
    ]);
  });
});

test("requires a requester name when creating a ticket", async () => {
  await withApi(databaseMustNotBeCalled, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Printer issue" }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "requester_name_must_be_between_2_and_120_characters",
    });
  });
});

test("rejects invalid requester contact details before querying", async () => {
  await withApi(databaseMustNotBeCalled, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Printer issue",
        requester_name: "Salma",
        requester_email: "not-an-email",
        requester_phone: "1234567",
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_requester_email" });
  });
});

test("stores an allowed image attachment as binary data", async () => {
  let queryValues;
  const pool = {
    async query(sql, values) {
      assert.match(sql, /INSERT INTO ticket_attachments/);
      queryValues = values;
      return { rows: [{ id: "11", has_attachment: true }] };
    },
  };

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Broken screen",
        requester_name: "Rafat",
        requester_email: "rafat@example.com",
        requester_phone: "+20 100 765 4321",
        attachment: {
          file_name: "screen.png",
          content_type: "image/png",
          data: Buffer.from("fake-png").toString("base64"),
        },
      }),
    });

    assert.equal(response.status, 201);
    assert.equal(queryValues[7], "screen.png");
    assert.equal(queryValues[8], "image/png");
    assert.equal(queryValues[9], 8);
    assert.deepEqual(queryValues[10], Buffer.from("fake-png"));
  });
});

test("builds parameterized filters for the ticket list", async () => {
  let capturedValues;
  const pool = {
    async query(sql, values) {
      assert.match(sql, /status = \$1/);
      assert.match(sql, /priority = \$2/);
      assert.match(sql, /title ILIKE \$3/);
      capturedValues = values;
      return { rows: [] };
    },
  };

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/api/tickets?status=open&priority=urgent&search=vpn`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(capturedValues, ["open", "urgent", "%vpn%"]);
  });
});

test("updates ticket assignment with a parameterized query", async () => {
  let capturedValues;
  const pool = {
    async query(sql, values) {
      assert.match(sql, /SET assigned_to = \$1/);
      capturedValues = values;
      return {
        rowCount: 1,
        rows: [{ id: "9", assigned_to: "Rafat" }],
      };
    },
  };

  await withApi(pool, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tickets/9/assignment`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assigned_to: " Rafat " }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(capturedValues, ["Rafat", 9, "IT support", null, null]);
  });
});
