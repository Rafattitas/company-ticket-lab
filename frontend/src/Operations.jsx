import { useEffect, useState } from 'react'

async function request(path, options) {
  const response = await fetch(`/api/operations${path}`, options)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error === 'department_already_exists' ? 'A department with this name already exists.' : 'Could not complete this action. Check your input and permissions, then try again.')
  return data
}

function hours(value) { return value == null ? 'Not measured yet' : `${Number(value).toFixed(1)} h` }

export function TicketSla({ ticket, now }) {
  const closed = ['resolved', 'closed'].includes(ticket.status)
  if (!ticket.resolution_due_at) return <p className="sla-legacy">Legacy ticket · no SLA measurement</p>
  return <div className="sla-details">
    {[['Response', ticket.response_due_at, ticket.first_response_at], ['Resolution', ticket.resolution_due_at, ticket.resolved_at]].map(([label, due, completed]) => {
      const late = completed ? new Date(completed) > new Date(due) : !closed && new Date(due).getTime() < now
      return <div key={label} className={late ? 'sla-late' : ''}><strong>{label}: {completed ? late ? 'Completed late' : 'Met' : closed ? 'Closed without a reply' : late ? 'Overdue' : 'Due'}</strong><span>{new Date(due).toLocaleString()}</span></div>
    })}
  </div>
}

function PolicyForm({ policy, onSave }) {
  const [response, setResponse] = useState(policy.response_hours)
  const [resolution, setResolution] = useState(policy.resolution_hours)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  async function submit(event) {
    event.preventDefault(); setSaving(true); setMessage('')
    try { await onSave(policy.priority, Number(response), Number(resolution)); setMessage('Saved for new tickets.') }
    catch (cause) { setMessage(cause.message) } finally { setSaving(false) }
  }
  return <form className="sla-policy" onSubmit={submit}><strong>{policy.priority}</strong><label>Response hours<input type="number" required min="1" max="8760" step="1" value={response} onChange={(event) => setResponse(event.target.value)} /></label><label>Resolution hours<input type="number" required min={Number(response) || 1} max="8760" step="1" value={resolution} onChange={(event) => setResolution(event.target.value)} /></label><button className="secondary-button" disabled={saving}>{saving ? 'Saving…' : 'Save policy'}</button><span role="status">{message}</span></form>
}

export function OperationsPanel({ canManage }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [departments, setDepartments] = useState([])
  const [policies, setPolicies] = useState([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([request(`/reports?days=${days}`, { signal: controller.signal }), request('/slas', { signal: controller.signal }), canManage ? request('/departments/all', { signal: controller.signal }) : Promise.resolve({ departments: [] })])
      .then(([report, sla, teams]) => { setData(report); setPolicies(sla.policies); setDepartments(teams.departments); setError('') })
      .catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message) })
    return () => controller.abort()
  }, [days, revision, canManage])

  async function addDepartment(event) {
    event.preventDefault(); setError(''); setSaving(true)
    try { await request('/departments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }); setName(''); setRevision((value) => value + 1) }
    catch (cause) { setError(cause.message) } finally { setSaving(false) }
  }
  async function toggleDepartment(department) {
    setError('')
    try { await request(`/departments/${department.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: !department.active }) }); setRevision((value) => value + 1) }
    catch (cause) { setError(cause.message) }
  }
  async function savePolicy(priority, response_hours, resolution_hours) {
    await request(`/slas/${priority}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response_hours, resolution_hours }) })
  }

  return <section className="operations-panel">
    <div className="section-heading"><div><p className="eyebrow">Service performance</p><h2>Reports & service targets</h2></div><button className="secondary-button" onClick={() => setRevision((value) => value + 1)}>Refresh report</button></div>
    <label className="report-period">Created in the last<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">365 days</option></select></label>
    {error && <p role="alert" className="alert">{error}</p>}
    {!data && !error && <p role="status">Loading reports…</p>}
    {data && <><p className="report-scope">Period: last {data.days} days by ticket creation. Workload and overdue totals cover all outstanding tickets. Updated {new Date(data.generated_at).toLocaleString()}.</p>
      <div className="stats"><article><span>Created in period</span><strong>{data.period_summary.created}</strong></article><article><span>Resolved / closed</span><strong>{data.period_summary.resolved}</strong></article><article><span>Average time to resolve</span><strong className="metric-value">{hours(data.period_summary.average_resolution_hours)}</strong></article><article><span>Average first response</span><strong className="metric-value">{hours(data.period_summary.average_response_hours)}</strong></article></div>
      <div className="stats"><article><span>All outstanding</span><strong>{data.current_summary.outstanding}</strong></article><article><span>Waiting for assignment</span><strong>{data.current_summary.unassigned}</strong></article><article className="urgent-stat"><span>Response overdue</span><strong>{data.current_summary.response_overdue}</strong></article><article className="urgent-stat"><span>Resolution overdue</span><strong>{data.current_summary.resolution_overdue}</strong></article></div>
      <p>{data.current_summary.without_sla} outstanding legacy tickets have no SLA deadlines. They remain in workload totals.</p>
      <h3>Technician workload — all outstanding tickets</h3><div className="report-table"><table><thead><tr><th>Technician</th><th>Outstanding</th><th>Resolution overdue</th></tr></thead><tbody>{data.workload.map((row, index) => <tr key={`${row.user_id}-${index}`}><td>{row.name}</td><td>{row.outstanding}</td><td>{row.overdue}</td></tr>)}</tbody></table>{!data.workload.length && <p>No outstanding tickets.</p>}</div>
      <h3>Departments — tickets created in period</h3><div className="report-table"><table><thead><tr><th>Department</th><th>Created</th><th>Still outstanding</th></tr></thead><tbody>{data.departments.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.tickets}</td><td>{row.outstanding}</td></tr>)}</tbody></table>{!data.departments.length && <p>No tickets in this period.</p>}</div>
      <h3>Daily requests (UTC) — latest 30 active dates</h3><div className="daily-bars">{data.daily.slice(-30).map((row) => <div key={row.day}><span>{row.day}</span><meter min="0" max={Math.max(...data.daily.map((item) => Number(item.tickets)), 1)} value={Number(row.tickets)} aria-label={`${row.day}: ${row.tickets} tickets`} /><strong>{row.tickets}</strong></div>)}</div>
    </>}
    {canManage ? <><section className="operations-settings"><h3>Departments</h3><p>Disabling a department hides it from new routing choices; existing tickets keep their department.</p><form className="department-form" onSubmit={addDepartment}><label>New department<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label><button className="primary-button" disabled={saving}>{saving ? 'Adding…' : 'Add department'}</button></form><div className="department-list">{departments.map((department) => <div key={department.id}><span>{department.name} · {department.active ? 'Active' : 'Disabled'}</span><button className="secondary-button" onClick={() => toggleDepartment(department)}>{department.active ? 'Disable' : 'Enable'}</button></div>)}</div></section>
      <section className="operations-settings"><h3>Priority service targets</h3><p>Targets use elapsed hours, including nights/weekends. Changes apply to future tickets only. First public IT reply stops the response timer; internal notes do not. Reopening keeps the original deadlines.</p>{policies.map((policy) => <PolicyForm key={policy.priority} policy={policy} onSave={savePolicy} />)}</section>
    </> : <section className="operations-settings"><h3>Service targets (elapsed hours)</h3>{policies.map((policy) => <p key={policy.priority}>{policy.priority}: response {policy.response_hours} h · resolution {policy.resolution_hours} h</p>)}</section>}
  </section>
}
