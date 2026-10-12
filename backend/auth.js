const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const sessionCookie = "ticketdesk_session";
const sessionHours = 12;
const allowedRoles = new Set(["admin", "agent", "viewer"]);
const rolePermissions = {
  admin: ["tickets:read", "tickets:update", "accounts:manage"],
  agent: ["tickets:read", "tickets:update"],
  viewer: ["tickets:read"],
};
const dummyPasswordHash = `scrypt:ticketdesk-login-check:${crypto.scryptSync("invalid-login", "ticketdesk-login-check", 64).toString("hex")}`;

function cleanString(value, maximumLength) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength + 1) : "";
}

function normalizeUsername(value) {
  return cleanString(value, 64).toLowerCase();
}

function validUsername(value) {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value);
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

async function verifyPassword(password, storedValue) {
  const [algorithm, salt, expectedHex] = String(storedValue).split(":");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const actual = await scrypt(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function readCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
      const separator = part.indexOf("=");
      return separator < 0 ? [part, ""] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
    }),
  );
}

function cookieOptions(maxAge) {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  return `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function ensureBootstrapAdmin(pool) {
  const existing = await pool.query("SELECT 1 FROM user_accounts LIMIT 1");
  if (existing.rowCount > 0) return;

  const username = normalizeUsername(process.env.ADMIN_USERNAME || "admin");
  const passwordFile = process.env.ADMIN_PASSWORD_FILE;
  const password = passwordFile
    ? fs.readFileSync(passwordFile, "utf8").trim()
    : String(process.env.ADMIN_PASSWORD || "");

  if (!validUsername(username) || password.length < 12) {
    throw new Error("Initial admin username is invalid or password is shorter than 12 characters");
  }

  await pool.query(
    `INSERT INTO user_accounts (username, display_name, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (username) DO NOTHING`,
    [username, "TicketDesk administrator", await hashPassword(password)],
  );
  console.log(`Created initial TicketDesk administrator: ${username}`);
}

function createAuthentication(pool) {
  async function currentUser(request) {
    const token = readCookies(request)[sessionCookie];
    if (!token || token.length !== 64) return null;

    const result = await pool.query(
      `SELECT users.id, users.username, users.display_name, users.role
       FROM auth_sessions sessions
       JOIN user_accounts users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1
         AND sessions.expires_at > CURRENT_TIMESTAMP
         AND users.active = TRUE`,
      [hashToken(token)],
    );
    if (result.rowCount === 0) return null;
    const user = result.rows[0];
    return { ...user, permissions: rolePermissions[user.role] || [] };
  }

  function requirePermission(permission) {
    return async (request, response, next) => {
      try {
        const user = await currentUser(request);
        if (!user) return response.status(401).json({ error: "authentication_required" });
        if (!user.permissions.includes(permission)) return response.status(403).json({ error: "permission_denied" });
        request.user = user;
        return next();
      } catch (error) { return next(error); }
    };
  }

  const router = express.Router();

  router.post("/login", async (request, response, next) => {
    const username = normalizeUsername(request.body.username);
    const password = typeof request.body.password === "string" ? request.body.password.slice(0, 256) : "";
    try {
      const result = await pool.query(
        `SELECT id, username, display_name, role, password_hash
         FROM user_accounts WHERE username = $1 AND active = TRUE`,
        [username],
      );
      const account = result.rows[0];
      const passwordMatches = await verifyPassword(password, account?.password_hash || dummyPasswordHash);
      if (!account || !passwordMatches) {
        return response.status(401).json({ error: "invalid_credentials" });
      }

      const token = crypto.randomBytes(32).toString("hex");
      await pool.query("DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP");
      await pool.query(
        `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 hour'))`,
        [account.id, hashToken(token), sessionHours],
      );
      response.set("Set-Cookie", cookieOptions(sessionHours * 60 * 60).replace(`${sessionCookie}=`, `${sessionCookie}=${token}`));
      return response.json({ user: { id: account.id, username: account.username, display_name: account.display_name, role: account.role, permissions: rolePermissions[account.role] } });
    } catch (error) { return next(error); }
  });

  router.post("/logout", async (request, response, next) => {
    const token = readCookies(request)[sessionCookie];
    try {
      if (token) await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashToken(token)]);
      response.set("Set-Cookie", cookieOptions(0));
      return response.status(204).end();
    } catch (error) { return next(error); }
  });

  router.get("/me", requirePermission("tickets:read"), (request, response) => response.json({ user: request.user }));

  router.get("/accounts", requirePermission("accounts:manage"), async (request, response, next) => {
    try {
      const result = await pool.query("SELECT id, username, display_name, role, active, created_at FROM user_accounts ORDER BY username");
      return response.json({ accounts: result.rows });
    } catch (error) { return next(error); }
  });

  router.post("/accounts", requirePermission("accounts:manage"), async (request, response, next) => {
    const username = normalizeUsername(request.body.username);
    const displayName = cleanString(request.body.display_name, 120);
    const password = typeof request.body.password === "string" ? request.body.password.slice(0, 256) : "";
    const role = cleanString(request.body.role, 20);
    if (!validUsername(username)) return response.status(400).json({ error: "invalid_username" });
    if (displayName.length < 2) return response.status(400).json({ error: "invalid_display_name" });
    if (password.length < 12) return response.status(400).json({ error: "password_too_short" });
    if (!allowedRoles.has(role)) return response.status(400).json({ error: "invalid_role" });
    try {
      const result = await pool.query(
        `INSERT INTO user_accounts (username, display_name, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, display_name, role, active, created_at`,
        [username, displayName, await hashPassword(password), role],
      );
      return response.status(201).json({ account: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return response.status(409).json({ error: "username_already_exists" });
      return next(error);
    }
  });

  router.patch("/accounts/:id", requirePermission("accounts:manage"), async (request, response, next) => {
    const id = Number(request.params.id);
    const displayName = cleanString(request.body.display_name, 120);
    const role = cleanString(request.body.role, 20);
    const active = request.body.active;
    const password = typeof request.body.password === "string" ? request.body.password.slice(0, 256) : "";
    if (!Number.isSafeInteger(id) || id <= 0) return response.status(400).json({ error: "invalid_account_id" });
    if (id === Number(request.user.id) && active === false) return response.status(400).json({ error: "cannot_disable_current_account" });
    if (displayName && displayName.length < 2) return response.status(400).json({ error: "invalid_display_name" });
    if (role && !allowedRoles.has(role)) return response.status(400).json({ error: "invalid_role" });
    if (password && password.length < 12) return response.status(400).json({ error: "password_too_short" });
    try {
      const target = await pool.query("SELECT role, active FROM user_accounts WHERE id = $1", [id]);
      if (target.rowCount === 0) return response.status(404).json({ error: "account_not_found" });
      const removesActiveAdmin = target.rows[0].role === "admin" && target.rows[0].active
        && ((role && role !== "admin") || active === false);
      if (removesActiveAdmin) {
        const administrators = await pool.query("SELECT COUNT(*)::integer AS count FROM user_accounts WHERE role = 'admin' AND active = TRUE");
        if (administrators.rows[0].count <= 1) return response.status(400).json({ error: "last_admin_required" });
      }
      const passwordHash = password ? await hashPassword(password) : null;
      const result = await pool.query(
        `UPDATE user_accounts SET
           display_name = COALESCE(NULLIF($1, ''), display_name),
           role = COALESCE(NULLIF($2, ''), role),
           active = COALESCE($3::boolean, active),
           password_hash = COALESCE($4, password_hash),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING id, username, display_name, role, active, created_at`,
        [displayName, role, typeof active === "boolean" ? active : null, passwordHash, id],
      );
      if (result.rowCount === 0) return response.status(404).json({ error: "account_not_found" });
      if (passwordHash || active === false) await pool.query("DELETE FROM auth_sessions WHERE user_id = $1", [id]);
      return response.json({ account: result.rows[0] });
    } catch (error) { return next(error); }
  });

  return { router, requirePermission };
}

module.exports = { createAuthentication, ensureBootstrapAdmin, hashPassword, verifyPassword };
