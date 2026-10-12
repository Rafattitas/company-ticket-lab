const fs = require("node:fs");
const path = require("node:path");

async function runMigrations(pool) {
  const migrationsDirectory = path.join(__dirname, "migrations");
  const migrations = fs.readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const migration of migrations) {
    const applied = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE name = $1",
      [migration],
    );

    if (applied.rowCount > 0) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDirectory, migration), "utf8");
    const client = await pool.connect();

    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        [migration],
      );
      console.log(`Applied database migration: ${migration}`);
    } finally {
      client.release();
    }
  }
}

module.exports = runMigrations;
