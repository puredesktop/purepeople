import type { ContactRecord, PeopleList, PeopleStore } from '../types'
import { contactByIdOrEmail } from './contactsModel'

/**
 * Lists are curated collections: "publisher.example contacts", "investors".
 *
 * They are deliberately NOT tags. A tag describes a person and only
 * exists while somebody wears it; a list is a place you go, so it has to
 * survive being empty, carry a name you can rename without editing 155
 * records, and be countable before you open it. Membership is stored as
 * list IDS on the contact so a rename never has to touch a contact at
 * all.
 */

export function storeLists(store: PeopleStore): PeopleList[] {
  return store.lists ?? []
}

/** Case- and space-insensitive identity, so one list is not made twice. */
export function listKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function listByIdOrName(
  store: PeopleStore,
  idOrName: string,
): PeopleList | undefined {
  const key = listKey(idOrName)
  if (!key) return undefined
  return storeLists(store).find(
    list => list.id === idOrName.trim() || listKey(list.name) === key,
  )
}

/** Creates the list, or returns the existing one of that name. */
export function createList(
  store: PeopleStore,
  name: string,
  now = new Date().toISOString(),
): { store: PeopleStore; list: PeopleList } {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A list needs a name.')
  const existing = listByIdOrName(store, trimmed)
  if (existing) return { store, list: existing }
  const list: PeopleList = {
    id: `list_${listKey(trimmed).replace(/[^a-z0-9]+/g, '-').slice(0, 32)}_${crypto.randomUUID()}`,
    name: trimmed,
    createdAt: now,
  }
  return {
    store: { ...store, lists: [...storeLists(store), list], updatedAt: now },
    list,
  }
}

/**
 * Rename by id. A blank name, or one another list already answers to
 * (case/space-insensitively), leaves the store untouched — two lists
 * resolving to the same name would make every by-name lookup ambiguous.
 * Callers wanting to explain the refusal check `listByIdOrName` first.
 */
export function renameList(
  store: PeopleStore,
  listId: string,
  name: string,
  now = new Date().toISOString(),
): PeopleStore {
  const trimmed = name.trim()
  if (!trimmed) return store
  const taken = listByIdOrName(store, trimmed)
  if (taken && taken.id !== listId) return store
  return {
    ...store,
    lists: storeLists(store).map(list =>
      list.id === listId ? { ...list, name: trimmed } : list,
    ),
    updatedAt: now,
  }
}

/**
 * Drops the list and everyone's membership of it. The PEOPLE are never
 * touched — deleting "investors" must not delete investors.
 */
export function removeList(
  store: PeopleStore,
  listId: string,
  now = new Date().toISOString(),
): PeopleStore {
  return {
    ...store,
    lists: storeLists(store).filter(list => list.id !== listId),
    contacts: store.contacts.map(contact =>
      contact.listIds?.includes(listId)
        ? { ...contact, listIds: contact.listIds.filter(id => id !== listId) }
        : contact,
    ),
    updatedAt: now,
  }
}

export function setContactLists(
  store: PeopleStore,
  contactId: string,
  listIds: string[],
  now = new Date().toISOString(),
): PeopleStore {
  const known = new Set(storeLists(store).map(list => list.id))
  const clean = [...new Set(listIds.filter(id => known.has(id)))]
  return {
    ...store,
    contacts: store.contacts.map(contact =>
      contact.id === contactId
        ? { ...contact, listIds: clean, updatedAt: now }
        : contact,
    ),
    updatedAt: now,
  }
}

/** Add people to a list, creating the list by name when it is new. */
export function addToList(
  store: PeopleStore,
  listName: string,
  contactIds: string[],
  now = new Date().toISOString(),
): PeopleStore {
  const created = createList(store, listName, now)
  const listId = created.list.id
  const wanted = new Set(contactIds)
  return {
    ...created.store,
    contacts: created.store.contacts.map(contact =>
      wanted.has(contact.id) && !contact.listIds?.includes(listId)
        ? { ...contact, listIds: [...(contact.listIds ?? []), listId] }
        : contact,
    ),
    updatedAt: now,
  }
}

export function removeFromList(
  store: PeopleStore,
  listId: string,
  contactId: string,
  now = new Date().toISOString(),
): PeopleStore {
  return {
    ...store,
    contacts: store.contacts.map(contact =>
      contact.id === contactId
        ? {
            ...contact,
            listIds: (contact.listIds ?? []).filter(id => id !== listId),
          }
        : contact,
    ),
    updatedAt: now,
  }
}

export function contactInList(contact: ContactRecord, listId: string): boolean {
  return (contact.listIds ?? []).includes(listId)
}

/** How many people each list holds, keyed by list id. */
export function listCounts(store: PeopleStore): Map<string, number> {
  const counts = new Map<string, number>()
  for (const list of storeLists(store)) counts.set(list.id, 0)
  for (const contact of store.contacts) {
    for (const id of contact.listIds ?? []) {
      if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return counts
}

/** The lists a person belongs to, in the store's own order. */
export function listsForContact(
  store: PeopleStore,
  contact: ContactRecord,
): PeopleList[] {
  const ids = new Set(contact.listIds ?? [])
  return storeLists(store).filter(list => ids.has(list.id))
}

/**
 * After an import, file each imported person onto the lists the file
 * named for them, then onto one extra list when the user chose to import
 * into the open one. People are resolved by ADDRESS through the store:
 * an imported address may have merged into an existing record whose id is
 * a different email, and membership belongs on that record.
 */
export function fileImportedContacts(
  store: PeopleStore,
  imported: { email: string; lists?: string[] }[],
  extraList?: string,
  now = new Date().toISOString(),
): PeopleStore {
  let next = store
  const resolve = (email: string): string | null =>
    contactByIdOrEmail(next, email)?.id ?? null
  for (const entry of imported) {
    const id = resolve(entry.email)
    if (!id) continue
    for (const name of entry.lists ?? []) {
      if (name.trim()) next = addToList(next, name, [id], now)
    }
  }
  if (extraList?.trim()) {
    const ids = imported
      .map(entry => resolve(entry.email))
      .filter((id): id is string => Boolean(id))
    next = addToList(next, extraList, ids, now)
  }
  return next
}
