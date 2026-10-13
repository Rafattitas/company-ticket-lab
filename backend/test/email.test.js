const test = require('node:test');
const assert = require('node:assert/strict');
const { mailConfiguration, notificationMessage, createEmailWorker } = require('../email');
const env = { SMTP_ENABLED: 'true', SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'support@example.com', SMTP_USER: 'sender', SMTP_PASSWORD: 'test-only-password', PUBLIC_APP_URL: 'https://tickets.example.com' };
const logger = { error() {}, warn() {} };
const row = { id: '7', ticket_id: '12', recipient: 'employee@example.com', kind: 'public_reply', ticket_status: 'in_progress', attempts: 1, body: 'PRIVATE NOTE', tracking_token: 'PRIVATE TOKEN', author_name: 'PRIVATE IDENTITY' };
test('SMTP is opt-in, requires encryption, and validates configuration', () => {
  assert.equal(mailConfiguration({}), null);
  assert.equal(mailConfiguration(env).options.requireTLS, true);
  assert.equal(mailConfiguration({ ...env, SMTP_PORT: '465' }).options.secure, true);
  for (const overrides of [{ SMTP_PORT: 'oops' }, { SMTP_FROM: 'one@example.com\r\nBcc: other@example.com' }, { PUBLIC_APP_URL: 'https://tickets.example.com/#secret' }, { SMTP_PASSWORD: '' }]) assert.throws(() => mailConfiguration({ ...env, ...overrides }));
});
test('notification excludes content, identities, and private tokens', () => {
  const message = notificationMessage(row, mailConfiguration(env));
  assert.equal(message.to, 'employee@example.com'); assert.match(message.text, /posted a reply/);
  assert.doesNotMatch(JSON.stringify(message), /PRIVATE|\/track\/|internal/);
  assert.equal(message.messageId, '<ticketdesk-notification-7@example.com>');
});
test('worker claims with a lease and records SMTP acceptance', async () => {
  const calls = []; const messages = [];
  const pool = { async query(sql, values) { calls.push({ sql, values }); return { rows: sql.includes('WITH candidate') ? [row] : [] }; } };
  const worker = createEmailWorker(pool, { env, logger, createTransport: () => ({ async sendMail(message) { messages.push(message); return { accepted: [message.to] }; } }) });
  await worker.tick(); assert.equal(messages.length, 1);
  assert.match(calls.find(call => call.sql.includes('WITH candidate')).sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls.at(-1).sql, /state = 'sent'/);
});
test('SMTP failure persists retry without leaking raw errors', async () => {
  const calls = [];
  const worker = createEmailWorker({ async query(sql, values) { calls.push({ sql, values }); return { rows: sql.includes('WITH candidate') ? [row] : [] }; } }, { env, logger, createTransport: () => ({ async sendMail() { throw Object.assign(new Error('SECRET CREDENTIAL'), { code: 'EAUTH' }); } }) });
  await worker.tick(); assert.deepEqual(calls.at(-1).values, ['7', 'EAUTH', 2]);
  assert.match(calls.at(-1).sql, /attempts >= 6 THEN 'failed'/); assert.doesNotMatch(JSON.stringify(calls), /SECRET CREDENTIAL/);
});
test('disabled SMTP does not connect; invalid configuration is visible', async () => {
  let connects = 0; const pool = { async query() { return { rows: [{ state: 'pending', count: 3 }] }; } };
  const worker = createEmailWorker(pool, { env: {}, logger, createTransport() { connects++; } });
  await worker.tick(); assert.equal(connects, 0);
  assert.deepEqual(await worker.status(), { enabled: false, configuration_error: false, counts: { pending: 3 } });
  assert.equal((await createEmailWorker(pool, { env: { SMTP_ENABLED: 'true' }, logger }).status()).configuration_error, true);
});
test('worker prevents overlapping sends', async () => {
  let release; let sends = 0;
  const pool = { async query(sql) { return { rows: sql.includes('WITH candidate') ? [row] : [] }; } };
  const worker = createEmailWorker(pool, { env, logger, createTransport: () => ({ async sendMail() { sends++; await new Promise(resolve => { release = resolve; }); return { accepted: [row.recipient] }; } }) });
  const first = worker.tick(); while (!release) await new Promise(resolve => setImmediate(resolve));
  await worker.tick(); assert.equal(sends, 1); release(); await first;
});
test('real SMTP transport refuses a server that cannot upgrade to TLS', async () => {
  const net = require('node:net'); const nodemailer = require('nodemailer');
  const commands = []; const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.write('220 test.example ESMTP\r\n');
    socket.on('data', chunk => {
      for (const line of chunk.toString().split('\r\n').filter(Boolean)) {
        commands.push(line);
        socket.write(line.startsWith('EHLO') ? '250 test.example\r\n' : '500 TLS unavailable\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const config = mailConfiguration({ ...env, SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port) });
  const transport = nodemailer.createTransport(config.options);
  try {
    await assert.rejects(transport.sendMail(notificationMessage(row, config)));
    assert.ok(commands.some(line => line === 'STARTTLS'));
    assert.ok(!commands.some(line => line.startsWith('AUTH') || line.startsWith('MAIL FROM')));
  } finally { transport.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
});
