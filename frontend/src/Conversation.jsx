import { useEffect, useState } from 'react'

const statusNames = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' }

function date(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

async function request(path, options) {
  const response = await fetch(path, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = data.error === 'tracking_not_found'
      ? 'This tracking link is invalid or the ticket is unavailable. Check the full link you saved.'
      : data.error === 'comment_must_be_between_1_and_5000_characters'
        ? 'Enter a message between 1 and 5,000 characters.'
        : response.status === 401 || response.status === 403
          ? 'Your session or permissions have changed. Sign in again to continue.'
          : 'Could not load or save the conversation. Please try again.'
    throw new Error(message)
  }
  return data
}

function Timeline({ comments = [], events = [] }) {
  const items = [
    ...comments.map((item) => ({ ...item, type: 'comment' })),
    ...events.map((item) => ({ ...item, type: 'event' })),
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || Number(a.id) - Number(b.id))

  return <div className="conversation-timeline" aria-label="Ticket activity">
    {items.length === 0 && <p className="conversation-empty">No activity yet.</p>}
    {items.map((item) => item.type === 'comment'
      ? <article className={`message ${item.internal ? 'message-internal' : ''}`} key={`comment-${item.id}`}>
        <header><strong>{item.author_name}</strong><span>{item.internal ? 'Internal note · IT only' : item.author_kind === 'staff' ? 'IT reply' : 'Employee reply'}</span></header>
        <p>{item.body}</p><time dateTime={item.created_at}>{date(item.created_at)}</time>
      </article>
      : <div className="activity-event" key={`event-${item.id}`}>
        <span>{item.kind === 'created' ? 'Ticket created'
          : item.kind === 'status_changed' ? `Status: ${statusNames[item.old_value] || item.old_value} → ${statusNames[item.new_value] || item.new_value}`
            : `Assignee: ${item.old_value || 'Unassigned'} → ${item.new_value || 'Unassigned'}`}
          {item.actor_name && ` · ${item.actor_name}`}</span><time dateTime={item.created_at}>{date(item.created_at)}</time>
      </div>)}
    <p className="conversation-limit">Showing up to the latest 100 messages and 100 changes.</p>
  </div>
}

function CommentForm({ onSubmit, staff = false }) {
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (saving) return
    setSaving(true); setError(''); setSent(false)
    try { await onSubmit(body.trim(), internal); setBody(''); setSent(true) }
    catch (cause) { setError(cause.message) }
    finally { setSaving(false) }
  }

  return <form className="comment-form" onSubmit={submit}>
    {staff && <label>Message visibility<select disabled={saving} value={internal ? 'internal' : 'public'} onChange={(event) => setInternal(event.target.value === 'internal')}><option value="public">Reply to employee</option><option value="internal">Internal note — IT only</option></select></label>}
    <label>{internal ? 'Internal note' : 'Reply'}<textarea required maxLength={5000} rows={4} disabled={saving} value={body} onChange={(event) => { setBody(event.target.value); setSent(false) }} placeholder={internal ? 'Only IT staff can read this note.' : 'Add a question, an update, or more details.'} /></label>
    {error && <p className="alert" role="alert">{error}</p>}
    {sent && <p role="status">Message sent.</p>}
    <button className="primary-button" disabled={saving || !body.trim()}>{saving ? 'Sending…' : internal ? 'Save internal note' : 'Send reply'}</button>
  </form>
}

export function TicketConversation({ ticketId, canUpdate, updatedAt }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    request(`/api/tickets/${ticketId}/conversation`, { signal: controller.signal })
      .then((value) => { setData(value); setError('') })
      .catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message) })
    return () => controller.abort()
  }, [open, ticketId, updatedAt, revision])

  async function send(body, internal) {
    const saved = await request(`/api/tickets/${ticketId}/comments`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body, internal }),
    })
    setData((current) => ({ ...current, comments: [...(current?.comments || []), saved.comment].slice(-100) }))
  }

  return <section className="ticket-conversation">
    <button type="button" className="secondary-button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide conversation' : 'Conversation & history'}</button>
    {open && <div className="conversation-content"><div className="conversation-heading"><h4>Conversation & history</h4><button type="button" className="secondary-button" onClick={() => setRevision((value) => value + 1)}>Refresh</button></div>
      {error && <p role="alert" className="alert">{error}</p>}
      {!data && !error && <p role="status">Loading conversation…</p>}
      {data && <><Timeline {...data} />{canUpdate ? <CommentForm onSubmit={send} staff /> : <p>You have read-only access.</p>}</>}
    </div>}
  </section>
}

export function EmployeeTracking() {
  const [link] = useState(() => ({ id: window.location.pathname.split('/')[2], token: window.location.hash.slice(1) }))
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [image, setImage] = useState('')
  const valid = /^[1-9][0-9]*$/.test(link.id || '') && /^[a-f0-9]{64}$/.test(link.token)
  const path = `/api/tracking/${link.id}`

  useEffect(() => {
    if (!valid) return undefined
    const controller = new AbortController()
    request(path, { headers: { 'X-Ticket-Token': link.token }, signal: controller.signal })
      .then((value) => { setData(value); setError('') })
      .catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message) })
    return () => controller.abort()
  }, [valid, path, link.token, revision])

  useEffect(() => {
    if (!data?.ticket.has_attachment) return undefined
    const controller = new AbortController()
    let objectUrl
    fetch(`${path}/attachment`, { headers: { 'X-Ticket-Token': link.token }, signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load the attached image.')
        const blob = await response.blob()
        if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setImage(objectUrl) }
      }).catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [data?.ticket.has_attachment, path, link.token])

  async function send(body) {
    const saved = await request(`${path}/comments`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Ticket-Token': link.token }, body: JSON.stringify({ body }),
    })
    setData((current) => ({ ...current, comments: [...current.comments, saved.comment].slice(-100) }))
  }

  return <div className="portal-page"><header className="portal-header"><a className="brand" href="/"><span className="brand-mark">T</span><span><strong>TicketDesk</strong><small>Request follow-up</small></span></a><a href="/">New request</a></header>
    <main className="tracking-main"><section className="request-card"><p className="eyebrow">Your support request</p><h1>Ticket follow-up</h1>
      <p>Keep this private link safe. Anyone with it can read this request and send replies.</p>
      {!valid && <p className="alert" role="alert">Open the complete tracking link saved when you submitted your ticket.</p>}
      {error && <p className="alert" role="alert">{error}</p>}
      {valid && <button className="secondary-button" type="button" onClick={() => setRevision((value) => value + 1)}>Refresh updates</button>}
      {valid && !data && !error && <p role="status">Loading your request…</p>}
      {data && <><div className="tracking-summary"><span className="ticket-id">#{data.ticket.id}</span><span className={`priority-badge priority-${data.ticket.priority}`}>{data.ticket.priority}</span><strong>{statusNames[data.ticket.status]}</strong><h2>{data.ticket.title}</h2><p>{data.ticket.description || 'No description provided.'}</p><small>Created {date(data.ticket.created_at)}</small>{image && <a className="attachment-link" href={image} target="_blank" rel="noreferrer"><img src={image} alt="Your problem attachment" />View attached image</a>}</div><h2>Conversation & updates</h2><Timeline {...data} /><CommentForm onSubmit={send} /></>}
    </section></main>
  </div>
}
