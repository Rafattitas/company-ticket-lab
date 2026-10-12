import { useEffect, useMemo, useState } from 'react'
import './App.css'

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
  const [attachment, setAttachment] = useState(null)
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
    } catch (cause) { setError(cause.message) } finally { setSaving(false) }
  }

  function startAnotherTicket() { setCreatedTicket(null); setAttachment(null); setForm(emptyForm) }

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
              <button className="primary-button" type="button" onClick={startAnotherTicket}>Submit another request</button>
            </div>
          ) : (
            <><div className="request-heading"><p className="eyebrow">New ticket</p><h2>Describe your issue</h2><p>Fields marked with * are required.</p></div>
              {error && <div role="alert" className="alert"><strong>Could not submit ticket.</strong><span>{error}</span></div>}
              <form onSubmit={submitTicket}><div className="form-grid">
                <label>Full name *<input value={form.requester_name} onChange={(e) => updateForm('requester_name', e.target.value)} minLength={2} maxLength={120} required autoComplete="name" placeholder="Your name" /></label>
                <label>Email address *<input type="email" value={form.requester_email} onChange={(e) => updateForm('requester_email', e.target.value)} maxLength={254} required autoComplete="email" placeholder="you@company.com" /></label>
                <label>Phone number *<input type="tel" value={form.requester_phone} onChange={(e) => updateForm('requester_phone', e.target.value)} minLength={7} maxLength={32} required autoComplete="tel" placeholder="+20 100 000 0000" /></label>
                <label>Issue level *<select value={form.priority} onChange={(e) => updateForm('priority', e.target.value)}>{priorities.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label>Category<select value={form.category} onChange={(e) => updateForm('category', e.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label className="wide-field">Subject *<input value={form.title} onChange={(e) => updateForm('title', e.target.value)} minLength={3} maxLength={200} required placeholder="Short summary of the problem" /></label>
                <label className="wide-field">Description<textarea value={form.description} onChange={(e) => updateForm('description', e.target.value)} maxLength={5000} rows={6} placeholder="What happened? Include any error message and what you already tried." /></label>
                <label className="wide-field upload-field"><span>Problem image <small>Optional · JPG, PNG, or WebP · max 5 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setAttachment(e.target.files?.[0] || null)} /><span className="upload-box">{attachment ? `Selected: ${attachment.name}` : 'Choose an image or screenshot'}</span></label>
              </div><button className="primary-button submit-button" disabled={saving} type="submit">{saving ? 'Submitting…' : 'Submit support ticket'}</button></form>
            </>
          )}
        </section>
      </main>
    </div>
  )
}

function AdminDashboard() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')

  useEffect(() => {
    const controller = new AbortController()
    // oxlint-disable-next-line react/set-state-in-effect
    apiRequest('/api/tickets', { signal: controller.signal }).then((data) => setTickets(data.tickets)).catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message) }).finally(() => setLoading(false))
    return () => controller.abort()
  }, [])

  const counts = useMemo(() => ({
    all: tickets.length,
    open: tickets.filter((ticket) => ticket.status === 'open').length,
    in_progress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
    urgent: tickets.filter((ticket) => ticket.priority === 'urgent' && !['resolved', 'closed'].includes(ticket.status)).length,
  }), [tickets])

  const visibleTickets = useMemo(() => {
    const term = search.trim().toLowerCase()
    return tickets.filter((ticket) => {
      const searchable = [ticket.id, ticket.title, ticket.description, ticket.requester_name, ticket.requester_email, ticket.requester_phone, ticket.assigned_to, ticket.category].join(' ').toLowerCase()
      return (statusFilter === 'all' || ticket.status === statusFilter) && (priorityFilter === 'all' || ticket.priority === priorityFilter) && searchable.includes(term)
    })
  }, [tickets, search, statusFilter, priorityFilter])

  async function updateTicket(ticketId, endpoint, payload) {
    setError('')
    try {
      const data = await apiRequest(`/api/tickets/${ticketId}/${endpoint}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      setTickets((current) => current.map((ticket) => ticket.id === ticketId ? { ...ticket, ...data.ticket } : ticket))
    } catch (cause) { setError(cause.message) }
  }

  return (
    <div className="app-shell"><aside className="sidebar"><Brand admin /><nav aria-label="Admin navigation"><a className="nav-item active" href="#workspace">Overview</a><a className="nav-item" href="#tickets">Ticket queue</a><a className="nav-item" href="/">User portal</a></nav><div className="sidebar-note"><span className="online-dot" /> System operational</div></aside>
      <main className="workspace" id="workspace">
        <header className="topbar"><div><p className="eyebrow">IT administration</p><h1>Support workspace</h1><p className="subtitle">Review, assign, and resolve employee requests.</p></div><a className="secondary-button button-link" href="/">Open user portal</a></header>
        <section className="stats" aria-label="Ticket summary"><article><span>Total tickets</span><strong>{counts.all}</strong><small>All requests</small></article><article><span>Open</span><strong>{counts.open}</strong><small>Waiting for action</small></article><article><span>In progress</span><strong>{counts.in_progress}</strong><small>Being handled</small></article><article className={counts.urgent ? 'urgent-stat' : ''}><span>Urgent</span><strong>{counts.urgent}</strong><small>Immediate attention</small></article></section>
        {error && <div role="alert" className="alert"><strong>Could not complete the request.</strong><span>{error}</span></div>}
        <section className="ticket-panel" id="tickets" aria-labelledby="tickets-title">
          <div className="section-heading"><div><p className="eyebrow">Queue</p><h2 id="tickets-title">Support tickets</h2></div><p>{visibleTickets.length} of {tickets.length} tickets</p></div>
          <div className="filters"><label className="search-field"><span>Search</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, phone, subject…" /></label><label><span>Status</span><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All statuses</option>{statuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Priority</span><select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}><option value="all">All priorities</option>{priorities.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
          {loading && <div className="empty-state">Loading the ticket queue…</div>}{!loading && visibleTickets.length === 0 && <div className="empty-state"><strong>No tickets found</strong><span>Try changing the filters.</span></div>}
          <div className="ticket-list">{visibleTickets.map((ticket) => <article className="ticket-card" key={ticket.id}><div className={`priority-line priority-${ticket.priority}`} /><div className="ticket-main"><div className="ticket-heading"><div className="ticket-tags"><span className={`priority-badge priority-${ticket.priority}`}>{ticket.priority}</span><span className="category-badge">{ticket.category}</span></div><span className="ticket-id">#{ticket.id}</span></div><h3>{ticket.title}</h3><p className="ticket-description">{ticket.description || 'No additional description provided.'}</p>{ticket.has_attachment && <a className="attachment-link" href={`/api/tickets/${ticket.id}/attachment`} target="_blank" rel="noreferrer"><img src={`/api/tickets/${ticket.id}/attachment`} alt={`Attachment for ticket ${ticket.id}`} />View attached image</a>}<div className="requester-card"><strong>{ticket.requester_name}</strong><a href={ticket.requester_email ? `mailto:${ticket.requester_email}` : undefined}>{ticket.requester_email || 'Legacy ticket — no email'}</a><a href={ticket.requester_phone ? `tel:${ticket.requester_phone}` : undefined}>{ticket.requester_phone || 'No phone number'}</a></div><div className="ticket-meta"><span>Created {formatDate(ticket.created_at)}</span></div></div><div className="ticket-controls"><label>Status<select value={ticket.status} onChange={(e) => updateTicket(ticket.id, 'status', { status: e.target.value })}>{statuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Assignee<input key={`${ticket.id}-${ticket.assigned_to}`} defaultValue={ticket.assigned_to} placeholder="Unassigned" maxLength={120} onBlur={(e) => { if (e.target.value.trim() !== ticket.assigned_to) updateTicket(ticket.id, 'assignment', { assigned_to: e.target.value }) }} /></label></div></article>)}</div>
        </section>
      </main>
    </div>
  )
}

function App() { return window.location.pathname.startsWith('/admin') ? <AdminDashboard /> : <UserPortal /> }
export default App
