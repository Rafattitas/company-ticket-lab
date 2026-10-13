import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterQueue } from '../src/queue.mjs'
const tickets = [
  { id: 1, status: 'open', priority: 'normal', created_at: '2026-01-01', assigned_to: 'Legacy technician' },
  { id: 2, status: 'resolved', priority: 'urgent', created_at: '2026-01-02', resolution_due_at: '2026-01-01' },
  { id: 3, status: 'in_progress', priority: 'high', created_at: '2026-01-03', assigned_user_id: 8, response_due_at: '2026-01-01', first_response_at: '2026-01-01', resolution_due_at: '2026-02-01' },
  { id: 4, status: 'open', priority: 'urgent', created_at: '2026-01-04', department_name: 'Infrastructure', response_due_at: '2026-01-01' },
]
const ids = (options) => filterQueue(tickets, { now: Date.parse('2026-01-10'), ...options }).map(t => t.id)
test('shortcuts exclude resolved tickets and respect legacy assignments', () => {
  assert.deepEqual(ids({ queueView: 'unassigned' }), [4])
  assert.deepEqual(ids({ queueView: 'mine', userId: 8 }), [3])
  assert.deepEqual(ids({ queueView: 'overdue' }), [4])
})
test('filters compose with shortcuts and sort without mutating source', () => {
  assert.deepEqual(ids({ queueView: 'active', sortOrder: 'priority' }), [4, 3, 1])
  assert.deepEqual(ids({ search: 'infrastructure', priorityFilter: 'high' }), [])
  assert.deepEqual(ids({ search: 'infrastructure' }), [4])
  assert.deepEqual(tickets.map(t => t.id), [1, 2, 3, 4])
})
