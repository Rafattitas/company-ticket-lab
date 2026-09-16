const express = require("express");

function createTicketsRouter(pool) {
  const router = express.Router();

const allowedStatuses = new Set([
  "open",
  "in_progress",
  "resolved",
  "closed",
]);

function parseTicketId(value) {
  const id = Number(value);

  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

router.get("/", async (request, response, next) => {
  try {
    const result = await pool.query(`
      SELECT id, title, description, status, created_at, updated_at
      FROM tickets
      ORDER BY created_at DESC, id DESC
      LIMIT 100
    `);

    response.json({
      tickets: result.rows,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (request, response, next) => {
  const id = parseTicketId(request.params.id);

  if (!id) {
    return response.status(400).json({
      error: "invalid_ticket_id",
    });
  }

  try {
    const result = await pool.query(
      `
        SELECT id, title, description, status, created_at, updated_at
        FROM tickets
        WHERE id = $1
      `,
      [id],
    );

    if (result.rowCount === 0) {
      return response.status(404).json({
        error: "ticket_not_found",
      });
    }

    return response.json({
      ticket: result.rows[0],
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (request, response, next) => {
  const title =
    typeof request.body.title === "string"
      ? request.body.title.trim()
      : "";

  const description =
    typeof request.body.description === "string"
      ? request.body.description.trim()
      : "";

  if (title.length < 3 || title.length > 200) {
    return response.status(400).json({
      error: "title_must_be_between_3_and_200_characters",
    });
  }

  if (description.length > 5000) {
    return response.status(400).json({
      error: "description_must_not_exceed_5000_characters",
    });
  }

  try {
    const result = await pool.query(
      `
        INSERT INTO tickets (title, description)
        VALUES ($1, $2)
        RETURNING id, title, description, status, created_at, updated_at
      `,
      [title, description],
    );

    return response.status(201).json({
      ticket: result.rows[0],
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/:id/status", async (request, response, next) => {
  const id = parseTicketId(request.params.id);
  const status = request.body.status;

  if (!id) {
    return response.status(400).json({
      error: "invalid_ticket_id",
    });
  }

  if (!allowedStatuses.has(status)) {
    return response.status(400).json({
      error: "invalid_ticket_status",
    });
  }

  try {
    const result = await pool.query(
      `
        UPDATE tickets
        SET status = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING id, title, description, status, created_at, updated_at
      `,
      [status, id],
    );

    if (result.rowCount === 0) {
      return response.status(404).json({
        error: "ticket_not_found",
      });
    }

    return response.json({
      ticket: result.rows[0],
    });
  } catch (error) {
    return next(error);
  }
});

  return router;
}

module.exports = createTicketsRouter;
