const express = require("express");

const allowedStatuses = new Set(["open", "in_progress", "resolved", "closed"]);
const allowedPriorities = new Set(["low", "normal", "high", "urgent"]);
const ticketColumns = `
  id, title, description, status, priority, category,
  requester_name, assigned_to, created_at, updated_at
`;

function parseTicketId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function cleanString(value, maximumLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maximumLength + 1);
}

function createTicketsRouter(pool) {
  const router = express.Router();

  router.get("/", async (request, response, next) => {
    const status = cleanString(request.query.status, 20);
    const priority = cleanString(request.query.priority, 20);
    const search = cleanString(request.query.search, 120);

    if (status && !allowedStatuses.has(status)) {
      return response.status(400).json({ error: "invalid_ticket_status" });
    }

    if (priority && !allowedPriorities.has(priority)) {
      return response.status(400).json({ error: "invalid_ticket_priority" });
    }

    const conditions = [];
    const values = [];

    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }

    if (priority) {
      values.push(priority);
      conditions.push(`priority = $${values.length}`);
    }

    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(
        title ILIKE $${values.length}
        OR description ILIKE $${values.length}
        OR requester_name ILIKE $${values.length}
        OR assigned_to ILIKE $${values.length}
      )`);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    try {
      const result = await pool.query(
        `SELECT ${ticketColumns}
         FROM tickets
         ${whereClause}
         ORDER BY
           CASE priority
             WHEN 'urgent' THEN 1
             WHEN 'high' THEN 2
             WHEN 'normal' THEN 3
             ELSE 4
           END,
           created_at DESC,
           id DESC
         LIMIT 200`,
        values,
      );

      return response.json({ tickets: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:id", async (request, response, next) => {
    const id = parseTicketId(request.params.id);

    if (!id) {
      return response.status(400).json({ error: "invalid_ticket_id" });
    }

    try {
      const result = await pool.query(
        `SELECT ${ticketColumns} FROM tickets WHERE id = $1`,
        [id],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: "ticket_not_found" });
      }

      return response.json({ ticket: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/", async (request, response, next) => {
    const title = cleanString(request.body.title, 200);
    const description = cleanString(request.body.description, 5000);
    const requesterName = cleanString(request.body.requester_name, 120);
    const category = cleanString(request.body.category, 80) || "general";
    const priority = cleanString(request.body.priority, 20) || "normal";

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

    if (requesterName.length < 2 || requesterName.length > 120) {
      return response.status(400).json({
        error: "requester_name_must_be_between_2_and_120_characters",
      });
    }

    if (category.length > 80) {
      return response.status(400).json({ error: "category_is_too_long" });
    }

    if (!allowedPriorities.has(priority)) {
      return response.status(400).json({ error: "invalid_ticket_priority" });
    }

    try {
      const result = await pool.query(
        `INSERT INTO tickets
           (title, description, requester_name, category, priority)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${ticketColumns}`,
        [title, description, requesterName, category, priority],
      );

      return response.status(201).json({ ticket: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/:id/status", async (request, response, next) => {
    const id = parseTicketId(request.params.id);
    const status = request.body.status;

    if (!id) {
      return response.status(400).json({ error: "invalid_ticket_id" });
    }

    if (!allowedStatuses.has(status)) {
      return response.status(400).json({ error: "invalid_ticket_status" });
    }

    try {
      const result = await pool.query(
        `UPDATE tickets
         SET status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING ${ticketColumns}`,
        [status, id],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: "ticket_not_found" });
      }

      return response.json({ ticket: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.patch("/:id/assignment", async (request, response, next) => {
    const id = parseTicketId(request.params.id);
    const assignedTo = cleanString(request.body.assigned_to, 120);

    if (!id) {
      return response.status(400).json({ error: "invalid_ticket_id" });
    }

    if (assignedTo.length > 120) {
      return response.status(400).json({ error: "assignee_is_too_long" });
    }

    try {
      const result = await pool.query(
        `UPDATE tickets
         SET assigned_to = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING ${ticketColumns}`,
        [assignedTo, id],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: "ticket_not_found" });
      }

      return response.json({ ticket: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = createTicketsRouter;
