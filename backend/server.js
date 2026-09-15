const express = require("express");

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/health", (request, response) => {
  response.status(200).json({
    status: "ok",
    service: "backend",
  });
});

app.get("/api", (request, response) => {
  response.json({
    message: "Company Ticket API is running",
  });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Backend listening on port ${port}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Shutting down.`);

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
