const express = require("express");
const pool = require("./db");
const runMigrations = require("./migrate");
const { createAuthentication, ensureBootstrapAdmin } = require("./auth");
const ticketsRouter = require("./routes/tickets");
const { createTrackingRouter, createConversationRouter } = require("./routes/conversations");
const { createOperationsRouter } = require("./routes/operations");
const { createEmailWorker } = require('./email');
const { createMailSettings } = require('./mail-settings');
const mailSettings = createMailSettings(pool);
const emailWorker = createEmailWorker(pool, { configurationProvider: mailSettings.configuration });
const app = express();
const port = Number(process.env.PORT || 3000);

let shuttingDown = false;

app.disable("x-powered-by");
app.use(express.json({ limit: "7mb" }));
app.use((request, response, next) => {
  response.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  next();
});

app.get("/health/live", (request, response) => {
  response.status(shuttingDown ? 503 : 200).json({
    status: shuttingDown ? "shutting_down" : "ok",
    service: "backend",
  });
});

async function readinessCheck(request, response) {
  if (shuttingDown) {
    return response.status(503).json({
      status: "not_ready",
      service: "backend",
    });
  }

  try {
    await pool.query("SELECT 1");

    return response.status(200).json({
      status: "ready",
      service: "backend",
      database: "connected",
    });
  } catch (error) {
    console.error("Readiness check failed:", error.message);

    return response.status(503).json({
      status: "not_ready",
      service: "backend",
      database: "unavailable",
    });
  }
}

app.get("/health", readinessCheck);
app.get("/health/ready", readinessCheck);

app.get("/api", (request, response) => {
  response.json({
    message: "Company Ticket API is running",
  });
});
const authentication = createAuthentication(pool);
const content = require('./routes/content').createContentRouters(pool, authentication);
app.use('/api/knowledge', content.knowledge);
app.use('/api/reply-templates', content.templates);
app.use("/api/auth", authentication.router);
app.use('/api/notifications/settings', authentication.requirePermission('accounts:manage'), mailSettings.router);
app.get('/api/notifications/status', authentication.requirePermission('accounts:manage'), async (request, response, next) => {
  response.set('Cache-Control', 'no-store');
  try { response.json(await emailWorker.status()); } catch (error) { next(error); }
});
app.use("/api/operations", createOperationsRouter(pool, authentication));
app.use("/api/tracking", createTrackingRouter(pool));
app.use("/api/tickets", createConversationRouter(pool, authentication));
app.use("/api/tickets", ticketsRouter(pool, authentication));

app.use((error, request, response, next) => {
  console.error("Unhandled request error:", error.message);

  response.status(500).json({
    error: "internal_server_error",
  });
});
let server;

async function start() {
  await runMigrations(pool);
  await ensureBootstrapAdmin(pool);
  emailWorker.start();
  server = app.listen(port, "0.0.0.0", () => {
    console.log(`Backend listening on port ${port}`);
  });
}

start().catch(async (error) => {
  console.error("Backend startup failed:", error.message);
  await pool.end().catch(() => {});
  process.exit(1);
});

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} received. Shutting down.`);

  if (!server) {
    await pool.end();
    process.exit(0);
  }

  server.close(async () => {
    try {
      await emailWorker.stop();
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error("Shutdown error:", error.message);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
