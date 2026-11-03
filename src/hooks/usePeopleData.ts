import { useCallback, useEffect, useMemo, useRef } from 'react'
import { data, useData, useEvents } from '../bridge/platformBridge'
import { emptyPeopleStore, mergeFeedEntry } from '../lib/contactsModel'
import type {
  ContactFeedEntry,
  ContactRecord,
  EncounterRecord,
  OrgRecord,
  PeopleList,
  PeopleStore,
  PeopleUpdate,
} from '../types'

/** Row writes per batch: independent records go over the bridge together. */
const WRITE_BATCH = 20

/** How often a copy looks at the rows when no change event told it to. A copy held in the room gets no events. */
const LOOK_EVERY_MS = 15_000
/** Change events coalesce: an import fires one per row. */
const EVENT_SETTLE_MS = 300
/** A burst of mail sightings re-reads the rows this often rather than once per sighting. */
const SIGHTINGS_PER_LOOK = 50

const VIEWED = ['contacts', 'orgs', 'lists', 'encounters'] as const
type Viewed = (typeof VIEWED)[number]

function sameRows(left: ReadonlyArray<{ id: string }>, right: ReadonlyArray<{ id: string }>): boolean {
  if (left.length !== right.length) return false
  const byId = new Map(left.map(row => [row.id, row]))
  return right.every(row => {
    const other = byId.get(row.id)
    return other === row || (other !== undefined && JSON.stringify(other) === JSON.stringify(row))
  })
}

async function settleBatch(writes: Promise<void>[]): Promise<void> {
  // A rejection must not release the mutation queue while siblings still write.
  const results = await Promise.allSettled(writes)
  const failed = results.find(result => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}

/**
 * Rows are written by this app and by feeds from other apps; a row that
 * lost the shape the domain functions rely on (a contact without an
 * address list, a list without a name) is skipped rather than allowed to
 * crash every search. Unknown extra fields pass through untouched.
 */
export function isContactRecord(value: unknown): value is ContactRecord {
  const record = value as Partial<ContactRecord> | null
  return Boolean(record)
    && typeof record!.id === 'string'
    && typeof record!.name === 'string'
    && Array.isArray(record!.emails)
    && Array.isArray(record!.sources)
    && typeof record!.lastSeenAt === 'string'
    && typeof record!.firstSeenAt === 'string'
}

export function isOrgRecord(value: unknown): value is OrgRecord {
  const record = value as Partial<OrgRecord> | null
  return Boolean(record)
    && typeof record!.id === 'string'
    && typeof record!.name === 'string'
    && Array.isArray(record!.sources)
    && typeof record!.lastSeenAt === 'string'
    && typeof record!.firstSeenAt === 'string'
}

export function isPeopleList(value: unknown): value is PeopleList {
  const record = value as Partial<PeopleList> | null
  return Boolean(record)
    && typeof record!.id === 'string'
    && typeof record!.name === 'string'
}

export function isEncounterRecord(value: unknown): value is EncounterRecord {
  const record = value as Partial<EncounterRecord> | null
  return Boolean(record)
    && typeof record!.id === 'string'
    && (record!.kind === 'thread' || record!.kind === 'meeting')
    && typeof record!.at === 'string'
    && Array.isArray(record!.emails)
    && record!.emails.every(email => typeof email === 'string')
}

/**
 * Several copies of PurePeople run over one set of rows (a tab, and a copy held in a page), each with its own memory. A
 * row written from memory that has gone stale erases what another copy saved, and puts back what it deleted. So every
 * change starts by looking: the updater runs over the rows as they are now, and a row this copy was showing that has since
 * gone stays gone. The shell's row store has no compare-and-set, so two writes to one row within the same moment are
 * still last-writer-wins.
 */
export function usePeopleData(appId: string, { background = true }: {
  /** False in a copy held in a page: the normal tab consumes the feed and finishes merges. */
  background?: boolean
} = {}) {
  const contacts = useData<ContactRecord>(appId, 'contacts')
  const orgs = useData<OrgRecord>(appId, 'orgs')
  const lists = useData<PeopleList>(appId, 'lists')
  // Written by other apps (PureMail threads, calendar meetings); People only reads them.
  const encounters = useData<EncounterRecord>(appId, 'encounters')
  // The domain functions keep their in-memory view; only individual values persist.
  // A feed/encounter update must not invalidate the unchanged contact rail.
  const contactValues = useMemo(() => contacts.records.map(record => record.value).filter(isContactRecord), [contacts.records])
  const orgValues = useMemo(() => orgs.records.map(record => record.value).filter(isOrgRecord), [orgs.records])
  const listValues = useMemo(() => lists.records.map(record => record.value).filter(isPeopleList), [lists.records])
  const encounterValues = useMemo(() => encounters.records.map(record => record.value).filter(isEncounterRecord), [encounters.records])
  const store = useMemo<PeopleStore>(() => ({
    ...emptyPeopleStore(),
    contacts: contactValues, orgs: orgValues, lists: listValues, encounters: encounterValues,
  }), [contactValues, orgValues, listValues, encounterValues])
  const current = useRef(store)
  const rendered = useRef(store)
  if (rendered.current !== store) {
    current.current = store
    rendered.current = store
  }
  // Looking again later must not put the loading state back: that would unmount the open card.
  const opened = useRef(false)
  const reading = contacts.loading || orgs.loading || lists.loading
  const readError = contacts.error ?? orgs.error ?? lists.error
  if (!reading && !readError) opened.current = true
  const loading = !opened.current && reading
  const error = opened.current ? null : readError

  // Preserve functional-update ordering while row writes cross the bridge.
  const pending = useRef(Promise.resolve())
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.current.then(operation)
    pending.current = result.then(() => {}, error => { console.error('[purepeople] queued update failed:', error) })
    return result
  }, [])

  const reloads = useRef<Record<Viewed, () => void>>({ contacts: contacts.reload, orgs: orgs.reload, lists: lists.reload, encounters: encounters.reload })
  reloads.current = { contacts: contacts.reload, orgs: orgs.reload, lists: lists.reload, encounters: encounters.reload }

  /** Read the rows as they are now. Says what differs from what this copy held, and which of its rows have gone. */
  const look = useCallback(async () => {
    const seen = current.current
    const read = async <T,>(collection: Viewed, valid: (value: unknown) => value is T): Promise<T[]> =>
      (await data.list<T>(appId, collection)).map(record => record.value).filter(valid)
    const [latestContacts, latestOrgs, latestLists, latestEncounters] = await Promise.all([
      read('contacts', isContactRecord), read('orgs', isOrgRecord), read('lists', isPeopleList), read('encounters', isEncounterRecord),
    ])
    const latest = { contacts: latestContacts, orgs: latestOrgs, lists: latestLists, encounters: latestEncounters }
    const changed = VIEWED.filter(name => !sameRows(seen[name] ?? [], latest[name]))
    const goneFrom = (name: Viewed): Set<string> => {
      const ids = new Set(latest[name].map(row => row.id))
      return new Set((seen[name] ?? []).map(row => row.id).filter(id => !ids.has(id)))
    }
    current.current = { ...seen, ...latest }
    return { changed, gone: { contacts: goneFrom('contacts'), orgs: goneFrom('orgs'), lists: goneFrom('lists') } }
  }, [appId])

  // The survivor row is the journal: a receipt and the complete merged values
  // are one set operation. Never recompute a merge after that set succeeds.
  const recover = useCallback(async (): Promise<void> => {
    for (const snapshot of current.current.contacts) {
      if (!snapshot.mergeProgress?.pendingIds.length) continue
      const row = await data.get<ContactRecord>(appId, 'contacts', snapshot.id)
      if (!row) throw new Error('The saved merge survivor is missing.')
      const survivor = row.value
      for (const id of survivor.mergeProgress?.pendingIds ?? []) {
        if (id === survivor.id) throw new Error('Invalid merge deletion target.')
        await contacts.delete(id)
        current.current = { ...current.current, contacts: current.current.contacts.filter(record => record.id !== id) }
      }
      const saved = await contacts.set(survivor.id, {
        ...survivor,
        mergeProgress: { absorbedIds: survivor.mergeProgress!.absorbedIds, pendingIds: [] },
      })
      current.current = { ...current.current, contacts: current.current.contacts.map(record => record.id === survivor.id ? saved.value : record) }
    }
  }, [appId, contacts.set, contacts.delete])

  const commit = useCallback(async (updater: Parameters<PeopleUpdate>[0], looking = true): Promise<PeopleStore> => {
    const noticed = looking ? await look() : null
    await recover()
    const before = current.current
    const proposed = updater(before)
    // Anything put back here is a stale card's edit of a row another copy deleted.
    const after: PeopleStore = noticed ? {
      ...proposed,
      contacts: proposed.contacts.filter(item => !noticed.gone.contacts.has(item.id)),
      orgs: proposed.orgs?.filter(item => !noticed.gone.orgs.has(item.id)),
      lists: proposed.lists?.filter(item => !noticed.gone.lists.has(item.id)),
    } : proposed
    const save = async <T extends { id: string }>(
      name: 'contacts' | 'orgs' | 'lists',
      previous: T[],
      next: T[],
      collection: Pick<ReturnType<typeof useData<T>>, 'set' | 'delete'>,
    ): Promise<void> => {
      const existing = new Map(previous.map(item => [item.id, item]))
      const retained = new Set(next.map(item => item.id))
      // Structural sharing marks the unchanged rows: an updater returns the
      // same object for anything it did not touch, so only changed rows
      // cross the bridge. A CSV import can change hundreds at once, so the
      // writes go out in small parallel batches rather than one at a time.
      const changed = next.filter(item => existing.get(item.id) !== item)
      const removed = previous.filter(item => !retained.has(item.id))
      for (let start = 0; start < changed.length; start += WRITE_BATCH) {
        await settleBatch(changed.slice(start, start + WRITE_BATCH).map(async item => {
          const saved = await collection.set(item.id, item)
          const values = current.current[name] ?? []
          current.current = {
            ...current.current,
            [name]: values.some(value => value.id === saved.key)
              ? values.map(value => value.id === saved.key ? saved.value : value)
              : [...values, saved.value],
          }
        }))
      }
      for (let start = 0; start < removed.length; start += WRITE_BATCH) {
        await settleBatch(removed.slice(start, start + WRITE_BATCH).map(async item => {
          await collection.delete(item.id)
          current.current = {
            ...current.current,
            [name]: (current.current[name] ?? []).filter(value => value.id !== item.id),
          }
        }))
      }
    }
    await save('contacts', before.contacts, after.contacts, contacts)
    await recover()
    await save('orgs', before.orgs ?? [], after.orgs ?? [], orgs)
    await save('lists', before.lists ?? [], after.lists ?? [], lists)
    // After the writes, so these reads hold them too.
    for (const name of noticed?.changed ?? []) reloads.current[name]()
    return current.current
  }, [look, recover, contacts.set, contacts.delete, orgs.set, orgs.delete, lists.set, lists.delete])

  useEffect(() => {
    if (!background || loading || error) return
    void enqueue(recover).catch(error => console.error('[purepeople] merge recovery failed:', error))
  }, [background, loading, error, enqueue, recover])

  const update = useCallback<PeopleUpdate>(updater => enqueue(() => commit(updater)), [commit, enqueue])

  // Take what other copies saved. Identical rows change nothing, so a look costs a read and no render.
  const refresh = useCallback((): Promise<void> => enqueue(async () => {
    const { changed } = await look()
    for (const name of changed) reloads.current[name]()
  }), [enqueue, look])
  const refreshQuietly = useCallback((): void => {
    void refresh().catch(error => console.warn('[purepeople] could not look at the rows:', error))
  }, [refresh])

  const settling = useRef<number | undefined>(undefined)
  const onRowChange = (change: { collection: string }): void => {
    if (loading || error || !VIEWED.includes(change.collection as Viewed)) return
    window.clearTimeout(settling.current)
    settling.current = window.setTimeout(refreshQuietly, EVENT_SETTLE_MS)
  }
  useEvents(appId, { set: onRowChange, deleted: onRowChange })

  useEffect(() => {
    if (loading || error) return
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshQuietly()
    }, LOOK_EVERY_MS)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refreshQuietly()
    }
    window.addEventListener('focus', refreshQuietly)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(poll)
      window.clearTimeout(settling.current)
      window.removeEventListener('focus', refreshQuietly)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loading, error, refreshQuietly])

  // The contact feed: a queue, drained by one copy in order, looking once per burst rather than per sighting.
  const sightings = useRef(new Set<string>())
  const draining = useRef(false)
  const drain = useCallback((): void => {
    if (draining.current) return
    draining.current = true
    void enqueue(async () => {
      let taken = 0
      for (const key of sightings.current) {
        sightings.current.delete(key)
        try {
          const entry = await data.get<ContactFeedEntry>(appId, 'contactFeed', key)
          if (!entry) continue
          await commit(store => mergeFeedEntry(store, entry.value), taken++ % SIGHTINGS_PER_LOOK === 0)
          await data.delete(appId, 'contactFeed', key)
        } catch (error) {
          console.error('[purepeople] contact feed failed:', error)
        }
      }
    }).finally(() => {
      draining.current = false
      if (sightings.current.size) drain()
    })
  }, [appId, commit, enqueue])

  useEvents(appId, {
    set: change => {
      if (!background || loading || error) return
      sightings.current.add(change.key)
      drain()
    },
  }, 'contactFeed')

  useEffect(() => {
    if (!background || loading || error) return
    let cancelled = false
    void data.list<ContactFeedEntry>(appId, 'contactFeed')
      .then(entries => {
        if (cancelled) return
        for (const entry of entries) sightings.current.add(entry.key)
        drain()
      })
      .catch(error => console.error('[purepeople] contact feed failed:', error))
    return () => { cancelled = true }
  }, [appId, background, drain, loading, error])

  return { store, update, loading, error }
}
