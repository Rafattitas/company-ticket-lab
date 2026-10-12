const express = require("express");
function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function createOperationsRouter(pool, authentication) {
  const router = express.Router();
  const read = authentication.requirePermission("tickets:read");
  const manage = authentication.requirePermission("accounts:manage");
  router.use((request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
  router.get("/departments", async (request, response, next) => {
    try {
      const result = await pool.query("SELECT id, name FROM departments WHERE active = TRUE ORDER BY name");
      return response.json({ departments: result.rows });
    } catch (error) { return next(error); }
  });
  router.get("/departments/all", manage, async (request, response, next) => {
    try { return response.json({ departments: (await pool.query("SELECT id, name, active FROM departments ORDER BY name")).rows }); }
    catch (error) { return next(error); }
  });
  router.post("/departments", manage, async (request, response, next) => {
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    if (name.length < 2 || name.length > 80) return response.status(400).json({ error: "invalid_department_name" });
    try {
      const result = await pool.query("INSERT INTO departments(name) VALUES ($1) RETURNING id, name, active", [name]);
      return response.status(201).json({ department: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return response.status(409).json({ error: "department_already_exists" });
      return next(error);
    }
  });
  router.patch("/departments/:id", manage, async (request, response, next) => {
    const id = parseId(request.params.id);
    if (!id || typeof request.body?.active !== "boolean") return response.status(400).json({ error: "invalid_department" });
    try {
      const result = await pool.query("UPDATE departments SET active = $1 WHERE id = $2 RETURNING id, name, active", [request.body.active, id]);
      if (!result.rowCount) return response.status(404).json({ error: "department_not_found" });
      return response.json({ department: result.rows[0] });
    } catch (error) { return next(error); }
  });
  router.get("/staff", read, async (request, response, next) => {
    try {
      return response.json({ staff: (await pool.query("SELECT id, display_name FROM user_accounts WHERE active = TRUE AND role IN ('admin', 'agent') ORDER BY display_name, id")).rows });
    } catch (error) { return next(error); }
  });
  router.get("/slas", read, async (request, response, next) => {
    try { return response.json({ policies: (await pool.query("SELECT priority, response_hours, resolution_hours FROM sla_policies ORDER BY response_hours")).rows }); }
    catch (error) { return next(error); }
  });
  router.patch("/slas/:priority", manage, async (request, response, next) => {
    const { response_hours: responseHours, resolution_hours: resolutionHours } = request.body || {};
    if (!["low", "normal", "high", "urgent"].includes(request.params.priority) || !Number.isInteger(responseHours) || !Number.isInteger(resolutionHours) || responseHours < 1 || resolutionHours < responseHours || resolutionHours > 8760) {
      return response.status(400).json({ error: "invalid_sla_policy" });
    }
    try {
      const result = await pool.query("UPDATE sla_policies SET response_hours = $1, resolution_hours = $2 WHERE priority = $3 RETURNING priority, response_hours, resolution_hours", [responseHours, resolutionHours, request.params.priority]);
      return response.json({ policy: result.rows[0] });
    } catch (error) { return next(error); }
  });
  router.get("/reports", read, async (request, response, next) => {
    const days = request.query.days === undefined ? 30 : Number(request.query.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) return response.status(400).json({ error: "invalid_report_period" });
    try {
      // One snapshot aggregates the entire database, not the 200-ticket UI page.
      const result = await pool.query(`WITH period AS (
          SELECT * FROM tickets WHERE created_at >= CURRENT_TIMESTAMP - make_interval(days => $1)
        ), current_work AS (
          SELECT * FROM tickets WHERE status IN ('open', 'in_progress')
        ) SELECT CURRENT_TIMESTAMP AS generated_at,
          (SELECT json_build_object(
            'created', COUNT(*),
            'resolved', COUNT(*) FILTER (WHERE status IN ('resolved', 'closed')),
            'average_resolution_hours', ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) FILTER (WHERE resolved_at IS NOT NULL AND resolution_due_at IS NOT NULL)::numeric, 2),
            'average_response_hours', ROUND(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))/3600) FILTER (WHERE first_response_at IS NOT NULL)::numeric, 2)
          ) FROM period) AS period_summary,
          (SELECT json_build_object(
            'outstanding', COUNT(*),
            'unassigned', COUNT(*) FILTER (WHERE assigned_user_id IS NULL AND COALESCE(assigned_to, '') = ''),
            'response_overdue', COUNT(*) FILTER (WHERE first_response_at IS NULL AND response_due_at < CURRENT_TIMESTAMP),
            'resolution_overdue', COUNT(*) FILTER (WHERE resolution_due_at < CURRENT_TIMESTAMP),
            'without_sla', COUNT(*) FILTER (WHERE resolution_due_at IS NULL)
          ) FROM current_work) AS current_summary,
          (SELECT COALESCE(json_agg(rows ORDER BY rows.name), '[]'::json) FROM (
            SELECT COALESCE(d.name, 'Unspecified') AS name, COUNT(t.id) AS tickets,
              COUNT(t.id) FILTER (WHERE t.status IN ('open', 'in_progress')) AS outstanding
            FROM period t LEFT JOIN departments d ON d.id = t.department_id GROUP BY d.id, d.name
          ) rows) AS departments,
          (SELECT COALESCE(json_agg(rows ORDER BY rows.outstanding DESC, rows.name), '[]'::json) FROM (
            SELECT COALESCE(u.display_name, NULLIF(CASE WHEN t.assigned_user_id IS NULL THEN t.assigned_to END, ''), 'Unassigned') AS name,
              t.assigned_user_id AS user_id, COUNT(*) AS outstanding,
              COUNT(*) FILTER (WHERE t.resolution_due_at < CURRENT_TIMESTAMP) AS overdue
            FROM current_work t LEFT JOIN user_accounts u ON u.id = t.assigned_user_id
            GROUP BY t.assigned_user_id, u.display_name, CASE WHEN t.assigned_user_id IS NULL THEN t.assigned_to END
          ) rows) AS workload,
          (SELECT COALESCE(json_agg(rows ORDER BY rows.day), '[]'::json) FROM (
            SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, COUNT(*) AS tickets
            FROM period GROUP BY day
          ) rows) AS daily`, [days]);
      return response.json({ days, ...result.rows[0] });
    } catch (error) { return next(error); }
  });
  return router;
}
module.exports = { createOperationsRouter, parseId };
