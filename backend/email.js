const fs = require('node:fs');
const nodemailer = require('nodemailer');
const emailPattern = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;

function mailConfiguration(env = process.env) {
  if (env.SMTP_ENABLED !== 'true') return null;
  const port = Number(env.SMTP_PORT || 587);
  if (!env.SMTP_HOST || !emailPattern.test(env.SMTP_FROM || '') || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_smtp_configuration');
  let pass = env.SMTP_PASSWORD_FILE ? fs.readFileSync(env.SMTP_PASSWORD_FILE, 'utf8').trim() : env.SMTP_PASSWORD;
  if (env.SMTP_USER && !pass) throw new Error('smtp_password_required');
  const url = env.PUBLIC_APP_URL ? new URL(env.PUBLIC_APP_URL) : null;
  if (url && (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')) throw new Error('invalid_public_app_url');
  return {
    from: env.SMTP_FROM, portal: url?.origin,
    options: { host: env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass } : undefined,
      connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 30000,
      disableFileAccess: true, disableUrlAccess: true },
  };
}

function notificationMessage(row, config) {
  const reasons = { status_changed: 'The status of your support ticket has changed.', assignment_changed: 'Your support ticket routing has been updated.', department_changed: 'Your support ticket routing has been updated.', public_reply: 'IT support has posted a reply to your ticket.' };
  return { from: { name: 'TicketDesk', address: config.from }, to: row.recipient,
    messageId: `<ticketdesk-notification-${row.id}@${config.from.split('@')[1]}>`,
    subject: `TicketDesk: ticket #${row.ticket_id} updated`,
    text: `${reasons[row.kind] || 'Your support ticket has been updated.'}\nTicket reference: #${row.ticket_id}\nStatus: ${row.ticket_status.replaceAll('_', ' ')}\n\nOpen the private tracking link you saved when you submitted your request to view the details.${config.portal ? `\nSupport portal: ${config.portal}` : ''}\n\nThis mailbox does not accept ticket replies. Reply through your tracking page.`,
  };
}

function createEmailWorker(pool, { env = process.env, createTransport = nodemailer.createTransport, logger = console, configurationProvider } = {}) {
  let config, transport, timer, busy = false, running;
  let configurationError = false;
  try { config = mailConfiguration(env); if (config) transport = createTransport(config.options); }
  catch { configurationError = true; logger.error('Email notifications: invalid configuration; ticket operations remain available.'); }
  async function refreshConfiguration() {
    if (!configurationProvider) return;
    try {
      const next = await configurationProvider();
      if (JSON.stringify(next) !== JSON.stringify(config)) { transport?.close(); config = next; transport = next ? createTransport(next.options) : undefined; }
      configurationError = false;
    } catch { transport?.close(); transport = undefined; config = undefined; configurationError = true; }
  }
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await refreshConfiguration();
      if (!transport) return;
      await pool.query("UPDATE email_notifications SET state = 'expired', error_code = NULL WHERE state IN ('pending', 'sending') AND created_at < CURRENT_TIMESTAMP - INTERVAL '24 hours'");
      await pool.query("UPDATE email_notifications SET state = 'failed' WHERE state = 'sending' AND attempts >= 6 AND available_at < CURRENT_TIMESTAMP");
      const result = await pool.query(`WITH candidate AS (
        SELECT id FROM email_notifications
        WHERE attempts < 6 AND ((state = 'pending' AND available_at <= CURRENT_TIMESTAMP) OR (state = 'sending' AND available_at < CURRENT_TIMESTAMP))
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE email_notifications n SET state = 'sending', attempts = attempts + 1,
        available_at = CURRENT_TIMESTAMP + INTERVAL '5 minutes'
        FROM candidate WHERE n.id = candidate.id RETURNING n.*`);
      const row = result.rows[0];
      if (!row) return;
      try {
        if (!emailPattern.test(row.recipient)) throw Object.assign(new Error(), { code: 'INVALID_RECIPIENT' });
        const sent = await transport.sendMail(notificationMessage(row, config));
        if (!sent.accepted?.length) throw Object.assign(new Error(), { code: 'SMTP_REJECTED' });
        await pool.query("UPDATE email_notifications SET state = 'sent', sent_at = CURRENT_TIMESTAMP, error_code = NULL WHERE id = $1", [row.id]);
      } catch (error) {
        const code = String(error.code || 'SEND_FAILED').replace(/[^A-Z0-9_]/g, '').slice(0, 40) || 'SEND_FAILED';
        await pool.query(`UPDATE email_notifications SET state = CASE WHEN attempts >= 6 THEN 'failed' ELSE 'pending' END,
          error_code = $2, available_at = CURRENT_TIMESTAMP + ($3::integer * INTERVAL '1 minute') WHERE id = $1`, [row.id, code, Math.min(60, 2 ** row.attempts)]);
        logger.warn(`Email notification ${row.id} deferred (${code}).`);
      }
    } catch { logger.error('Email notification worker failed; it will retry.'); }
    finally { busy = false; }
  }
  return {
    start() { if ((!transport && !configurationProvider) || timer) return; running = tick(); timer = setInterval(() => { if (!busy) running = tick(); }, 5000); timer.unref(); },
    async stop() { clearInterval(timer); timer = null; await running; transport?.close(); },
    tick,
    async status() {
      if (!busy) await refreshConfiguration();
      const result = await pool.query('SELECT state, count(*)::integer AS count FROM email_notifications GROUP BY state');
      return { enabled: Boolean(transport), configuration_error: configurationError, counts: Object.fromEntries(result.rows.map(row => [row.state, row.count])) };
    },
  };
}
module.exports = { mailConfiguration, notificationMessage, createEmailWorker };
