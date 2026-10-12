const express = require("express");

const allowedStatuses = new Set(["open", "in_progress", "resolved", "closed"]);
const allowedPriorities = new Set(["low", "normal", "high", "urgent"]);
const allowedAttachmentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumAttachmentSize = 5 * 1024 * 1024;
const ticketColumns = `
  id, title, description, status, priority, category,
  requester_name, requester_email, requester_phone,
  assigned_to, created_at, updated_at
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

function parseAttachment(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "invalid_attachment" };
  }

  const fileName = cleanString(value.file_name, 180);
  const contentType = cleanString(value.content_type, 40).toLowerCase();
  const encodedData = typeof value.data === "string" ? value.data : "";

  if (!fileName || !allowedAttachmentTypes.has(contentType)) {
    return { error: "invalid_attachment" };
  }

  if (!encodedData || encodedData.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedData)) {
    return { error: "invalid_attachment" };
  }

  const data = Buffer.from(encodedData, "base64");
  if (data.length === 0 || data.length > maximumAttachmentSize) {
    return { error: "attachment_must_not_exceed_5mb" };
  }

  return { fileName, contentType, data };
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
        OR requester_email ILIKE $${values.length}
        OR requester_phone ILIKE $${values.length}
        OR assigned_to ILIKE $${values.length}
      )`);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    try {
      const result = await pool.query(
        `SELECT ${ticketColumns},
           EXISTS (
             SELECT 1 FROM ticket_attachments
             WHERE ticket_id = tickets.id
           ) AS has_attachment
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
        `SELECT ${ticketColumns},
           EXISTS (
             SELECT 1 FROM ticket_attachments
             WHERE ticket_id = tickets.id
           ) AS has_attachment
         FROM tickets WHERE id = $1`,
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

  router.get("/:id/attachment", async (request, response, next) => {
    const id = parseTicketId(request.params.id);

    if (!id) {
      return response.status(400).json({ error: "invalid_ticket_id" });
    }

    try {
      const result = await pool.query(
        `SELECT file_name, content_type, file_size, data
         FROM ticket_attachments
         WHERE ticket_id = $1`,
        [id],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: "attachment_not_found" });
      }

      const attachment = result.rows[0];
      response.set({
        "Content-Type": attachment.content_type,
        "Content-Length": String(attachment.file_size),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
        "Cache-Control": "private, max-age=300",
      });
      return response.send(attachment.data);
    } catch (error) {
      return next(error);
    }
  });

  router.post("/", async (request, response, next) => {
    const title = cleanString(request.body.title, 200);
    const description = cleanString(request.body.description, 5000);
    const requesterName = cleanString(request.body.requester_name, 120);
    const requesterEmail = cleanString(request.body.requester_email, 254).toLowerCase();
    const requesterPhone = cleanString(request.body.requester_phone, 32);
    const category = cleanString(request.body.category, 80) || "general";
    const priority = cleanString(request.body.priority, 20) || "normal";
    const attachment = parseAttachment(request.body.attachment);

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

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
      return response.status(400).json({ error: "invalid_requester_email" });
    }

    if (!/^\+?[0-9 ()-]{7,32}$/.test(requesterPhone)) {
      return response.status(400).json({ error: "invalid_requester_phone" });
    }

    if (category.length > 80) {
      return response.status(400).json({ error: "category_is_too_long" });
    }

    if (!allowedPriorities.has(priority)) {
      return response.status(400).json({ error: "invalid_ticket_priority" });
    }

    if (attachment?.error) {
      return response.status(400).json({ error: attachment.error });
    }

    try {
      const result = await pool.query(
        `WITH new_ticket AS (
           INSERT INTO tickets
             (title, description, requester_name, category, priority,
              requester_email, requester_phone)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING ${ticketColumns}
         ), new_attachment AS (
           INSERT INTO ticket_attachments
             (ticket_id, file_name, content_type, file_size, data)
           SELECT id, $8, $9, $10, $11
           FROM new_ticket
           WHERE $11::bytea IS NOT NULL
           RETURNING ticket_id
         )
         SELECT new_ticket.*,
           EXISTS (SELECT 1 FROM new_attachment) AS has_attachment
         FROM new_ticket`,
        [
          title,
          description,
          requesterName,
          category,
          priority,
          requesterEmail,
          requesterPhone,
          attachment?.fileName || null,
          attachment?.contentType || null,
          attachment?.data.length || null,
          attachment?.data || null,
        ],
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
