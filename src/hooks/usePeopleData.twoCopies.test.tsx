import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContactFeedEntry, ContactRecord, PeopleStore, PeopleUpdate } from '../types'

/**
 * Two live copies of PurePeople over one shared row store, through the real hook. The stand-in behaves as the shell does:
 * values cross as clones, a write fires `apps.data.changed` to subscribers. `deliver` turns those events off, which is
 * what a copy held inside the room gets: the shell relays tool calls to it, not data changes. A copy can only find out
 * what another did by looking.
 */
const rows = new Map<string, { key: string; collection: string; value: unknown }>()
const subscribers = new Set<(payload: unknown) => void>()
const shared = { deliver: false }
const rowId = (collection: string, key: string) => `${collection}/${key}`
const record = (row: { key: string; collection: string; value: unknown }) => ({
  ...row, value: structuredClone(row.value), appId: 'people', id: rowId(row.collection, row.key), createdAt: 'c', updatedAt: 'u',
})
const announce = (collection: string, key: string, type: 'set' | 'deleted') => {
  if (!shared.deliver) return
  for (const handler of subscribers) handler({ appId: 'people', collection, id: rowId(collection, key), key, type })
}

vi.mock('@purescience/platform-ui/bridge/client', () => ({
  bridge: {
    waitForReady: async () => ({ appSlug: 'people' }),
    onEvent: (name: string, handler: (payload: unknown) => void) => {
      if (name !== 'apps.data.changed') return () => undefined
      subscribers.add(handler)
      return () => subscribers.delete(handler)
    },
    call: async (method: string, args: unknown[] = []) => {
      const input = (args[0] ?? {}) as { collection: string; key: string; value: unknown }
      const id = rowId(input.collection, input.key)
      if (method === 'apps.data.list') return [...rows.values()].filter(row => row.collection === input.collection).map(record)
      if (method === 'apps.data.get') return rows.has(id) ? record(rows.get(id)!) : null
      if (method === 'apps.data.set') {
        const row = { key: input.key, collection: input.collection, value: structuredClone(input.value) }
        rows.set(id, row)
        announce(input.collection, input.key, 'set')
        return record(row)
      }
      if (method === 'apps.data.delete') {
        const row = rows.get(id)
        rows.delete(id)
        announce(input.collection, input.key, 'deleted')
        return row ? record(row) : null
      }
      throw new Error(`unexpected bridge method ${method}`)
    },
  },
}))

const { usePeopleData } = await import('./usePeopleData')
const { removeContact, upsertContact } = await import('../lib/contactsModel')
const { createList, renameList } = await import('../lib/peopleLists')

type Copy = { store: PeopleStore; update: PeopleUpdate; loading: boolean; error: Error | null }
const copies: Record<string, Copy> = {}
const roots: Root[] = []

function Held({ name, held }: { name: string; held: boolean }): null {
  copies[name] = (usePeopleData as (appId: string, options?: { background?: boolean }) => Copy)('people', held ? { background: false } : undefined)
  return null
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

async function open(name: string, held = false): Promise<Copy> {
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  await act(async () => root.render(<Held name={name} held={held} />))
  await flush()
  return copies[name]!
}

const contact = (id: string, extra: Partial<ContactRecord> = {}): ContactRecord => ({
  id, name: id, emails: [id], sources: [], firstSeenAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', seenCount: 1, updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
})
const seed = (value: ContactRecord) => rows.set(rowId('contacts', value.id), { key: value.id, collection: 'contacts', value })
const saved = (id: string) => rows.get(rowId('contacts', id))?.value as ContactRecord | undefined
const savedIds = () => [...rows.values()].filter(row => row.collection === 'contacts').map(row => row.key).sort()
const edit = (copy: string, id: string, patch: Partial<ContactRecord>) =>
  act(async () => { await copies[copy]!.update(store => upsertContact(store, { email: id, ...patch } as Parameters<typeof upsertContact>[1], 'user').store) })
const add = edit
const remove = (copy: string, id: string) =>
  act(async () => { await copies[copy]!.update(store => removeContact(store, id)) })
const look = async () => {
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  await flush()
}
const seenBy = (copy: string) => copies[copy]!.store.contacts.map(item => item.id).sort()

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  rows.clear()
  shared.deliver = false
})

afterEach(async () => {
  vi.useRealTimers()
  await act(async () => { for (const root of roots) root.unmount() })
  roots.length = 0
})

describe('two copies over one row store', () => {
  it('keeps what each adds, edits and deletes on different records', async () => {
    for (const id of ['edit-a@x.example', 'edit-b@x.example', 'gone-a@x.example', 'gone-b@x.example']) seed(contact(id))
    await open('a')
    await open('b')
    await add('a', 'new-a@x.example', { name: 'New A' })
    await add('b', 'new-b@x.example', { name: 'New B' })
    await edit('a', 'edit-a@x.example', { title: 'From A' })
    await edit('b', 'edit-b@x.example', { title: 'From B' })
    await remove('a', 'gone-a@x.example')
    await remove('b', 'gone-b@x.example')
    expect(savedIds()).toEqual(['edit-a@x.example', 'edit-b@x.example', 'new-a@x.example', 'new-b@x.example'])
    expect(saved('edit-a@x.example')?.title).toBe('From A')
    expect(saved('edit-b@x.example')?.title).toBe('From B')
  })

  it('does not bring back a record the other copy deleted', async () => {
    seed(contact('deleted@x.example', { title: 'Old title' }))
    await open('stale')
    await open('other')
    await remove('other', 'deleted@x.example')
    // The stale copy still shows the card: editing it must not put the person back.
    await edit('stale', 'deleted@x.example', { title: 'Edited on a stale card' })
    expect(saved('deleted@x.example')).toBeUndefined()
    await flush()
    expect(seenBy('stale')).toEqual([])
  })

  it('keeps the other copy\'s edit when a stale copy changes another field of that record', async () => {
    seed(contact('same@x.example'))
    await open('stale')
    await open('other')
    await edit('other', 'same@x.example', { title: 'Saved by the other copy' })
    await edit('stale', 'same@x.example', { org: 'Saved by the stale copy' })
    expect(saved('same@x.example')?.title).toBe('Saved by the other copy')
    expect(saved('same@x.example')?.org).toBe('Saved by the stale copy')
  })

  it('keeps the newer edit of one field', async () => {
    seed(contact('same@x.example'))
    await open('a')
    await open('b')
    await edit('a', 'same@x.example', { title: 'Older' })
    await edit('b', 'same@x.example', { title: 'Newer' })
    expect(saved('same@x.example')?.title).toBe('Newer')
    await edit('a', 'same@x.example', { org: 'Later, elsewhere' })
    expect(saved('same@x.example')?.title).toBe('Newer')
  })

  it('a copy opened on an older snapshot, saving at once, loses nothing the other did', async () => {
    seed(contact('edited@x.example'))
    seed(contact('deleted@x.example'))
    await open('older')
    await open('other')
    await edit('other', 'edited@x.example', { title: 'Edited after the snapshot' })
    await remove('other', 'deleted@x.example')
    await add('other', 'added@x.example', { name: 'Added after the snapshot' })
    // The first thing the older copy does is save, without having looked. Its edit touches the record the other changed.
    await edit('older', 'edited@x.example', { org: 'First save of the older copy' })
    await add('older', 'mine@x.example', { name: 'Mine' })
    expect(savedIds()).toEqual(['added@x.example', 'edited@x.example', 'mine@x.example'])
    expect(saved('edited@x.example')?.title).toBe('Edited after the snapshot')
    expect(saved('edited@x.example')?.org).toBe('First save of the older copy')
    await flush()
    expect(seenBy('older')).toEqual(['added@x.example', 'edited@x.example', 'mine@x.example'])
  })

  it('a feed sighting taken by a stale copy does not erase the other copy\'s edit', async () => {
    seed(contact('busy@x.example'))
    await open('held', true)
    await open('whole')
    await edit('held', 'busy@x.example', { title: 'Typed in the held copy' })
    const entry: ContactFeedEntry = { id: 'feed-1', sourceApp: 'mail', seenAt: '2026-06-01T00:00:00.000Z', contact: { email: 'busy@x.example' } }
    rows.set(rowId('contactFeed', entry.id), { key: entry.id, collection: 'contactFeed', value: entry })
    // Mail's next sighting reaches the whole app, which has not looked since it opened.
    shared.deliver = true
    await act(async () => { for (const handler of subscribers) handler({ appId: 'people', collection: 'contactFeed', id: 'x', key: entry.id, type: 'set' }) })
    await flush()
    expect(saved('busy@x.example')?.title).toBe('Typed in the held copy')
    expect(saved('busy@x.example')?.seenCount).toBe(2)
  })

  it('keeps lists each copy made and renames the other made', async () => {
    rows.set(rowId('lists', 'list_shared'), { key: 'list_shared', collection: 'lists', value: { id: 'list_shared', name: 'Shared', createdAt: 'c' } })
    await open('a')
    await open('b')
    await act(async () => { await copies.b!.update(store => renameList(store, 'list_shared', 'Renamed')) })
    await act(async () => { await copies.a!.update(store => createList(store, 'From A').store) })
    const names = [...rows.values()].filter(row => row.collection === 'lists').map(row => (row.value as { name: string }).name).sort()
    expect(names).toEqual(['From A', 'Renamed'])
    await flush()
    expect(copies.a!.store.lists?.map(list => list.name).sort()).toEqual(['From A', 'Renamed'])
  })
})

describe('a copy picks up what the other changed', () => {
  it('on a change event', async () => {
    seed(contact('known@x.example'))
    await open('a')
    await open('b')
    shared.deliver = true
    await add('b', 'new@x.example', { name: 'New' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)) })
    await flush()
    expect(seenBy('a')).toEqual(['known@x.example', 'new@x.example'])
  })

  it('by looking on focus, when no events reach it (held in the room)', async () => {
    seed(contact('known@x.example'))
    seed(contact('deleted@x.example'))
    await open('held', true)
    await open('whole')
    await add('whole', 'new@x.example', { name: 'New' })
    await edit('whole', 'known@x.example', { title: 'Changed' })
    await remove('whole', 'deleted@x.example')
    await look()
    expect(seenBy('held')).toEqual(['known@x.example', 'new@x.example'])
    expect(copies.held!.store.contacts.find(item => item.id === 'known@x.example')?.title).toBe('Changed')
  })

  it('by looking on a timer, when no events reach it', async () => {
    seed(contact('known@x.example'))
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await open('held', true)
    await open('whole')
    await act(async () => { await copies.whole!.update(store => upsertContact(store, { email: 'new@x.example', name: 'New' }, 'user').store) })
    await act(async () => { vi.advanceTimersByTime(60_000) })
    await flush()
    expect(seenBy('held')).toEqual(['known@x.example', 'new@x.example'])
  })
})

describe('a held copy starts no background work', () => {
  const feed = (key: string, email: string): void => {
    const entry: ContactFeedEntry = { id: key, sourceApp: 'mail', seenAt: '2026-06-01T00:00:00.000Z', contact: { email, name: 'Someone' } }
    rows.set(rowId('contactFeed', key), { key, collection: 'contactFeed', value: entry })
  }

  it('leaves the contact feed to the whole app', async () => {
    feed('feed-1', 'someone@x.example')
    await open('held', true)
    expect(rows.has(rowId('contactFeed', 'feed-1'))).toBe(true)
    expect(savedIds()).toEqual([])
    await open('whole')
    expect(rows.has(rowId('contactFeed', 'feed-1'))).toBe(false)
    expect(savedIds()).toEqual(['someone@x.example'])
  })

  it('counts one sighting once with both copies open', async () => {
    seed(contact('someone@x.example'))
    await open('whole')
    await open('held', true)
    feed('feed-2', 'someone@x.example')
    shared.deliver = true
    await act(async () => { for (const handler of subscribers) handler({ appId: 'people', collection: 'contactFeed', id: 'x', key: 'feed-2', type: 'set' }) })
    await flush()
    expect(saved('someone@x.example')?.seenCount).toBe(2)
  })

  it('does not finish a saved merge on opening', async () => {
    seed(contact('survivor@x.example', { mergeProgress: { absorbedIds: ['absorbed@x.example'], pendingIds: ['absorbed@x.example'] } }))
    seed(contact('absorbed@x.example'))
    await open('held', true)
    expect(savedIds()).toEqual(['absorbed@x.example', 'survivor@x.example'])
    await open('whole')
    expect(savedIds()).toEqual(['survivor@x.example'])
  })
})
