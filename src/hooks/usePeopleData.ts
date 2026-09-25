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

export function usePeopleData(appId: string) {
  const contacts = useData<ContactRecord>(appId, 'contacts')
  const orgs = useData<OrgRecord>(appId, 'orgs')
  const lists = useData<PeopleList>(appId, 'lists')
  // Written by other apps (PureMail threads, calendar meetings); People only reads them.
  const encounters = useData<EncounterRecord>(appId, 'encounters')
  // The domain functions keep their in-memory view; only individual values persist.
  const store = useMemo<PeopleStore>(() => ({
    ...emptyPeopleStore(),
    contacts: contacts.records.map(record => record.value).filter(isContactRecord),
    orgs: orgs.records.map(record => record.value).filter(isOrgRecord),
    lists: lists.records.map(record => record.value).filter(isPeopleList),
    encounters: encounters.records.map(record => record.value).filter(isEncounterRecord),
  }), [contacts.records, orgs.records, lists.records, encounters.records])
  const current = useRef(store)
  const rendered = useRef(store)
  if (rendered.current !== store) {
    current.current = store
    rendered.current = store
  }
  const loading = contacts.loading || orgs.loading || lists.loading
  const error = contacts.error ?? orgs.error ?? lists.error

  // Preserve functional-update ordering while row writes cross the bridge.
  const pending = useRef(Promise.resolve())
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.current.then(operation)
    pending.current = result.then(() => {}, error => { console.error('[purepeople] queued update failed:', error) })
    return result
  }, [])

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

  const commit = useCallback(async (updater: Parameters<PeopleUpdate>[0]): Promise<PeopleStore> => {
    await recover()
    const before = current.current
    const after = updater(before)
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
    return current.current
  }, [recover, contacts.set, contacts.delete, orgs.set, orgs.delete, lists.set, lists.delete])

  useEffect(() => {
    if (loading || error) return
    void enqueue(recover).catch(error => console.error('[purepeople] merge recovery failed:', error))
  }, [loading, error, enqueue, recover])

  const update = useCallback<PeopleUpdate>(updater => enqueue(() => commit(updater)), [commit, enqueue])
  const consume = useCallback((key: string): Promise<void> => enqueue(async () => {
    const entry = await data.get<ContactFeedEntry>(appId, 'contactFeed', key)
    if (!entry) return
    await commit(store => mergeFeedEntry(store, entry.value))
    await data.delete(appId, 'contactFeed', key)
  }), [appId, commit, enqueue])

  useEvents(appId, {
    set: change => {
      if (loading || error) return
      void consume(change.key).catch(error => console.error('[purepeople] contact feed failed:', error))
    },
  }, 'contactFeed')

  useEffect(() => {
    if (loading || error) return
    let cancelled = false
    void data.list<ContactFeedEntry>(appId, 'contactFeed')
      .then(async entries => {
        for (const entry of entries) {
          if (cancelled) return
          await consume(entry.key)
        }
      })
      .catch(error => console.error('[purepeople] contact feed failed:', error))
    return () => { cancelled = true }
  }, [appId, consume, loading, error])

  return { store, update, loading, error }
}
