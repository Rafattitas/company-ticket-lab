const express = require("express");
const crypto = require("node:crypto");

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function ticketId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function conversation(pool, id, publicOnly) {
  // Bound each response; newest items are returned in chronological order.
  const comments = await pool.query(
    `SELECT * FROM (
       SELECT id, body, internal, author_kind,
         ${publicOnly ? "CASE WHEN author_kind = 'staff' THEN 'IT support' ELSE 'You' END" : "author_name"} AS author_name,
         created_at FROM ticket_comments
       WHERE ticket_id = $1 ${publicOnly ? "AND internal = FALSE" : ""}
       ORDER BY id DESC LIMIT 100
     ) recent ORDER BY id`, [id],
  );
  const events = await pool.query(
    `SELECT * FROM (
       SELECT id, kind, old_value, new_value, created_at
         ${publicOnly ? "" : ", actor_name"}
       FROM ticket_events WHERE ticket_id = $1
         ${publicOnly ? "AND kind IN ('created', 'status_changed')" : ""}
       ORDER BY id DESC LIMIT 100
     ) recent ORDER BY id`, [id],
  );
  return { comments: comments.rows, events: events.rows };
}

async function addComment(pool, id, body, author, internal) {
  // A single statement commits the comment and updated timestamp together.
  return pool.query(
    `WITH updated AS (
       UPDATE tickets SET updated_at = CURRENT_TIMESTAMP,
         first_response_at = CASE WHEN $3::varchar(12) = 'staff' AND NOT $6::boolean THEN COALESCE(first_response_at, CURRENT_TIMESTAMP) ELSE first_response_at END
       WHERE id = $1 RETURNING id
     ) INSERT INTO ticket_comments
       (ticket_id, body, author_kind, author_name, actor_id, internal)
       SELECT id, $2, $3, $4, $5, $6 FROM updated
       RETURNING id, body, author_kind, author_name, internal, created_at`,
    [id, body, author.kind, author.name, author.id || null, internal],
  );
}

function commentBody(request, response) {
  const body = typeof request.body?.body === "string" ? request.body.body.trim() : "";
  if (!body || body.length > 5000) {
    response.status(400).json({ error: "comment_must_be_between_1_and_5000_characters" });
    return null;
  }
  return body;
}

function createTrackingRouter(pool) {
  const router = express.Router();
  router.use((request, response, next) => {
    response.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    next();
  });
  async function requireTracking(request, response, next) {
    const id = ticketId(request.params.id);
    const token = request.get("X-Ticket-Token") || "";
    if (!id || !/^[a-f0-9]{64}$/.test(token)) {
      return response.status(404).json({ error: "tracking_not_found" });
    }
    try {
      const result = await pool.query(
        `SELECT id, title, description, status, priority, category, created_at, updated_at,
           EXISTS (SELECT 1 FROM ticket_attachments WHERE ticket_id = tickets.id) AS has_attachment
         FROM tickets WHERE id = $1 AND tracking_token_hash = $2`,
        [id, tokenHash(token)],
      );
      if (!result.rowCount) return response.status(404).json({ error: "tracking_not_found" });
      request.trackedTicket = result.rows[0];
      return next();
    } catch (error) { return next(error); }
  }
  router.get("/:id", requireTracking, async (request, response, next) => {
    try {
      return response.json({ ticket: request.trackedTicket, ...await conversation(pool, request.trackedTicket.id, true) });
    } catch (error) { return next(error); }
  });
  router.post("/:id/comments", requireTracking, async (request, response, next) => {
    // Employees cannot supply staff identity or create internal notes.
    if (request.body?.internal !== undefined && request.body.internal !== false) {
      return response.status(400).json({ error: "invalid_comment_visibility" });
    }
    const body = commentBody(request, response);
    if (!body) return;
    try {
      const result = await addComment(pool, request.trackedTicket.id, body, { kind: "employee", name: "Employee" }, false);
      if (!result.rowCount) return response.status(404).json({ error: "tracking_not_found" });
      const comment = { ...result.rows[0], author_name: "You" };
      return response.status(201).json({ comment });
    } catch (error) { return next(error); }
  });
  router.get("/:id/attachment", requireTracking, async (request, response, next) => {
    try {
      const result = await pool.query("SELECT content_type, file_size, data FROM ticket_attachments WHERE ticket_id = $1", [request.trackedTicket.id]);
      if (!result.rowCount) return response.status(404).json({ error: "attachment_not_found" });
      const file = result.rows[0];
      response.set({ "Content-Type": file.content_type, "Content-Length": String(file.file_size), "X-Content-Type-Options": "nosniff" });
      return response.send(file.data);
    } catch (error) { return next(error); }
  });
  return router;
}

function createConversationRouter(pool, authentication) {
  const router = express.Router();
  router.use((request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.get("/:id/conversation", authentication.requirePermission("tickets:read"), async (request, response, next) => {
    const id = ticketId(request.params.id);
    if (!id) return response.status(400).json({ error: "invalid_ticket_id" });
    try {
      const exists = await pool.query("SELECT id FROM tickets WHERE id = $1", [id]);
      if (!exists.rowCount) return response.status(404).json({ error: "ticket_not_found" });
      return response.json(await conversation(pool, id, false));
    } catch (error) { return next(error); }
  });
  router.post("/:id/comments", authentication.requirePermission("tickets:update"), async (request, response, next) => {
    const id = ticketId(request.params.id);
    if (!id) return response.status(400).json({ error: "invalid_ticket_id" });
    if (request.body?.internal !== undefined && typeof request.body.internal !== "boolean") {
      return response.status(400).json({ error: "invalid_comment_visibility" });
    }
    const body = commentBody(request, response);
    if (!body) return;
    try {
      const result = await addComment(pool, id, body, { kind: "staff", name: request.user.display_name, id: request.user.id }, request.body.internal === true);
      if (!result.rowCount) return response.status(404).json({ error: "ticket_not_found" });
      return response.status(201).json({ comment: result.rows[0] });
    } catch (error) { return next(error); }
  });
  return router;
}

module.exports = { createTrackingRouter, createConversationRouter, tokenHash };
