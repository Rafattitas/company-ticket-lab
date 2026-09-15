const fs = require("node:fs");
const { Pool } = require("pg");

function requiredEnvironmentVariable(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const port = Number(requiredEnvironmentVariable("DB_PORT"));

if (!Number.isInteger(port)) {
  throw new Error("DB_PORT must be an integer");
}

const passwordFile = requiredEnvironmentVariable("DB_PASSWORD_FILE");
const password = fs.readFileSync(passwordFile, "utf8").trim();

if (!password) {
  throw new Error("Database password file is empty");
}

const pool = new Pool({
  host: requiredEnvironmentVariable("DB_HOST"),
  port,
  database: requiredEnvironmentVariable("DB_NAME"),
  user: requiredEnvironmentVariable("DB_USER"),
  password,
  max: Number(process.env.DB_POOL_MAX || 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  application_name: "company-ticket-backend",
});

pool.on("error", (error) => {
  console.error("Unexpected idle database connection error:", error.message);
});

module.exports = pool;
