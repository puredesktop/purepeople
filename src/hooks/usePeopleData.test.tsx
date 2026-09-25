import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContactFeedEntry, PeopleStore, PeopleUpdate } from '../types'

/**
 * An in-memory stand-in for the shell's app-data bridge: the same four
 * methods over a Map, plus the change events the shell would forward.
 * Everything usePeopleData does with the real shell goes through here.
 */
const rows = new Map<string, { key: string; collection: string; value: unknown; createdAt: string }>()
const calls: string[] = []
const eventHandlers = new Map<string, Set<(payload: unknown) => void>>()
let clock = 0
let beforeDelete: ((key: string) => Promise<void>) | null = null
let beforeSet: ((key: string) => Promise<void>) | null = null
const rowId = (appId: string, collection: string, key: string): string =>
  `${appId}/${collection}/${key}`

vi.mock('@purescience/platform-ui/bridge/client', () => ({
  bridge: {
    waitForReady: async () => ({ appSlug: 'people' }),
    onEvent: (name: string, handler: (payload: unknown) => void) => {
      const set = eventHandlers.get(name) ?? new Set()
      set.add(handler)
      eventHandlers.set(name, set)
      return () => set.delete(handler)
    },
    call: async (method: string, args: unknown[] = []) => {
      const input = (args[0] ?? {}) as Record<string, string | unknown>
      const appId = String(input.appId)
      const collection = String(input.collection)
      calls.push(`${method}:${collection}`)
      if (method === 'apps.data.list') {
        return [...rows.values()]
          .filter(row => row.collection === collection)
          .map(row => ({ ...row, appId, id: rowId(appId, collection, row.key), updatedAt: row.createdAt }))
      }
      if (method === 'apps.data.get') {
        const row = rows.get(rowId(appId, collection, String(input.key)))
        return row ? { ...row, appId, id: rowId(appId, collection, row.key), updatedAt: row.createdAt } : null
      }
      if (method === 'apps.data.set') {
        const key = String(input.key)
        await beforeSet?.(key)
        const id = rowId(appId, collection, key)
        const createdAt = rows.get(id)?.createdAt ?? new Date(++clock).toISOString()
        // Values cross the bridge as structured clones, never by identity.
        const value = structuredClone(input.value)
        rows.set(id, { key, collection, value, createdAt })
        return { key, collection, value, appId, id, createdAt, updatedAt: createdAt }
      }
      if (method === 'apps.data.delete') {
        await beforeDelete?.(String(input.key))
        const id = rowId(appId, collection, String(input.key))
        const row = rows.get(id)
        rows.delete(id)
        return row ? { ...row, appId, id } : null
      }
      throw new Error(`unexpected bridge method ${method}`)
    },
  },
}))

const { usePeopleData } = await import('./usePeopleData')
const { upsertContact } = await import('../lib/contactsModel')

let root: Root | null = null
let latest: { store: PeopleStore; update: PeopleUpdate; loading: boolean; error: Error | null } | null = null

function Probe(): null {
  latest = usePeopleData('people')
  return null
}

async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0))
    })
  }
}

async function mount(): Promise<void> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<Probe />)
  })
  await flush()
}

function seedRow(collection: string, key: string, value: unknown): void {
  rows.set(rowId('people', collection, key), {
    key, collection, value, createdAt: new Date(++clock).toISOString(),
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  rows.clear()
  calls.length = 0
  latest = null
  beforeSet = null
  beforeDelete = null
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
})

describe('usePeopleData over the app-data bridge', () => {
  it('loads the three collections and skips rows without the domain shape', async () => {
    seedRow('contacts', 'ana@x.example', {
      id: 'ana@x.example', name: 'Ana', emails: ['ana@x.example'], sources: [],
      firstSeenAt: 'a', lastSeenAt: 'a', seenCount: 1, updatedAt: 'a',
    })
    seedRow('contacts', 'broken', { id: 'broken', name: 'No emails' })
    seedRow('lists', 'list_a', { id: 'list_a', name: 'A', createdAt: 'a' })
    await mount()
    expect(latest!.loading).toBe(false)
    expect(latest!.error).toBeNull()
    expect(latest!.store.contacts.map(contact => contact.id)).toEqual(['ana@x.example'])
    expect(latest!.store.lists?.map(list => list.name)).toEqual(['A'])
  })

  it('writes only the rows an updater changed, and deletes the rows it dropped', async () => {
    await mount()
    await act(async () => {
      await latest!.update(store => upsertContact(store, { email: 'ana@x.example', name: 'Ana' }, 'user').store)
    })
    await act(async () => {
      await latest!.update(store => upsertContact(store, { email: 'bo@x.example', name: 'Bo' }, 'user').store)
    })
    calls.length = 0
    // Touch Bo only: Ana's row must not be rewritten.
    await act(async () => {
      await latest!.update(store => upsertContact(store, { email: 'bo@x.example', title: 'CTO' }, 'user').store)
    })
    expect(calls.filter(call => call.startsWith('apps.data.set'))).toEqual(['apps.data.set:contacts'])
    expect((rows.get(rowId('people', 'contacts', 'bo@x.example'))?.value as { title: string }).title).toBe('CTO')
    // Drop Ana: her row goes away, nothing else is rewritten.
    calls.length = 0
    await act(async () => {
      await latest!.update(store => ({ ...store, contacts: store.contacts.filter(contact => contact.id !== 'ana@x.example') }))
    })
    expect(calls.filter(call => /set|delete/.test(call))).toEqual(['apps.data.delete:contacts'])
    await flush()
    expect(latest!.store.contacts.map(contact => contact.id)).toEqual(['bo@x.example'])
  })

  it('persists a bulk change (every row) and the updater sees earlier commits', async () => {
    await mount()
    await act(async () => {
      await latest!.update(store => {
        let next = store
        for (let i = 0; i < 45; i++) {
          next = upsertContact(next, { email: `p${i}@x.example`, name: `P${i}` }, 'user').store
        }
        return next
      })
    })
    expect([...rows.values()].filter(row => row.collection === 'contacts')).toHaveLength(45)
    await flush()
    expect(latest!.store.contacts).toHaveLength(45)
    // A follow-up updater starts from the committed 45, not from the empty boot store.
    let seen = -1
    await act(async () => {
      await latest!.update(store => {
        seen = store.contacts.length
        return store
      })
    })
    expect(seen).toBe(45)
  })

  it('consumes contact feed rows on boot and on change events, then deletes them', async () => {
    const entry: ContactFeedEntry = {
      id: 'mail_taylor@organization.example',
      sourceApp: 'mail',
      seenAt: '2026-09-01T00:00:00.000Z',
      contact: { email: 'taylor@organization.example', name: 'Taylor Example' },
      context: 'Re: proofs',
    }
    seedRow('contactFeed', entry.id, entry)
    await mount()
    await flush()
    expect(latest!.store.contacts.map(contact => contact.name)).toEqual(['Taylor Example'])
    expect(rows.has(rowId('people', 'contactFeed', entry.id))).toBe(false)

    // A later feed row arrives while the app is open: the shell forwards a change event.
    const second: ContactFeedEntry = {
      ...entry, id: 'mail_bo@x.example', contact: { email: 'bo@x.example', name: 'Bo' },
    }
    seedRow('contactFeed', second.id, second)
    await act(async () => {
      for (const handler of eventHandlers.get('apps.data.changed') ?? []) {
        handler({ appId: 'people', collection: 'contactFeed', id: 'x', key: second.id, type: 'set' })
      }
    })
    await flush()
    expect(latest!.store.contacts.map(contact => contact.name).sort()).toEqual(['Bo', 'Taylor Example'])
    expect([...rows.values()].filter(row => row.collection === 'contactFeed')).toHaveLength(0)
  })
})

it('waits for every write in a failed batch before starting the next update', async () => {
  await mount()
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  beforeSet = async key => {
    if (key === 'bad@x.example') throw new Error('EIO')
    if (key === 'slow@x.example') await gate
  }
  let nextStarted = false
  let first!: Promise<unknown>
  let next!: Promise<unknown>
  await act(async () => {
    first = latest!
      .update(store => {
        const a = upsertContact(store, { email: 'bad@x.example' }, 'user').store
        return upsertContact(a, { email: 'slow@x.example' }, 'user').store
      })
      .catch(error => error)
    next = latest!.update(store => {
      nextStarted = true
      return store
    })
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  const startedBeforeSettlement = nextStarted
  await act(async () => {
    release()
    await first
    await next
  })
  expect(startedBeforeSettlement).toBe(false)
  expect(nextStarted).toBe(true)
  expect(await first).toBeInstanceOf(Error)
})

const { mergeContacts } = await import('../lib/contactConsolidation')

async function seedMerge(): Promise<void> {
  for (const [id, count] of [['a', 2], ['b', 3], ['untouched', 9]] as const) {
    seedRow('contacts', id, {
      id, name: id, emails: [`${id}@x.example`], notes: `Note ${id}`,
      sources: [], firstSeenAt: 'a', lastSeenAt: 'b', seenCount: count, updatedAt: 'b',
    })
  }
  await mount()
}

it('refuses invalid targets and preserves both originals on survivor save failure', async () => {
  await seedMerge()
  await act(async () => {
    await expect(mergeContacts(latest!.update, 'a', 'a')).rejects.toThrow('distinct')
    await expect(mergeContacts(latest!.update, 'a', 'missing')).rejects.toThrow('distinct')
  })
  beforeSet = async () => { throw new Error('save failed') }
  await act(async () => {
    await expect(mergeContacts(latest!.update, 'a', 'b')).rejects.toThrow('save failed')
  })
  expect((rows.get(rowId('people', 'contacts', 'a'))!.value as { seenCount: number }).seenCount).toBe(2)
  expect(rows.has(rowId('people', 'contacts', 'b'))).toBe(true)
  beforeSet = null
  await act(async () => {
    expect((await mergeContacts(latest!.update, 'a', 'b')).seenCount).toBe(5)
  })
})

it.each([false, true])('recovers deletion failure exactly once, including reload=%s', async reload => {
  await seedMerge()
  const untouched = structuredClone(rows.get(rowId('people', 'contacts', 'untouched')))
  beforeDelete = async key => { if (key === 'b') throw new Error('delete failed') }
  await act(async () => {
    await expect(mergeContacts(latest!.update, 'a', 'b')).rejects.toThrow('delete failed')
  })
  const partial = rows.get(rowId('people', 'contacts', 'a'))!.value as { seenCount: number; mergeProgress: { pendingIds: string[] } }
  expect(partial.seenCount).toBe(5)
  expect(partial.mergeProgress.pendingIds).toEqual(['b'])
  if (reload) {
    await act(async () => root!.unmount())
    root = null
    beforeDelete = null
    await mount()
  }
  beforeDelete = null
  await act(async () => {
    const saved = await mergeContacts(latest!.update, 'a', 'b')
    expect(saved.seenCount).toBe(5)
    expect(saved.alternatives?.notes).toEqual([{ notes: 'Note b' }])
    expect(saved.mergeProgress?.pendingIds).toEqual([])
    expect((await mergeContacts(latest!.update, 'a', 'b')).seenCount).toBe(5)
  })
  expect(rows.has(rowId('people', 'contacts', 'b'))).toBe(false)
  expect(rows.get(rowId('people', 'contacts', 'untouched'))).toEqual(untouched)
})

it('recovers alias consolidation before queued edits and feeds', async () => {
  await seedMerge()
  let fail = true
  beforeDelete = async key => { if (key === 'b' && fail) throw new Error('delete failed') }
  await act(async () => {
    await expect(latest!.update(store => upsertContact(store, { email: 'a', addEmails: ['b@x.example'] }, 'user').store)).rejects.toThrow('delete failed')
  })
  fail = false
  const entry: ContactFeedEntry = {
    id: 'feed', sourceApp: 'mail', seenAt: '2026-09-18',
    contact: { email: 'b@x.example', name: 'Feed name' },
  }
  seedRow('contactFeed', entry.id, entry)
  await act(async () => {
    const edit = latest!.update(store => upsertContact(store, { email: 'a', title: 'Editor' }, 'user').store)
    for (const handler of eventHandlers.get('apps.data.changed') ?? []) {
      handler({ appId: 'people', collection: 'contactFeed', key: entry.id, type: 'set' })
    }
    await edit
  })
  await flush()
  await act(async () => {
    const retry = await latest!.update(store => upsertContact(store, { email: 'a', addEmails: ['b@x.example'] }, 'user').store)
    const survivor = retry.contacts.find(contact => contact.id === 'a')!
    expect(survivor.seenCount).toBe(6)
    expect(survivor.title).toBe('Editor')
    expect(survivor.alternatives?.notes).toEqual([{ notes: 'Note b' }])
    expect(retry.contacts).toHaveLength(2)
  })
  expect(rows.has(rowId('people', 'contactFeed', 'feed'))).toBe(false)
})

it('recovers a failed receipt cleanup without losing a queued edit', async () => {
  await seedMerge()
  let saves = 0
  beforeSet = async key => { if (key === 'a' && ++saves === 2) throw new Error('cleanup failed') }
  await act(async () => {
    await expect(mergeContacts(latest!.update, 'a', 'b')).rejects.toThrow('cleanup failed')
    expect(rows.has(rowId('people', 'contacts', 'b'))).toBe(false)
    beforeSet = null
    await latest!.update(store => upsertContact(store, { email: 'a', notes: 'Edited after failure' }, 'user').store)
    const saved = await mergeContacts(latest!.update, 'a', 'b')
    expect(saved.notes).toBe('Edited after failure')
    expect(saved.seenCount).toBe(5)
    expect(saved.alternatives?.notes).toEqual(expect.arrayContaining([{ notes: 'Note b' }]))
  })
})

it('validates against queued state and cannot delete before the survivor save finishes', async () => {
  await seedMerge()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  beforeSet = async key => { if (key === 'a') await gate }
  await act(async () => {
    const edit = latest!.update(store => upsertContact(store, { email: 'b', title: 'Earlier edit' }, 'user').store)
    const merge = mergeContacts(latest!.update, 'a', 'b')
    await edit
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(rows.has(rowId('people', 'contacts', 'b'))).toBe(true)
    release()
    expect((await merge).title).toBe('Earlier edit')
  })
})
