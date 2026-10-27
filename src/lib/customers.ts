import { retainAlternatives } from './contactConsolidation'
import type { ContactRecord, CustomerProfile, PeopleStore } from '../types'

export const CUSTOMER_STATUSES = ['Lead', 'Customer', 'Inactive'] as const
export const DUE_FILTERS = ['All dates', 'Overdue', 'Due today', 'Upcoming', 'No due date'] as const
export type DueFilter = typeof DUE_FILTERS[number]
export interface CustomerFilters {
  query?: string
  status?: CustomerProfile['status'] | 'All statuses'
  due?: DueFilter
  today?: string
}

/** Calendar dates, not timestamps: reject rollover dates such as February 30. */
export function isCalendarDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

export function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function validatePatch(patch: Record<string, unknown>): Partial<CustomerProfile> {
  const keys = ['status', 'notes', 'nextAction', 'dueDate']
  if (Object.keys(patch).some(key => !keys.includes(key))) throw new Error('Unknown customer field.')
  if (!Object.keys(patch).length) throw new Error('Supply at least one customer field.')
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'string') throw new Error(`${key} must be text.`)
  }
  if ('status' in patch && !CUSTOMER_STATUSES.includes(patch.status as CustomerProfile['status'])) {
    throw new Error('Status must be Lead, Customer or Inactive.')
  }
  if ('dueDate' in patch && patch.dueDate !== '' && !isCalendarDate(patch.dueDate as string)) {
    throw new Error('Due date must be a real YYYY-MM-DD date, or empty to clear.')
  }
  return patch as Partial<CustomerProfile>
}

/** Never creates an identity. Resolve the exact stable contact ID inside the update queue. */
export function saveCustomer(
  store: PeopleStore, contactId: string, patch: Record<string, unknown>, mode: 'create' | 'update',
  now = new Date().toISOString(),
): PeopleStore {
  const fields = validatePatch(patch)
  const contact = store.contacts.find(person => person.id === contactId)
  if (!contact) throw new Error('Unknown contact ID. Use listContacts; create new people with upsertContact first.')
  if (mode === 'create' && contact.customer) throw new Error('Customer profile already exists. Use updateCustomer.')
  if (mode === 'update' && !contact.customer) throw new Error('No customer profile. Use createCustomer with an explicit status.')
  if (!contact.customer && !fields.status) throw new Error('Choose Lead, Customer or Inactive to start tracking this contact.')
  const customer = { ...contact.customer, ...fields } as CustomerProfile
  const next = { ...contact, customer, updatedAt: now }
  if (contact.alternatives) next.alternatives = retainAlternatives(next, contact)
  return { ...store, updatedAt: now, contacts: store.contacts.map(person => person.id === contactId ? next : person) }
}

/** Shared by the customer view and listCustomers. Undated records only match All/No due date. */
export function listCustomers(store: PeopleStore, filters: CustomerFilters = {}): ContactRecord[] {
  const { query = '', status = 'All statuses', due = 'All dates', today = localToday() } = filters
  if (typeof query !== 'string') throw new Error('Query must be text.')
  if (status !== 'All statuses' && !CUSTOMER_STATUSES.includes(status)) throw new Error('Invalid status filter.')
  if (!DUE_FILTERS.includes(due)) throw new Error('Invalid due-date filter.')
  if (!isCalendarDate(today)) throw new Error('Today must be a real YYYY-MM-DD date.')
  const needle = query.trim().toLowerCase()
  return store.contacts.filter(person => {
    const profile = person.customer
    if (!profile || (status !== 'All statuses' && profile.status !== status)) return false
    const date = profile.dueDate
    if (due === 'No due date' && date) return false
    if (due === 'Overdue' && (!date || date >= today)) return false
    if (due === 'Due today' && date !== today) return false
    if (due === 'Upcoming' && (!date || date <= today)) return false
    return [person.name, ...person.emails, person.org, person.title, ...(person.tags ?? []), profile.notes, profile.nextAction]
      .filter(Boolean).join('\n').toLowerCase().includes(needle)
  }).sort((a, b) => (a.customer!.dueDate || '9999-99-99').localeCompare(b.customer!.dueDate || '9999-99-99')
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
