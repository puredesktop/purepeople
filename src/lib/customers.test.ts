import { describe, expect, it } from 'vitest'
import { emptyPeopleStore, normalizePeopleStore, upsertContact } from './contactsModel'
import { listCustomers, saveCustomer } from './customers'

const seed = () => ['a', 'b', 'c', 'legacy'].reduce((store, name) => upsertContact(store, { email: `${name}@example.org`, name, org: 'Example' }, 'user').store, emptyPeopleStore())
const ids = (store: ReturnType<typeof seed>, filters = {}) => listCustomers(store, filters).map(person => person.id)

describe('customer profiles on existing contact IDs', () => {
  it('opts in without another identity and persists all fields through every status', () => {
    let store = seed()
    const before = structuredClone(store)
    for (const status of ['Lead', 'Customer', 'Inactive']) {
      store = saveCustomer(store, 'a@example.org', { status, notes: `Notes ${status}`, nextAction: `Call ${status}`, dueDate: '2028-02-29' }, status === 'Lead' ? 'create' : 'update')
      store = normalizePeopleStore(JSON.parse(JSON.stringify(store)))
      expect(store.contacts).toHaveLength(before.contacts.length)
      expect(store.contacts[0]).toMatchObject({ id: 'a@example.org', emails: ['a@example.org'], customer: { status, notes: `Notes ${status}`, nextAction: `Call ${status}`, dueDate: '2028-02-29' } })
      expect(store.contacts.slice(1)).toEqual(before.contacts.slice(1))
    }
    store = saveCustomer(store, 'a@example.org', { dueDate: '', nextAction: '', notes: '' }, 'update')
    expect(store.contacts[0].customer).toEqual({ status: 'Inactive', notes: '', nextAction: '', dueDate: '' })
  })

  it('searches and filters current values including undated customers', () => {
    let store = seed()
    store = saveCustomer(store, 'a@example.org', { status: 'Lead', notes: 'Pilot', dueDate: '2026-10-24' }, 'create')
    store = saveCustomer(store, 'b@example.org', { status: 'Customer', nextAction: 'Renew', dueDate: '2026-10-25' }, 'create')
    store = saveCustomer(store, 'c@example.org', { status: 'Inactive' }, 'create')
    const today = '2026-10-25'
    expect(ids(store, { query: 'pilot' })).toEqual(['a@example.org'])
    expect(ids(store, { query: 'renew', status: 'Customer' })).toEqual(['b@example.org'])
    expect(ids(store, { query: 'example', status: 'Inactive' })).toEqual(['c@example.org'])
    expect(ids(store, { due: 'Overdue', today })).toEqual(['a@example.org'])
    expect(ids(store, { due: 'Due today', today })).toEqual(['b@example.org'])
    expect(ids(store, { due: 'No due date', today })).toEqual(['c@example.org'])
    store = saveCustomer(store, 'a@example.org', { status: 'Customer', notes: 'Contract', dueDate: '2026-10-26' }, 'update')
    expect(ids(store, { query: 'pilot' })).toEqual([])
    expect(ids(store, { query: 'contract', status: 'Customer', due: 'Upcoming', today })).toEqual(['a@example.org'])
    expect(ids(store, { status: 'Lead' })).toEqual([])
    expect(ids(store)).toHaveLength(3)
  })

  it.each([
    ['a@example.org', { status: 'Prospect' }],
    ['a@example.org', { status: 'Lead', dueDate: '2026-02-30' }],
    ['a@example.org', { status: 'Lead', dueDate: '2026-2-01' }],
    ['a@example.org', { status: 'Lead', dueDate: 'tomorrow' }],
    ['a@example.org', { status: 'Lead', dueDate: '2026-01-01T10:00:00Z' }],
    ['a@example.org', { status: 'Lead', notes: 42 }],
    ['a@example.org', { notes: 'No status' }],
    ['missing', { status: 'Lead' }],
  ])('rejects invalid create %s %j without mutation', (id, patch) => {
    const store = seed(), before = JSON.stringify(store)
    expect(() => saveCustomer(store, id, patch, 'create')).toThrow()
    expect(JSON.stringify(store)).toBe(before)
  })

  it('rejects duplicate create, unknown update and invalid filters', () => {
    let store = seed()
    store = saveCustomer(store, 'a@example.org', { status: 'Lead' }, 'create')
    const before = JSON.stringify(store)
    expect(() => saveCustomer(store, 'a@example.org', { status: 'Customer' }, 'create')).toThrow()
    expect(() => saveCustomer(store, 'missing', { status: 'Customer' }, 'update')).toThrow()
    expect(() => saveCustomer(store, 'b@example.org', { status: 'Customer' }, 'update')).toThrow()
    expect(() => saveCustomer(store, 'a@example.org', { status: 'Wrong' }, 'update')).toThrow()
    expect(() => saveCustomer(store, 'a@example.org', { dueDate: '2025-02-29' }, 'update')).toThrow()
    expect(() => listCustomers(store, { due: 'Wrong' as never })).toThrow()
    expect(JSON.stringify(store)).toBe(before)
  })
})

it('keeps whole customer profiles through explicit and alias merges and subsequent edits', async () => {
  const { consolidateContacts } = await import('./contactConsolidation')
  let store = seed()
  const a = { status: 'Lead', notes: 'Pilot', nextAction: 'Call', dueDate: '2026-11-01' } as const
  const b = { status: 'Customer', notes: 'Renewal', nextAction: 'Review', dueDate: '' } as const
  store = saveCustomer(store, 'b@example.org', b, 'create')
  const inherited = consolidateContacts(store, 'a@example.org', 'b@example.org').store
  expect(inherited.contacts.find(person => person.id === 'a@example.org')!.customer).toEqual(b)
  store = saveCustomer(store, 'a@example.org', a, 'create')
  const merged = upsertContact(store, { email: 'a@example.org', addEmails: ['b@example.org'] }, 'user').store
  expect(merged.contacts).toHaveLength(3)
  expect(merged.contacts[0].customer).toEqual(a)
  expect(merged.contacts[0].alternatives!.customer).toEqual([b])
  const retry = upsertContact(merged, { email: 'a@example.org', addEmails: ['b@example.org'] }, 'user').store
  expect(retry.contacts[0].alternatives!.customer).toEqual([b])
  const changed = saveCustomer(retry, 'a@example.org', { status: 'Inactive' }, 'update')
  const reloaded = normalizePeopleStore(JSON.parse(JSON.stringify(changed)))
  expect(reloaded.contacts[0].customer).toEqual({ ...a, status: 'Inactive' })
  expect(reloaded.contacts[0].alternatives!.customer).toEqual([a, b])
})
