import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { filterQueue } from './queue.mjs'
import { EmployeeTracking, TicketConversation } from './Conversation'
import { OperationsPanel, TicketSla } from './Operations'

const statuses = [['open', 'Open'], ['in_progress', 'In progress'], ['resolved', 'Resolved'], ['closed', 'Closed']]
const priorities = [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']]
const categories = ['General', 'Access', 'Hardware', 'Network', 'Software', 'Other']
const allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp']
const maximumImageSize = 5 * 1024 * 1024

function friendlyError(code) {
  const messages = {
    title_must_be_between_3_and_200_characters: 'Enter a subject between 3 and 200 characters.',
    requester_name_must_be_between_2_and_120_characters: 'Enter your name.',
    invalid_requester_email: 'Enter a valid email address.',
    invalid_requester_phone: 'Enter a valid phone number.',
    invalid_ticket_priority: 'Choose a valid priority.',
    invalid_attachment: 'Choose a JPG, PNG, or WebP image.',
    attachment_must_not_exceed_5mb: 'The image must be 5 MB or smaller.',
    invalid_credentials: 'The username or password is incorrect.',
    authentication_required: 'Sign in to open the IT dashboard.',
    permission_denied: 'Your account does not have permission for this action.',
    invalid_username: 'Use at least 3 lowercase letters, numbers, dots, dashes, or underscores.',
    invalid_display_name: 'Enter the team member name.',
    password_too_short: 'Passwords must contain at least 12 characters.',
    password_must_change: 'Choose a password different from the temporary password.',
    current_password_incorrect: 'The current password is incorrect.',
    password_change_required: 'Change your temporary password before using the dashboard.',
    username_already_exists: 'That username already exists.',
    last_admin_required: 'At least one active administrator must remain.',
    invalid_department: 'Choose an active department.',
    invalid_assignee: 'Choose an active IT technician.',
  }
  return messages[code] || 'Something went wrong. Please try again.'
}

async function apiRequest(path, options) {
  const response = await fetch(path, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(friendlyError(body.error))
  return body
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

async function encodeAttachment(file) {
  if (!allowedImageTypes.includes(file.type)) throw new Error(friendlyError('invalid_attachment'))
  if (file.size > maximumImageSize) throw new Error(friendlyError('attachment_must_not_exceed_5mb'))
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return { file_name: file.name, content_type: file.type, data: btoa(binary) }
}

function Brand({ admin = false }) {
  return <a className="brand" href={admin ? '/admin' : '/'}><span className="brand-mark">T</span><span><strong>TicketDesk</strong><small>{admin ? 'IT workspace' : 'Employee support'}</small></span></a>
}

function UserPortal() {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdTicket, setCreatedTicket] = useState(null)
  const [trackingToken, setTrackingToken] = useState('')
  const [attachment, setAttachment] = useState(null)
  const [departments, setDepartments] = useState([])
  useEffect(() => {
    const controller = new AbortController()
    apiRequest('/api/operations/departments', { signal: controller.signal }).then((value) => setDepartments(value.departments)).catch(() => {})
    return () => controller.abort()
  }, [])
  const emptyForm = { requester_name: '', requester_email: '', requester_phone: '', title: '', description: '', category: 'General', priority: 'normal' }
  const [form, setForm] = useState(emptyForm)

  function updateForm(field, value) { setForm((current) => ({ ...current, [field]: value })) }

  async function submitTicket(event) {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const encodedAttachment = attachment ? await encodeAttachment(attachment) : null
      const data = await apiRequest('/api/tickets', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...form, attachment: encodedAttachment }),
      })
      setCreatedTicket(data.ticket)
      setTrackingToken(data.tracking_token)
    } catch (cause) { setError(cause.message) } finally { setSaving(false) }
  }

  function startAnotherTicket() { setCreatedTicket(null); setTrackingToken(''); setAttachment(null); setForm(emptyForm) }

  return (
    <div className="portal-page">
      <header className="portal-header"><Brand /><a className="admin-link" href="/admin">IT admin dashboard →</a></header>
      <main className="portal-main">
        <section className="portal-intro">
          <p className="eyebrow">IT support</p><h1>How can we help?</h1>
          <p>Tell us what went wrong. Your request will go directly to the IT support queue.</p>
          <div className="portal-promises"><span>✓ Clear ticket reference</span><span>✓ Image attachments</span><span>✓ Priority-based handling</span></div>
        </section>
        <section className="request-card">
          {createdTicket ? (
            <div className="success-state" role="status">
              <span className="success-icon">✓</span><p className="eyebrow">Request received</p>
              <h2>Ticket #{createdTicket.id} is in the queue</h2><p>We sent your request to IT. Keep this ticket number for reference.</p>
              <div className="receipt"><strong>{createdTicket.title}</strong><span>{createdTicket.priority} priority · {createdTicket.category}</span></div>
              <div className="tracking-receipt"><p>Save your private follow-up link before leaving this page. Anyone with this link can view this ticket and reply.</p><label>Private tracking link<input readOnly value={`${window.location.origin}/track/${createdTicket.id}#${trackingToken}`} onFocus={(event) => event.target.select()} /></label><a className="primary-button" href={`/track/${createdTicket.id}#${trackingToken}`}>Follow your ticket →</a><small>Select the link above to copy it. It is shown only when the ticket is created.</small></div>
              <button className="primary-button" type="button" onClick={startAnotherTicket}>Submit another request</button>
            </div>
          ) : (
            <><div className="request-heading"><p className="eyebrow">New ticket</p><h2>Describe your issue</h2><p>Fields marked with * are required.</p></div>
              {error && <div role="alert" className="alert"><strong>Could not submit ticket.</strong><span>{error}</span></div>}
              <form onSubmit={submitTicket}><div className="form-grid">
                <label>Full name *<input value={form.requester_name} onChange={(e) => updateForm('requester_name', e.target.value)} minLength={2} maxLength={120} required autoComplete="name" placeholder="Your name" /></label>
                <label>Email address *<input type="email" value={form.requester_email} onChange={(e) => updateForm('requester_email', e.target.value)} maxLength={254} required autoComplete="email" placeholder="you@company.com" /></label>
                <label>Phone number *<input type="tel" value={form.requester_phone} onChange={(e) => updateForm('requester_phone', e.target.value)} minLength={7} maxLength={32} required autoComplete="tel" placeholder="+20 100 000 0000" /></label>
                <label>Issue level *<small className="field-hint">Normal for routine requests; urgent if work is blocked.</small><select value={form.priority} onChange={(e) => updateForm('priority', e.target.value)}>{priorities.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label>Department<select value={form.department_id || ""} onChange={(e) => updateForm('department_id', e.target.value)}><option value="">IT Support / automatic routing</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label>Category<select value={form.category} onChange={(e) => updateForm('category', e.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label className="wide-field">Subject *<input value={form.title} onChange={(e) => updateForm('title', e.target.value)} minLength={3} maxLength={200} required placeholder="Short summary of the problem" /></label>
                <label className="wide-field">Description <small className="field-hint">What happened and what did you try?</small><textarea value={form.description} onChange={(e) => updateForm('description', e.target.value)} maxLength={5000} rows={6} placeholder="What happened? Include any error message and what you already tried." /></label>
                <label className="wide-field upload-field"><span>Problem image <small>Optional · JPG, PNG, or WebP · max 5 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (file && (!allowedImageTypes.includes(file.type) || file.size > maximumImageSize)) { setError('Choose a JPG, PNG, or WebP image up to 5 MB.'); e.target.value = ''; setAttachment(null) } else { setAttachment(file || null); setError('') } }} /><span className="upload-box">{attachment ? `Selected: ${attachment.name}` : 'Choose an image or screenshot'}</span></label>
                {attachment && <button type="button" className="secondary-button wide-field" onClick={() => { setAttachment(null); const input = document.querySelector('input[type="file"]'); if (input) input.value = '' }}>Remove selected image</button>}
              </div><button className="primary-button submit-button" disabled={saving} type="submit">{saving ? 'Submitting…' : 'Submit support ticket'}</button></form>
            </>
          )}
        </section>
      </main>
    </div>
  )
}

function AdminLogin({ onLogin }) {
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function login(event) {
    event.preventDefault(); setError(''); setSaving(true)
    try {
      const data = await apiRequest('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials),
      })
      onLogin(data.user)
    } catch (cause) { setError(cause.message) } finally { setSaving(false) }
  }

  return <div className="login-page"><div className="login-card"><Brand admin /><p className="eyebrow">Protected workspace</p><h1>Sign in to IT</h1><p>Use your TicketDesk team account to manage support requests.</p>{error && <div role="alert" className="alert"><span>{error}</span></div>}<form onSubmit={login}><label>Username<input autoComplete="username" required value={credentials.username} onChange={(e) => setCredentials((value) => ({ ...value, username: e.target.value }))} /></label><label>Password<input type="password" autoComplete="current-password" required value={credentials.password} onChange={(e) => setCredentials((value) => ({ ...value, password: e.target.value }))} /></label><button className="primary-button" disabled={saving}>{saving ? 'Signing in…' : 'Sign in'}</button></form><a href="/">← Return to employee portal</a></div></div>
}

function ChangePassword({ user, onChanged, onLogout }) {
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(event) {
    event.preventDefault(); setError('')
    if (passwords.new_password !== passwords.confirm_password) {
      setError('The new passwords do not match.'); return
    }
    setSaving(true)
    try {
      const data = await apiRequest('/api/auth/change-password', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ current_password: passwords.current_password, new_password: passwords.new_password }),
      })
      onChanged(data.user)
    } catch (cause) { setError(cause.message) } finally { setSaving(false) }
  }

  return <div className="login-page"><div className="login-card"><Brand admin /><p className="eyebrow">First sign-in</p><h1>Create a new password</h1><p>Welcome, {user.display_name}. Replace your temporary password before opening the IT workspace.</p>{error && <div role="alert" className="alert"><span>{error}</span></div>}<form onSubmit={submit}><label>Temporary password<input type="password" autoComplete="current-password" required value={passwords.current_password} onChange={(e) => setPasswords((value) => ({ ...value, current_password: e.target.value }))} /></label><label>New password<input type="password" autoComplete="new-password" required minLength={12} value={passwords.new_password} onChange={(e) => setPasswords((value) => ({ ...value, new_password: e.target.value }))} /><small>Use at least 12 characters.</small></label><label>Confirm new password<input type="password" autoComplete="new-password" required minLength={12} value={passwords.confirm_password} onChange={(e) => setPasswords((value) => ({ ...value, confirm_password: e.target.value }))} /></label><button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Change password and continue'}</button></form><button className="secondary-button full-width-button" type="button" onClick={onLogout}>Sign out</button></div></div>
}

function AdminDashboard() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [showAccounts, setShowAccounts] = useState(false)
  const [showReports, setShowReports] = useState(false)
  const [departments, setDepartments] = useState([])
  const [staff, setStaff] = useState([])
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [queueRevision, setQueueRevision] = useState(0)
  const [queueView, setQueueView] = useState('all')
  const [sortOrder, setSortOrder] = useState('newest')
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState('')
  const [savingTicket, setSavingTicket] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  const [accounts, setAccounts] = useState([])
  const [accountForm, setAccountForm] = useState({ username: '', display_name: '', password: '', role: 'agent' })

  useEffect(() => {
    fetch('/api/auth/me').then(async (response) => response.ok ? (await response.json()).user : null).then(setUser).finally(() => setAuthLoading(false))
  }, [])

  useEffect(() => {
    if (!user || user.must_change_password) return undefined
    const controller = new AbortController()
    Promise.all([apiRequest('/api/operations/departments', { signal: controller.signal }), apiRequest('/api/operations/staff', { signal: controller.signal })]).then(([teams, people]) => { setDepartments(teams.departments); setStaff(people.staff) }).catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message) })
    // oxlint-disable-next-line react/set-state-in-effect
    apiRequest('/api/tickets', { signal: controller.signal }).then((data) => setTickets(data.tickets)).catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message) }).finally(() => setLoading(false))
    return () => controller.abort()
  }, [user, showAccounts, showReports, queueRevision])

  const counts = useMemo(() => ({
    all: tickets.length,
    open: tickets.filter((ticket) => ticket.status === 'open').length,
    in_progress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
    urgent: tickets.filter((ticket) => ticket.priority === 'urgent' && !['resolved', 'closed'].includes(ticket.status)).length,
  }), [tickets])

  const visibleTickets = useMemo(() => filterQueue(tickets, { search, statusFilter, priorityFilter, departmentFilter, assigneeFilter, queueView, sortOrder, userId: user?.id, now }), [tickets, search, statusFilter, priorityFilter, departmentFilter, assigneeFilter, queueView, sortOrder, user?.id, now])
  const pageCount = Math.max(1, Math.ceil(visibleTickets.length / 10))
  const currentPage = Math.min(page, pageCount)
  const pageTickets = visibleTickets.slice((currentPage - 1) * 10, currentPage * 10)
  function resetFilters() {
    setSearch(''); setStatusFilter('all'); setPriorityFilter('all'); setDepartmentFilter('all'); setAssigneeFilter('all'); setQueueView('all'); setPage(1)
  }
  function changeFilter(setter, value) { setter(value); setPage(1) }

  async function updateTicket(ticketId, endpoint, payload) {
    setError(''); setNotice(''); setSavingTicket(ticketId)
    try {
      const data = await apiRequest(`/api/tickets/${ticketId}/${endpoint}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      setTickets((current) => current.map((ticket) => ticket.id === ticketId ? { ...ticket, ...data.ticket } : ticket))
      setNotice(`Ticket #${ticketId} updated.`)
    } catch (cause) { setError(cause.message) } finally { setSavingTicket(null) }
  }

  async function openAccounts() {
    setError(''); setShowAccounts(true); setShowReports(false)
    try { setAccounts((await apiRequest('/api/auth/accounts')).accounts) } catch (cause) { setError(cause.message) }
  }

  async function createAccount(event) {
    event.preventDefault(); setError('')
    try {
      const data = await apiRequest('/api/auth/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(accountForm) })
      setAccounts((current) => [...current, data.account].sort((a, b) => a.username.localeCompare(b.username)))
      setAccountForm({ username: '', display_name: '', password: '', role: 'agent' })
    } catch (cause) { setError(cause.message) }
  }

  async function updateAccount(account, changes) {
    setError('')
    try {
      const data = await apiRequest(`/api/auth/accounts/${account.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changes) })
      setAccounts((current) => current.map((item) => item.id === account.id ? data.account : item))
    } catch (cause) { setError(cause.message) }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null); setTickets([])
  }

  if (authLoading) return <div className="login-page"><div className="login-card">Checking your session…</div></div>
  if (!user) return <AdminLogin onLogin={setUser} />
  if (user.must_change_password) return <ChangePassword user={user} onChanged={setUser} onLogout={logout} />
  const canUpdate = user.permissions.includes('tickets:update')
  const canManageAccounts = user.permissions.includes('accounts:manage')

  return (
    <div className="app-shell"><a className="skip-link" href="#workspace">Skip to workspace</a><aside className="sidebar"><Brand admin /><nav aria-label="Admin navigation"><a className={`nav-item ${!showAccounts && !showReports ? 'active' : ''}`} href="#workspace" onClick={() => { setShowAccounts(false); setShowReports(false) }}>Ticket workspace</a>{canManageAccounts && <button className={`nav-item nav-button ${showAccounts ? 'active' : ''}`} onClick={openAccounts}>Team accounts</button>}<button className={`nav-item nav-button ${showReports ? 'active' : ''}`} onClick={() => { setShowReports(true); setShowAccounts(false) }}>Reports &amp; targets</button><a className="nav-item" href="/">User portal</a></nav><div className="sidebar-note"><span className="online-dot" /> Signed in as {user.username}</div></aside>
      <main className="workspace" id="workspace">
        <header className="topbar"><div><p className="eyebrow">IT administration · {user.role}</p><h1>{showAccounts ? 'Team accounts' : showReports ? 'Reports & targets' : 'Support workspace'}</h1><p className="subtitle">{showAccounts ? 'Create accounts and control access levels.' : showReports ? 'Monitor workload and configure service targets.' : 'Review, assign, and resolve employee requests.'}</p></div><div className="account-actions"><span>{user.display_name}</span><button className="secondary-button" onClick={logout}>Sign out</button></div></header>
        {error && (showAccounts || showReports) && <div role="alert" className="alert">{error}</div>}
        {showAccounts && <section className="accounts-panel"><div className="section-heading"><div><p className="eyebrow">Access control</p><h2>IT team members</h2></div><p>Admin manages users · Agent updates tickets · Viewer reads only</p></div><form className="account-form" onSubmit={createAccount}><label>Username<input required minLength={3} maxLength={64} value={accountForm.username} onChange={(e) => setAccountForm((value) => ({ ...value, username: e.target.value }))} placeholder="first.last" /></label><label>Display name<input required minLength={2} maxLength={120} value={accountForm.display_name} onChange={(e) => setAccountForm((value) => ({ ...value, display_name: e.target.value }))} /></label><label>Temporary password<input required type="password" minLength={12} value={accountForm.password} onChange={(e) => setAccountForm((value) => ({ ...value, password: e.target.value }))} /></label><label>Role<select value={accountForm.role} onChange={(e) => setAccountForm((value) => ({ ...value, role: e.target.value }))}><option value="agent">Agent</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label><button className="primary-button">Add account</button></form><div className="account-list">{accounts.map((account) => <article key={account.id}><div><strong>{account.display_name}</strong><span>@{account.username}</span></div><select aria-label={`Role for ${account.username}`} value={account.role} disabled={Number(account.id) === Number(user.id)} onChange={(e) => updateAccount(account, { role: e.target.value })}><option value="admin">Admin</option><option value="agent">Agent</option><option value="viewer">Viewer</option></select><button className="secondary-button" disabled={Number(account.id) === Number(user.id)} onClick={() => updateAccount(account, { active: !account.active })}>{account.active ? 'Disable' : 'Enable'}</button></article>)}</div></section>}
        {showReports && <OperationsPanel canManage={canManageAccounts} />}{!showAccounts && !showReports && <>
        <section className="stats" aria-label="Ticket summary"><article><span>Loaded tickets</span><strong>{counts.all}</strong><small>Latest queue page · up to 200</small></article><article><span>Open</span><strong>{counts.open}</strong><small>Waiting for action</small></article><article><span>In progress</span><strong>{counts.in_progress}</strong><small>Being handled</small></article><article className={counts.urgent ? 'urgent-stat' : ''}><span>Urgent</span><strong>{counts.urgent}</strong><small>Immediate attention</small></article></section>
        {error && <div role="alert" className="alert"><strong>Could not complete the request.</strong><span>{error}</span></div>}
        {notice && <p role="status" className="success-notice">{notice}</p>}
        <section className="ticket-panel" id="tickets" aria-labelledby="tickets-title">
          <div className="section-heading"><div><p className="eyebrow">Queue</p><h2 id="tickets-title">Support tickets</h2></div><div><p>{visibleTickets.length} of {tickets.length} loaded tickets (up to 200)</p><button className="secondary-button" disabled={loading} onClick={() => { setLoading(true); setError(''); setQueueRevision((value) => value + 1) }}>Refresh queue</button></div></div>
          <div className="queue-tabs" aria-label="Quick queue filters">{[['all', 'All tickets'], ['active', 'Needs action'], ['mine', 'Assigned to me'], ['unassigned', 'Unassigned'], ['overdue', 'SLA overdue']].map(([value, label]) => <button key={value} className={queueView === value ? 'selected' : ''} aria-pressed={queueView === value} onClick={() => changeFilter(setQueueView, value)}>{label}</button>)}</div>
          <div className="filters"><label className="search-field"><span>Search</span><input type="search" value={search} onChange={(e) => changeFilter(setSearch, e.target.value)} placeholder="Name, email, phone, subject…" /></label><label><span>Status</span><select value={statusFilter} onChange={(e) => changeFilter(setStatusFilter, e.target.value)}><option value="all">All statuses</option>{statuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Priority</span><select value={priorityFilter} onChange={(e) => changeFilter(setPriorityFilter, e.target.value)}><option value="all">All priorities</option>{priorities.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Department<select value={departmentFilter} onChange={(e) => changeFilter(setDepartmentFilter, e.target.value)}><option value="all">All departments</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label>Technician<select value={assigneeFilter} onChange={(e) => changeFilter(setAssigneeFilter, e.target.value)}><option value="all">All technicians</option><option value="">Unlinked / unassigned</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select></label></div>
          <div className="queue-toolbar"><span role="status">{visibleTickets.length} matching tickets · page {currentPage} of {pageCount}</span><label>Sort by<select value={sortOrder} onChange={(e) => changeFilter(setSortOrder, e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="priority">Highest priority</option><option value="deadline">Resolution due first</option></select></label><button className="secondary-button" onClick={resetFilters}>Clear filters</button></div>
          {loading && <div className="empty-state">Loading the ticket queue…</div>}{!loading && visibleTickets.length === 0 && <div className="empty-state"><strong>No tickets found</strong><span>{tickets.length ? 'Try another search or clear your filters.' : 'Employee requests will appear here once submitted.'}</span><button className="secondary-button" onClick={resetFilters}>Show all tickets</button></div>}
          <div className="ticket-list">{pageTickets.map((ticket) => <article className="ticket-card" key={ticket.id}><div className={`priority-line priority-${ticket.priority}`} /><div className="ticket-main"><div className="ticket-heading"><div className="ticket-tags"><span className={`priority-badge priority-${ticket.priority}`}>{ticket.priority}</span><span className="category-badge">{ticket.category}</span></div><span className="ticket-id">#{ticket.id}</span></div><div className="ticket-title-row"><h3>{ticket.title}</h3><span className={`status-badge status-${ticket.status}`}>{statuses.find(([value]) => value === ticket.status)?.[1]}</span></div><p className="ticket-description">{ticket.description || 'No additional description provided.'}</p>{ticket.has_attachment && <a className="attachment-link" href={`/api/tickets/${ticket.id}/attachment`} target="_blank" rel="noreferrer"><img src={`/api/tickets/${ticket.id}/attachment`} alt={`Attachment for ticket ${ticket.id}`} />View attached image</a>}<div className="requester-card"><strong>{ticket.requester_name}</strong><a href={ticket.requester_email ? `mailto:${ticket.requester_email}` : undefined}>{ticket.requester_email || 'Legacy ticket — no email'}</a><a href={ticket.requester_phone ? `tel:${ticket.requester_phone}` : undefined}>{ticket.requester_phone || 'No phone number'}</a></div><div className="ticket-meta"><span>Created {formatDate(ticket.created_at)}</span></div><TicketSla ticket={ticket} now={now} /></div><div className="ticket-controls"><label>Status<select disabled={!canUpdate || savingTicket === ticket.id} value={ticket.status} onChange={(e) => updateTicket(ticket.id, 'status', { status: e.target.value })}>{statuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Department<select disabled={!canUpdate || savingTicket === ticket.id} value={ticket.department_id || ""} onChange={(e) => updateTicket(ticket.id, 'department', { department_id: e.target.value })}><option value="" disabled>Unspecified</option>{ticket.department_id && !departments.some((d) => String(d.id) === String(ticket.department_id)) && <option value={ticket.department_id}>{ticket.department_name} (disabled)</option>}{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label>Technician<select disabled={!canUpdate || savingTicket === ticket.id} value={ticket.assigned_user_id || ""} onChange={(e) => updateTicket(ticket.id, 'assignment', { assignee_id: e.target.value || null })}><option value="">{ticket.assigned_to && !ticket.assigned_user_id ? `Legacy: ${ticket.assigned_to}` : 'Unassigned'}</option>{ticket.assigned_user_id && !staff.some((person) => String(person.id) === String(ticket.assigned_user_id)) && <option value={ticket.assigned_user_id}>{ticket.assigned_to} (unavailable)</option>}{staff.map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select></label></div><TicketConversation ticketId={ticket.id} canUpdate={canUpdate} updatedAt={ticket.updated_at} /></article>)}</div>
          {pageCount > 1 && <nav className="pagination" aria-label="Ticket pages"><button className="secondary-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pageCount}</span><button className="secondary-button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
        </section>
        </>}
      </main>
    </div>
  )
}

function App() { return window.location.pathname.startsWith('/admin') ? <AdminDashboard /> : window.location.pathname.startsWith('/track/') ? <EmployeeTracking /> : <UserPortal /> }
export default App
