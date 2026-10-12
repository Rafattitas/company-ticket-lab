import { useEffect, useMemo, useState } from 'react'
import './App.css'

const statuses = [
  ['open', 'Open'],
  ['in_progress', 'In progress'],
  ['resolved', 'Resolved'],
  ['closed', 'Closed'],
]

const priorities = [
  ['low', 'Low'],
  ['normal', 'Normal'],
  ['high', 'High'],
  ['urgent', 'Urgent'],
]

const categories = ['General', 'Access', 'Hardware', 'Network', 'Software', 'Other']

function friendlyError(code) {
  const messages = {
    title_must_be_between_3_and_200_characters: 'Enter a title between 3 and 200 characters.',
    requester_name_must_be_between_2_and_120_characters: 'Enter the requester name.',
    invalid_ticket_priority: 'Choose a valid priority.',
  }

  return messages[code] || 'Something went wrong. Please try again.'
}

async function apiRequest(path, options) {
  const response = await fetch(path, options)
  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(friendlyError(body.error))
  }

  return body
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function App() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [form, setForm] = useState({
    title: '',
    description: '',
    requester_name: '',
    category: 'General',
    priority: 'normal',
  })

  async function loadTickets(signal) {
    const data = await apiRequest('/api/tickets', { signal })
    setTickets(data.tickets)
  }

  useEffect(() => {
    const controller = new AbortController()

    // The initial request intentionally synchronizes remote ticket state.
    // oxlint-disable-next-line react/set-state-in-effect
    loadTickets(controller.signal)
      .catch((cause) => {
        if (cause.name !== 'AbortError') setError(cause.message)
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [])

  const counts = useMemo(() => ({
    all: tickets.length,
    open: tickets.filter((ticket) => ticket.status === 'open').length,
    in_progress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
    urgent: tickets.filter(
      (ticket) => ticket.priority === 'urgent' && !['resolved', 'closed'].includes(ticket.status),
    ).length,
  }), [tickets])

  const visibleTickets = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return tickets.filter((ticket) => {
      const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter
      const matchesPriority = priorityFilter === 'all' || ticket.priority === priorityFilter
      const searchable = [
        ticket.id,
        ticket.title,
        ticket.description,
        ticket.requester_name,
        ticket.assigned_to,
        ticket.category,
      ].join(' ').toLowerCase()

      return matchesStatus && matchesPriority && searchable.includes(normalizedSearch)
    })
  }, [tickets, search, statusFilter, priorityFilter])

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function createTicket(event) {
    event.preventDefault()
    setError('')
    setSaving(true)

    try {
      const data = await apiRequest('/api/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })

      setTickets((current) => [data.ticket, ...current])
      setForm({
        title: '',
        description: '',
        requester_name: '',
        category: 'General',
        priority: 'normal',
      })
      setShowForm(false)
    } catch (cause) {
      setError(cause.message)
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(ticketId, status) {
    setError('')

    try {
      const data = await apiRequest(`/api/tickets/${ticketId}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setTickets((current) => current.map(
        (ticket) => ticket.id === ticketId ? data.ticket : ticket,
      ))
    } catch (cause) {
      setError(cause.message)
    }
  }

  async function assignTicket(ticketId, assignedTo) {
    setError('')

    try {
      const data = await apiRequest(`/api/tickets/${ticketId}/assignment`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assigned_to: assignedTo }),
      })
      setTickets((current) => current.map(
        (ticket) => ticket.id === ticketId ? data.ticket : ticket,
      ))
    } catch (cause) {
      setError(cause.message)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">T</span>
          <div><strong>TicketDesk</strong><small>Support workspace</small></div>
        </div>
        <nav aria-label="Main navigation">
          <a className="nav-item active" href="#workspace">Overview</a>
          <a className="nav-item" href="#tickets">All tickets</a>
          <a className="nav-item" href="#new-ticket" onClick={() => setShowForm(true)}>New request</a>
        </nav>
        <div className="sidebar-note">
          <span className="online-dot" /> System operational
        </div>
      </aside>

      <main className="workspace" id="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Support operations</p>
            <h1>Ticket workspace</h1>
            <p className="subtitle">Review, prioritize, and resolve every request from one place.</p>
          </div>
          <button className="primary-button" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Close form' : '+ New ticket'}
          </button>
        </header>

        <section className="stats" aria-label="Ticket summary">
          <article><span>Total tickets</span><strong>{counts.all}</strong><small>All recorded requests</small></article>
          <article><span>Open</span><strong>{counts.open}</strong><small>Waiting for action</small></article>
          <article><span>In progress</span><strong>{counts.in_progress}</strong><small>Currently being handled</small></article>
          <article className={counts.urgent ? 'urgent-stat' : ''}><span>Urgent</span><strong>{counts.urgent}</strong><small>Needs immediate attention</small></article>
        </section>

        {error && <div role="alert" className="alert"><strong>Could not complete the request.</strong><span>{error}</span></div>}

        {showForm && (
          <section className="create-panel" id="new-ticket" aria-labelledby="new-ticket-title">
            <div className="section-heading">
              <div><p className="eyebrow">New request</p><h2 id="new-ticket-title">Create a support ticket</h2></div>
              <p>Give the support team enough context to take action.</p>
            </div>
            <form onSubmit={createTicket}>
              <div className="form-grid">
                <label>Requester name<input value={form.requester_name} onChange={(event) => updateForm('requester_name', event.target.value)} minLength={2} maxLength={120} required placeholder="Your name" /></label>
                <label>Category<select value={form.category} onChange={(event) => updateForm('category', event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label className="wide-field">Title<input value={form.title} onChange={(event) => updateForm('title', event.target.value)} minLength={3} maxLength={200} required placeholder="A short summary of the issue" /></label>
                <label>Priority<select value={form.priority} onChange={(event) => updateForm('priority', event.target.value)}>{priorities.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label className="wide-field">Description<textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} maxLength={5000} rows={5} placeholder="What happened, what did you expect, and what have you tried?" /></label>
              </div>
              <div className="form-actions"><button className="primary-button" disabled={saving} type="submit">{saving ? 'Creating…' : 'Create ticket'}</button><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancel</button></div>
            </form>
          </section>
        )}

        <section className="ticket-panel" id="tickets" aria-labelledby="tickets-title">
          <div className="section-heading">
            <div><p className="eyebrow">Queue</p><h2 id="tickets-title">Support tickets</h2></div>
            <p>{visibleTickets.length} of {tickets.length} tickets</p>
          </div>

          <div className="filters">
            <label className="search-field"><span>Search</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search title, requester, assignee…" /></label>
            <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{statuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label><span>Priority</span><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">All priorities</option>{priorities.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          </div>

          {loading && <div className="empty-state">Loading the ticket queue…</div>}
          {!loading && visibleTickets.length === 0 && <div className="empty-state"><strong>No tickets found</strong><span>Try changing the filters or create a new request.</span></div>}

          <div className="ticket-list">
            {visibleTickets.map((ticket) => (
              <article className="ticket-card" key={ticket.id}>
                <div className={`priority-line priority-${ticket.priority}`} />
                <div className="ticket-main">
                  <div className="ticket-heading">
                    <div className="ticket-tags"><span className={`priority-badge priority-${ticket.priority}`}>{ticket.priority}</span><span className="category-badge">{ticket.category}</span></div>
                    <span className="ticket-id">#{ticket.id}</span>
                  </div>
                  <h3>{ticket.title}</h3>
                  <p className="ticket-description">{ticket.description || 'No additional description provided.'}</p>
                  <div className="ticket-meta"><span>Requested by <strong>{ticket.requester_name}</strong></span><span>{formatDate(ticket.created_at)}</span></div>
                </div>
                <div className="ticket-controls">
                  <label>Status<select value={ticket.status} onChange={(event) => updateStatus(ticket.id, event.target.value)}>{statuses.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                  <label>Assignee<input key={`${ticket.id}-${ticket.assigned_to}`} defaultValue={ticket.assigned_to} placeholder="Unassigned" maxLength={120} onBlur={(event) => { if (event.target.value.trim() !== ticket.assigned_to) assignTicket(ticket.id, event.target.value) }} /></label>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
