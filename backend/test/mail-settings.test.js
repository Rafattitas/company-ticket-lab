const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const express = require('express');
const { createMailSettings } = require('../mail-settings'); const { createAuthentication } = require('../auth');
const settings = { enabled: true, host: 'smtp.example.com', port: 587, from: 'support@example.com', username: 'sender', portal_url: '', password: 'private-test-password' };
async function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticketdesk-mail-')); let saved;
  const pool = { async query(sql, values) {
    if (sql.includes('FROM auth_sessions')) return { rows: [{ id: 1, role: 'admin', must_change_password: false }] };
    if (sql.startsWith('INSERT INTO mail_settings')) { saved = { settings: JSON.parse(values[0]), encrypted_password: values[1] }; return { rows: [] }; }
    return { rows: saved ? [saved] : [] };
  } };
  const options = { env: {}, keyFile: path.join(dir, 'key'), createTransport: () => ({ async sendMail(message) { return { accepted: [message.to] }; }, close() {} }) };
  const service = createMailSettings(pool, options);
  try { await run({ service, pool, options, getRow: () => saved }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
test('settings encrypt password and survive service recreation without exposing it', async () => fixture(async ({ service, pool, options, getRow }) => {
  const response = await service.save(settings);
  assert.equal(response.password_present, true); assert.equal(response.password, undefined);
  assert.ok(!JSON.stringify(getRow()).includes(settings.password));
  assert.equal((await createMailSettings(pool, options).configuration()).options.auth.pass, settings.password);
  await service.save({ ...settings, password: '' }); assert.equal((await service.configuration()).options.auth.pass, settings.password);
  await assert.rejects(service.save({ ...settings, host: 'other.example.com', password: '' }), /mail_password_required/);
  await service.save({ ...settings, enabled: false, password: '', clear_password: true }); assert.equal(await service.configuration(), null);
}));
test('missing encryption key fails closed; replacing password recovers', async () => fixture(async ({ service, options }) => {
  await service.save(settings); fs.unlinkSync(options.keyFile);
  await assert.rejects(service.configuration());
  await service.save({ ...settings, password: 'new-private-password' }); assert.equal((await service.configuration()).options.auth.pass, 'new-private-password');
}));
test('environment password is never silently copied into dashboard', async () => fixture(async ({ pool, options }) => {
  const service = createMailSettings(pool, { ...options, env: { SMTP_PASSWORD: 'ENV_SECRET', SMTP_USER: 'sender' } });
  assert.equal((await service.publicSettings()).password_present, true);
  await assert.rejects(service.save({ ...settings, password: '' }), /smtp_password_required/);
}));
test('API denies anonymous users and cross-origin mutations; tests saved settings', async () => fixture(async ({ service, pool }) => {
  const app = express(); app.use(express.json()); app.use('/settings', createAuthentication(pool).requirePermission('accounts:manage'), service.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`; const headers = { cookie: `ticketdesk_session=${'a'.repeat(64)}`, 'content-type': 'application/json' };
  try {
    assert.equal((await fetch(`${base}/settings`)).status, 401);
    assert.equal((await fetch(`${base}/settings`, { method: 'PUT', headers: { ...headers, Origin: 'https://evil.example' }, body: JSON.stringify(settings) })).status, 403);
    const save = await fetch(`${base}/settings`, { method: 'PUT', headers: { ...headers, Origin: base }, body: JSON.stringify(settings) }); assert.equal(save.status, 200); assert.ok(!(await save.text()).includes(settings.password));
    const sent = await fetch(`${base}/settings/test`, { method: 'POST', headers, body: JSON.stringify({ recipient: 'controlled@example.com' }) }); assert.equal(sent.status, 200);
    assert.equal((await fetch(`${base}/settings/test`, { method: 'POST', headers, body: JSON.stringify({ recipient: 'controlled@example.com' }) })).status, 429);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));
test('worker reloads saved configuration while running without a restart', async () => {
  const { createEmailWorker, mailConfiguration } = require('../email'); let enabled = false; let sends = 0;
  const worker = createEmailWorker({ async query(sql) { return { rows: sql.includes('WITH candidate') ? [{ id: 1, ticket_id: 1, recipient: 'employee@example.com', kind: 'public_reply', ticket_status: 'open', attempts: 1 }] : [] }; } }, {
    env: {}, configurationProvider: async () => enabled ? mailConfiguration({ SMTP_ENABLED: 'true', SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'support@example.com' }) : null,
    createTransport: () => ({ async sendMail() { sends++; return { accepted: ['employee@example.com'] }; }, close() {} }),
  });
  await worker.tick(); assert.equal(sends, 0); enabled = true; await worker.tick(); assert.equal(sends, 1);
  enabled = false; await worker.tick(); assert.equal(sends, 1); assert.equal((await worker.status()).enabled, false);
});
