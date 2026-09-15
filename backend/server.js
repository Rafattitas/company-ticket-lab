const express = require("express");
const pool = require("./db");

const app = express();
const port = Number(process.env.PORT || 3000);

let shuttingDown = false;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

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

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Backend listening on port ${port}`);
});

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} received. Shutting down.`);

  server.close(async () => {
    try {
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
