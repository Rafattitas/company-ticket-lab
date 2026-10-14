const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const nodemailer = require('nodemailer');
const { mailConfiguration } = require('./email');
const emailPattern = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
function createMailSettings(pool, { env = process.env, keyFile = env.MAIL_SETTINGS_KEY_FILE || '/app/settings/mail.key', createTransport = nodemailer.createTransport } = {}) {
  function key(create = false) {
    if (create && !fs.existsSync(keyFile)) {
      fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
      try { fs.writeFileSync(keyFile, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const bytes = fs.readFileSync(keyFile);
    if (bytes.length !== 32) throw new Error('invalid_mail_key');
    return bytes;
  }
  function encrypt(value) {
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key(true), iv);
    return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64');
  }
  function decrypt(value) {
    const bytes = Buffer.from(value, 'base64'); const cipher = crypto.createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
    cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8');
  }
  async function row() { return (await pool.query('SELECT settings, encrypted_password FROM mail_settings WHERE id = 1')).rows[0]; }
  function asEnv(settings, password) { return { SMTP_ENABLED: settings.enabled ? 'true' : 'false', SMTP_HOST: settings.host, SMTP_PORT: String(settings.port), SMTP_FROM: settings.from, SMTP_USER: settings.username, SMTP_PASSWORD: password, PUBLIC_APP_URL: settings.portal_url }; }
  async function publicSettings() {
    const saved = await row();
    return saved ? { ...saved.settings, password_present: Boolean(saved.encrypted_password), source: 'dashboard' } : { enabled: env.SMTP_ENABLED === 'true', host: env.SMTP_HOST || '', port: Number(env.SMTP_PORT || 587), from: env.SMTP_FROM || '', username: env.SMTP_USER || '', portal_url: env.PUBLIC_APP_URL || '', password_present: Boolean(env.SMTP_PASSWORD || env.SMTP_PASSWORD_FILE), source: 'environment' };
  }
  async function configuration() {
    const saved = await row();
    if (!saved) return mailConfiguration(env);
    if (!saved.settings.enabled) return null;
    return mailConfiguration(asEnv(saved.settings, saved.encrypted_password ? decrypt(saved.encrypted_password) : undefined));
  }
  async function save(input) {
    if (typeof input.enabled !== 'boolean' || typeof input.host !== 'string' || !/^[a-zA-Z0-9._:-]{1,253}$/.test(input.host) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 || !emailPattern.test(input.from || '') || typeof input.username !== 'string' || input.username.length > 254 || /[\r\n]/.test(input.username) || typeof input.portal_url !== 'string') throw new Error('invalid_mail_settings');
    if (input.password != null && (typeof input.password !== 'string' || input.password.length > 4096)) throw new Error('invalid_mail_settings');
    if (input.clear_password != null && typeof input.clear_password !== 'boolean') throw new Error('invalid_mail_settings');
    if (input.clear_password && input.password) throw new Error('invalid_mail_settings');
    const previous = await row();
    let encrypted = previous?.encrypted_password || null;
    if (input.clear_password === true) encrypted = null;
    if (input.password) encrypted = encrypt(input.password);
    if (!input.password && encrypted && (previous.settings.host !== input.host || previous.settings.username !== input.username || previous.settings.port !== input.port)) throw new Error('mail_password_required_for_new_server');
    // Environment credentials are never silently copied into dashboard settings.
    const settings = { enabled: input.enabled, host: input.host, port: input.port, from: input.from, username: input.username, portal_url: input.portal_url };
    mailConfiguration({ ...asEnv(settings, encrypted || !input.enabled ? 'stored-password' : undefined), SMTP_ENABLED: 'true' });
    await pool.query(`INSERT INTO mail_settings(id,settings,encrypted_password) VALUES (1,$1::jsonb,$2)
      ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings, encrypted_password = EXCLUDED.encrypted_password, updated_at = CURRENT_TIMESTAMP`, [JSON.stringify(settings), encrypted]);
    return publicSettings();
  }
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Same-origin mutation guard complements the SameSite session cookie.
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.get('Origin')) {
      try { if (new URL(req.get('Origin')).host !== req.get('Host')) return res.status(403).json({ error: 'invalid_origin' }); }
      catch { return res.status(403).json({ error: 'invalid_origin' }); }
    }
    next();
  });
  router.get('/', async (req, res, next) => { try { res.json(await publicSettings()); } catch (error) { next(error); } });
  router.put('/', async (req, res) => {
    try { res.json(await save(req.body || {})); }
    catch (error) { res.status(400).json({ error: ['invalid_mail_settings', 'mail_password_required_for_new_server', 'smtp_password_required'].includes(error.message) ? error.message : 'mail_settings_save_failed' }); }
  });
  let testing = false; let lastTest = 0;
  router.post('/test', async (req, res) => {
    if (!emailPattern.test(req.body?.recipient || '')) return res.status(400).json({ error: 'invalid_test_recipient' });
    if (testing || Date.now() - lastTest < 30000) return res.status(429).json({ error: 'mail_test_rate_limited' });
    testing = true; lastTest = Date.now(); let transport;
    try {
      const config = await configuration();
      if (!config) return res.status(400).json({ error: 'mail_disabled' });
      transport = createTransport(config.options);
      const result = await transport.sendMail({ from: { name: 'TicketDesk', address: config.from }, to: req.body.recipient, subject: 'TicketDesk email test', text: 'Your TicketDesk email settings are working. This is a test notification.' });
      if (!result.accepted?.length) throw new Error('rejected');
      res.json({ accepted: true });
    } catch { res.status(502).json({ error: 'mail_test_failed' }); }
    finally { transport?.close(); testing = false; }
  });
  return { configuration, publicSettings, save, router };
}
module.exports = { createMailSettings };
