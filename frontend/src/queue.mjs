// Queue shortcuts operate on the loaded page, never on report totals.
export function filterQueue(tickets, options) {
  const { search = '', statusFilter = 'all', priorityFilter = 'all', departmentFilter = 'all', assigneeFilter = 'all', queueView = 'all', sortOrder = 'newest', userId, now = Date.now() } = options
  const active = (ticket) => !['resolved', 'closed'].includes(ticket.status)
  const overdue = (ticket) => active(ticket) && ((ticket.resolution_due_at && Date.parse(ticket.resolution_due_at) < now) || (!ticket.first_response_at && ticket.response_due_at && Date.parse(ticket.response_due_at) < now))
  const term = search.trim().toLowerCase()
  const result = tickets.filter((ticket) => {
    const text = [ticket.id, ticket.title, ticket.description, ticket.requester_name, ticket.requester_email, ticket.requester_phone, ticket.assigned_to, ticket.category, ticket.department_name].join(' ').toLowerCase()
    const view = queueView === 'all' || (queueView === 'active' && active(ticket)) || (queueView === 'mine' && active(ticket) && String(ticket.assigned_user_id) === String(userId)) || (queueView === 'unassigned' && active(ticket) && !ticket.assigned_user_id && !ticket.assigned_to) || (queueView === 'overdue' && overdue(ticket))
    return view && text.includes(term) && (statusFilter === 'all' || ticket.status === statusFilter) && (priorityFilter === 'all' || ticket.priority === priorityFilter) && (departmentFilter === 'all' || String(ticket.department_id) === departmentFilter) && (assigneeFilter === 'all' || String(ticket.assigned_user_id || '') === assigneeFilter)
  })
  const ranks = { urgent: 0, high: 1, normal: 2, low: 3 }
  return result.sort((a, b) => {
    if (sortOrder === 'priority') return ranks[a.priority] - ranks[b.priority] || Date.parse(a.created_at) - Date.parse(b.created_at)
    if (sortOrder === 'deadline') return (a.resolution_due_at ? Date.parse(a.resolution_due_at) : Infinity) - (b.resolution_due_at ? Date.parse(b.resolution_due_at) : Infinity) || Date.parse(a.created_at) - Date.parse(b.created_at)
    return sortOrder === 'oldest' ? Date.parse(a.created_at) - Date.parse(b.created_at) : Date.parse(b.created_at) - Date.parse(a.created_at)
  })
}
