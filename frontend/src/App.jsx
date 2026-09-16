import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [tickets, setTickets] = useState([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function loadTickets(signal) {
    const response = await fetch('/api/tickets', { signal })

    if (!response.ok) {
      throw new Error('Could not load tickets')
    }

    const data = await response.json()
    setTickets(data.tickets)
  }
  useEffect(() => {
    const controller = new AbortController()

    fetch('/api/tickets', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Could not load tickets')
        }
        return response.json()
      })
      .then((data) => setTickets(data.tickets))
      .catch((cause) => {
        if (cause.name !== 'AbortError') {
          setError(cause.message)
        }
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [])

  async function createTicket(event) {
    event.preventDefault()
    setError('')
    setSaving(true)

    try {
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, description }),
      })

      if (!response.ok) {
        throw new Error('Could not create ticket')
      }

      setTitle('')
      setDescription('')
      await loadTickets()
    } catch (cause) {
      setError(cause.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="app">
      <header className="app-header">
        <p className="eyebrow">Company Ticket Lab</p>
        <h1>Support tickets</h1>
        <p>Track internal requests in one place.</p>
      </header>

      <section className="panel" aria-labelledby="new-ticket-title">
        <h2 id="new-ticket-title">New ticket</h2>
        <form onSubmit={createTicket}>
          <label htmlFor="title">Title</label>
          <input
            id="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={3}
            maxLength={200}
            required
          />

          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={5000}
            rows={4}
          />

          <button disabled={saving} type="submit">
            {saving ? 'Creating...' : 'Create ticket'}
          </button>
        </form>
      </section>

      <section className="panel" aria-labelledby="tickets-title">
        <h2 id="tickets-title">Tickets</h2>
        {error && <p role="alert" className="error">{error}</p>}
        {loading && <p>Loading tickets...</p>}
        {!loading && tickets.length === 0 && <p>No tickets yet.</p>}

        <ul className="tickets">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <div>
                <strong>#{ticket.id} · {ticket.title}</strong>
                <p>{ticket.description || 'No description'}</p>
              </div>
              <span className="status">{ticket.status.replaceAll('_', ' ')}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

export default App
