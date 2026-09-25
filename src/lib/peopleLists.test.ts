import { describe, expect, it } from 'vitest'
import { emptyPeopleStore, searchContacts, upsertContact } from './contactsModel'
import {
  addToList,
  contactInList,
  createList,
  fileImportedContacts,
  listByIdOrName,
  listCounts,
  listsForContact,
  removeFromList,
  removeList,
  renameList,
  setContactLists,
  storeLists,
} from './peopleLists'
import type { PeopleStore } from '../types'

const NOW = '2026-08-25T09:00:00.000Z'

function seeded(): PeopleStore {
  let store = emptyPeopleStore()
  for (const [email, name, org] of [
    ['ana@publisher.example', 'Ana Example', 'ExamplePublisher'],
    ['bo@publisher.example', 'Bo Lang', 'ExamplePublisher'],
    ['cy@elsewhere.example', 'Cy Mora', 'Elsewhere'],
  ] as const) {
    store = upsertContact(store, { email, name, org }, 'user').store
  }
  return store
}

describe('lists are places, not labels', () => {
  it('survives being empty, which is the whole point', () => {
    const { store, list } = createList(emptyPeopleStore(), 'publisher.example')
    expect(storeLists(store)).toHaveLength(1)
    expect(listCounts(store).get(list.id)).toBe(0)
  })

  it('never makes the same list twice', () => {
    const first = createList(emptyPeopleStore(), 'publisher.example')
    const second = createList(first.store, '  Publisher.Example  ')
    expect(second.list.id).toBe(first.list.id)
    expect(storeLists(second.store)).toHaveLength(1)
  })

  it('renames without touching a single contact', () => {
    let store = addToList(seeded(), 'publisher.example', ['ana@publisher.example'])
    const list = listByIdOrName(store, 'publisher.example')!
    const before = store.contacts.map(c => JSON.stringify(c.listIds ?? []))
    store = renameList(store, list.id, 'ExamplePublisher launch')
    expect(listByIdOrName(store, 'ExamplePublisher launch')?.id).toBe(list.id)
    expect(store.contacts.map(c => JSON.stringify(c.listIds ?? []))).toEqual(before)
  })

  it('deleting a list keeps the people', () => {
    let store = addToList(seeded(), 'publisher.example', ['ana@publisher.example', 'bo@publisher.example'])
    const list = listByIdOrName(store, 'publisher.example')!
    store = removeList(store, list.id)
    expect(store.contacts).toHaveLength(3)
    expect(storeLists(store)).toHaveLength(0)
    expect(store.contacts.every(c => !(c.listIds ?? []).length)).toBe(true)
  })
})

describe('membership', () => {
  it('adds people, creating the list on first use, and does not double-add', () => {
    let store = addToList(seeded(), 'publisher.example', ['ana@publisher.example'])
    store = addToList(store, 'publisher.example', ['ana@publisher.example', 'bo@publisher.example'])
    const list = listByIdOrName(store, 'publisher.example')!
    expect(listCounts(store).get(list.id)).toBe(2)
    const ana = store.contacts.find(c => c.id === 'ana@publisher.example')!
    expect(ana.listIds).toEqual([list.id])
  })

  it('removes one person without disturbing the rest', () => {
    let store = addToList(seeded(), 'publisher.example', ['ana@publisher.example', 'bo@publisher.example'])
    const list = listByIdOrName(store, 'publisher.example')!
    store = removeFromList(store, list.id, 'ana@publisher.example')
    expect(contactInList(store.contacts.find(c => c.id === 'ana@publisher.example')!, list.id)).toBe(false)
    expect(listCounts(store).get(list.id)).toBe(1)
  })

  it('a person can be on several lists at once', () => {
    let store = addToList(seeded(), 'publisher.example', ['ana@publisher.example'])
    store = addToList(store, 'investors', ['ana@publisher.example'])
    const ana = store.contacts.find(c => c.id === 'ana@publisher.example')!
    expect(listsForContact(store, ana).map(l => l.name)).toEqual([
      'publisher.example',
      'investors',
    ])
  })

  it('setting membership ignores lists that do not exist', () => {
    let store = addToList(seeded(), 'publisher.example', [])
    const list = listByIdOrName(store, 'publisher.example')!
    store = setContactLists(store, 'ana@publisher.example', [list.id, 'list_nonsense'])
    expect(store.contacts.find(c => c.id === 'ana@publisher.example')!.listIds).toEqual([
      list.id,
    ])
  })
})

describe('searching within a list, or across all', () => {
  it('scopes to the list when one is given', () => {
    const store = addToList(seeded(), 'publisher.example', ['ana@publisher.example', 'bo@publisher.example'])
    const list = listByIdOrName(store, 'publisher.example')!
    expect(searchContacts(store, '', 50).length).toBe(3)
    expect(searchContacts(store, '', 50, list.id).map(c => c.name).sort()).toEqual([
      'Ana Example',
      'Bo Lang',
    ])
    // a query still applies inside the scope
    expect(searchContacts(store, 'ana', 50, list.id).map(c => c.name)).toEqual([
      'Ana Example',
    ])
    // and someone outside the list is not found by searching inside it
    expect(searchContacts(store, 'Cy', 50, list.id)).toEqual([])
  })
})

describe('renameList collisions', () => {
  it('leaves the store untouched when another list owns the name', () => {
    let store = emptyPeopleStore(NOW)
    const a = createList(store, 'A', NOW)
    store = a.store
    const b = createList(store, 'B', NOW)
    store = b.store
    expect(renameList(store, a.list.id, ' b ', NOW)).toBe(store)
    expect(renameList(store, a.list.id, 'A2', NOW).lists?.[0]?.name).toBe('A2')
    // a case-only rename of itself is allowed
    expect(renameList(store, a.list.id, 'a', NOW).lists?.[0]?.name).toBe('a')
  })
})

describe('fileImportedContacts', () => {
  it('resolves imported addresses to the record they merged into', () => {
    let store = emptyPeopleStore(NOW)
    store = upsertContact(
      store,
      { email: 'ana@publisher.example', name: 'Ana', addEmails: ['ana@old.example'] },
      'user',
      NOW,
    ).store
    const next = fileImportedContacts(
      store,
      [
        { email: 'ana@old.example', lists: ['Investors'] },
        { email: 'nobody@x.example', lists: ['Investors'] },
      ],
      'publisher.example',
      NOW,
    )
    const investors = listByIdOrName(next, 'Investors')!
    const purepub = listByIdOrName(next, 'publisher.example')!
    const ana = next.contacts.find(contact => contact.id === 'ana@publisher.example')!
    expect(ana.listIds).toEqual([investors.id, purepub.id])
    expect(next.contacts).toHaveLength(1)
    expect(listCounts(next).get(investors.id)).toBe(1)
  })
})
