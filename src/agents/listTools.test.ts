import { describe, expect, it } from 'vitest'
import { emptyPeopleStore, upsertContact } from '../lib/contactsModel'
import { listByIdOrName, listCounts, storeLists } from '../lib/peopleLists'
import type { PeopleStore } from '../types'
import {
  addToListHandler,
  AgentPeopleToolError,
  createListHandler,
  deleteListHandler,
  listContactsHandler,
  listListsHandler,
  removeFromListHandler,
  renameListHandler,
} from './handlers'

const NOW = '2026-08-25T09:00:00.000Z'

/** A context returning the committed store. */
function context(initial: PeopleStore) {
  const held = { store: initial }
  return {
    get store() {
      return held.store
    },
    async setStore(updater: (current: PeopleStore) => PeopleStore) {
      held.store = updater(held.store)
      return held.store
    },
  }
}

function seeded() {
  let store = emptyPeopleStore(NOW)
  store = upsertContact(store, { email: 'ana@publisher.example', name: 'Ana Example' }, 'user', NOW).store
  store = upsertContact(store, { email: 'bo@organization.example', name: 'Bo Example' }, 'user', NOW).store
  return context(store)
}

const parse = (result: { content: string }) => JSON.parse(result.content)

describe('list agent tools', () => {
  it('creates an empty list and reports it', async () => {
    const ctx = seeded()
    const reply = parse(await createListHandler(ctx, { name: 'publisher.example' }))
    expect(reply.created).toBe(true)
    expect(reply.lists).toEqual([
      { id: expect.any(String), name: 'publisher.example', people: 0 },
    ])
    // the roster reflects the store AFTER the change, not before
    expect(storeLists(ctx.store)).toHaveLength(1)
  })

  it('does not make a second list of the same name', async () => {
    const ctx = seeded()
    await createListHandler(ctx, { name: 'publisher.example' })
    const reply = parse(await createListHandler(ctx, { name: 'Publisher.Example ' }))
    expect(reply.created).toBe(false)
    expect(storeLists(ctx.store)).toHaveLength(1)
  })

  it('adds people, creating the list on first use', async () => {
    const ctx = seeded()
    const reply = parse(
      await addToListHandler(ctx, { list: 'publisher.example', emails: ['ana@publisher.example'] }),
    )
    expect(reply.createdList).toBe(true)
    expect(reply.added).toEqual(['Ana Example'])
    expect(reply.holds).toBe(1)
  })

  it('reports addresses it does not know instead of inventing people', async () => {
    const ctx = seeded()
    const reply = parse(
      await addToListHandler(ctx, {
        list: 'publisher.example',
        emails: ['ana@publisher.example', 'nobody@example.com'],
      }),
    )
    expect(reply.added).toEqual(['Ana Example'])
    expect(reply.notFound).toEqual(['nobody@example.com'])
    expect(ctx.store.contacts).toHaveLength(2)
  })

  it('removes membership without touching the person', async () => {
    const ctx = seeded()
    await addToListHandler(ctx, {
      list: 'publisher.example',
      emails: ['ana@publisher.example', 'bo@organization.example'],
    })
    const reply = parse(
      await removeFromListHandler(ctx, { list: 'publisher.example', emails: ['bo@organization.example'] }),
    )
    expect(reply.removed).toEqual(['Bo Example'])
    expect(reply.holds).toBe(1)
    expect(ctx.store.contacts).toHaveLength(2)
  })

  it('refuses a list it has never heard of, and says what exists', async () => {
    const ctx = seeded()
    await createListHandler(ctx, { name: 'publisher.example' })
    await expect(
      removeFromListHandler(ctx, { list: 'investors', emails: ['ana@publisher.example'] }),
    ).rejects.toThrow(/publisher\.example/)
    await expect(removeFromListHandler(ctx, { list: 'investors', emails: [] })).rejects.toThrow(
      AgentPeopleToolError,
    )
  })

  it('renames without editing any contact record', async () => {
    const ctx = seeded()
    await addToListHandler(ctx, { list: 'purepub', emails: ['ana@publisher.example'] })
    const before = ctx.store.contacts.map(contact => contact.listIds)
    await renameListHandler(ctx, { list: 'purepub', name: 'publisher.example contacts' })
    expect(ctx.store.contacts.map(contact => contact.listIds)).toEqual(before)
    const list = listByIdOrName(ctx.store, 'publisher.example contacts')!
    expect(listCounts(ctx.store).get(list.id)).toBe(1)
  })

  it('deletes only on an exact name, and keeps the people', async () => {
    const ctx = seeded()
    await addToListHandler(ctx, { list: 'publisher.example', emails: ['ana@publisher.example'] })
    await expect(
      deleteListHandler(ctx, { list: 'publisher.example', name: 'purepub' }),
    ).rejects.toThrow(/exact current name/)
    expect(storeLists(ctx.store)).toHaveLength(1)

    const reply = parse(
      await deleteListHandler(ctx, { list: 'publisher.example', name: 'publisher.example' }),
    )
    expect(reply.peopleKept).toBe(1)
    expect(storeLists(ctx.store)).toHaveLength(0)
    expect(ctx.store.contacts).toHaveLength(2)
  })

  it('listLists and listContacts agree on what a list holds', async () => {
    const ctx = seeded()
    await addToListHandler(ctx, { list: 'publisher.example', emails: ['ana@publisher.example'] })
    const roster = parse(listListsHandler(ctx)).lists
    expect(roster[0].people).toBe(1)
    const scoped = parse(listContactsHandler(ctx, { list: 'publisher.example' }))
    expect(scoped.contacts.map((c: { name: string }) => c.name)).toEqual(['Ana Example'])
  })

  it('refuses to rename a list onto a name another list already has', async () => {
    const ctx = seeded()
    await createListHandler(ctx, { name: 'investors' })
    await createListHandler(ctx, { name: 'publisher.example' })
    await expect(
      renameListHandler(ctx, { list: 'investors', name: 'Publisher.Example' }),
    ).rejects.toThrow(AgentPeopleToolError)
    expect(storeLists(ctx.store).map(list => list.name)).toEqual([
      'investors',
      'publisher.example',
    ])
    // renaming onto its own name (case change) is fine
    const reply = parse(
      await renameListHandler(ctx, { list: 'investors', name: 'Investors' }),
    )
    expect(reply.renamed).toBe('investors → Investors')
  })
})
