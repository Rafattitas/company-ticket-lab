import { useEffect, useState } from 'react'
const messages = {
  mail_password_required_for_new_server: 'Enter the SMTP password again when changing the server, port, or username.',
  smtp_password_required: 'Enter the SMTP password for this username.',
  invalid_mail_settings: 'Check the server, port, sender email, and website address.',
  mail_settings_save_failed: 'Could not save settings. Check the encryption key volume and the entered values.',
  mail_disabled: 'Enable email and save the settings before testing.',
  invalid_test_recipient: 'Enter a valid test email address.',
  mail_test_rate_limited: 'Wait 30 seconds before sending another test.',
  mail_test_failed: 'The mail service did not accept the test. Check your server, credentials, TLS port, and sender verification.',
}
async function request(path = '', options) {
  const response = await fetch(`/api/notifications/settings${path}`, options)
  const data = await response.json()
  if (!response.ok) throw new Error(messages[data.error] || 'Could not complete this action. Check your session and try again.')
  return data
}
export function MailSettings({ status, onSaved }) {
  const [form, setForm] = useState(null)
  const [password, setPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    request('', { signal: controller.signal }).then(setForm).catch(cause => { if (cause.name !== 'AbortError') setError(cause.message) })
    return () => controller.abort()
  }, [])
  function change(field, value) { setForm(current => ({ ...current, [field]: value })); setDirty(true); setMessage('') }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      const saved = await request('', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, password, clear_password: clearPassword }) })
      setForm(saved); setPassword(''); setClearPassword(false); setDirty(false); setMessage('Settings saved. Notifications use them automatically within a few seconds.'); onSaved()
    } catch (cause) { setError(cause.message) } finally { setBusy(false) }
  }
  async function test(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try { await request('/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipient }) }); setMessage('Test accepted by the mail service. Check your inbox and spam folder.') }
    catch (cause) { setError(cause.message) } finally { setBusy(false) }
  }
  return <section className="operations-settings mail-settings"><div className="section-heading"><div><h3>Email settings</h3><p>{status?.configuration_error ? 'The saved mail configuration needs attention.' : status?.enabled ? 'Notifications are enabled.' : 'Notifications are currently off.'}</p></div><button className="secondary-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide settings' : 'Configure email'}</button></div>
    {status && <p className="report-scope">Pending: {status.counts.pending || 0} · Sending: {status.counts.sending || 0} · Accepted: {status.counts.sent || 0} · Failed: {status.counts.failed || 0} · Expired: {status.counts.expired || 0}</p>}
    {error && <p role="alert" className="alert">{error}</p>}{message && <p role="status" className="success-notice">{message}</p>}
    {expanded && (form ? <><p>Use the SMTP details provided by your email service. Changes apply without restarting the system. Use HTTPS or an SSH tunnel when entering credentials.</p><p className="report-scope">Current source: {form.source === 'dashboard' ? 'Saved in this dashboard' : 'Server environment (saving here replaces it)'}. Private notes and tracking tokens are never emailed.</p>
      <form onSubmit={save}><fieldset disabled={busy} className="mail-fieldset"><label className="mail-toggle"><input type="checkbox" checked={form.enabled} onChange={e => change('enabled', e.target.checked)} />Enable email notifications</label><div className="form-grid">
        <label>SMTP server<input required maxLength={253} value={form.host} onChange={e => change('host', e.target.value)} placeholder="mail.smtp2go.com" /></label>
        <label>Port<select value={form.port} onChange={e => change('port', Number(e.target.value))}><option value={587}>587 — STARTTLS</option><option value={465}>465 — TLS</option>{![587,465].includes(form.port) && <option value={form.port}>{form.port} — STARTTLS</option>}</select></label>
        <label>Sender email<input required type="email" value={form.from} onChange={e => change('from', e.target.value)} placeholder="support@your-company.com" /></label>
        <label>SMTP username<input maxLength={254} value={form.username} onChange={e => change('username', e.target.value)} autoComplete="off" /><small className="field-hint">Leave blank only if your relay needs no login.</small></label>
        <label>SMTP password<input type="password" maxLength={4096} value={password} onChange={e => { setPassword(e.target.value); setDirty(true) }} autoComplete="new-password" placeholder={form.password_present ? 'Stored securely — leave blank to keep' : 'Password or SMTP key'} /><small className="field-hint">The saved password is never displayed.</small></label>
        <label>Support website (optional)<input type="url" value={form.portal_url} onChange={e => change('portal_url', e.target.value)} placeholder="https://tickets.example.com" /></label>
      </div>{form.password_present && <label className="mail-toggle"><input type="checkbox" checked={clearPassword} onChange={e => { setClearPassword(e.target.checked); setDirty(true) }} />Remove stored password when saving</label>}<div className="form-actions"><button className="primary-button" disabled={busy}>{busy ? 'Working…' : 'Save email settings'}</button></div></fieldset></form>
      <form className="mail-test" onSubmit={test}><label>Send a test to<input required type="email" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="your-email@example.com" /></label><button className="secondary-button" disabled={busy || dirty || !form.enabled}>Send test email</button></form>{dirty && <p className="field-hint">Save your changes before sending a test.</p>}
    </> : <p role="status">Loading email settings…</p>)}
  </section>
}
