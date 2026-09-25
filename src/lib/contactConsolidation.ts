import type { ContactAlternatives, ContactRecord, PeopleStore, PeopleUpdate } from '../types'

export const alternativeFields = ['name', 'org', 'title', 'status', 'avatarUrl'] as const

export function distinct<T>(values: T[], key: (value: T) => string = value => JSON.stringify(value)): T[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const id = key(value)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

/** Preserve differing values around a chosen primary, including paired notes. */
export function retainAlternatives(primary: ContactRecord, ...records: ContactRecord[]): ContactAlternatives {
  const alternatives: ContactAlternatives = {}
  for (const field of alternativeFields) {
    alternatives[field] = distinct(records.flatMap(record => [
      record[field] ?? '', ...(record.alternatives?.[field] ?? []),
    ]).filter(value => value.trim() && value !== primary[field]))
  }
  alternatives.notes = distinct(records.flatMap(record => [
    { notes: record.notes, notesHtml: record.notesHtml }, ...(record.alternatives?.notes ?? []),
  ]).filter(note => (note.notes || note.notesHtml)
    && (note.notes !== primary.notes || note.notesHtml !== primary.notesHtml)),
  note => JSON.stringify([note.notes ?? '', note.notesHtml ?? '']))
  return alternatives
}

/** Pure shared consolidation: the caller chooses identity and primary values. */
export function consolidateContactRecords(survivor: ContactRecord, absorbed: ContactRecord): ContactRecord {
  if (survivor.id === absorbed.id) return survivor
  if (survivor.mergeProgress?.absorbedIds.includes(absorbed.id)) return survivor
  const result = { ...survivor }
  result.mergeProgress = {
    absorbedIds: distinct([...(survivor.mergeProgress?.absorbedIds ?? []), absorbed.id, ...(absorbed.mergeProgress?.absorbedIds ?? [])]),
    pendingIds: distinct([...(survivor.mergeProgress?.pendingIds ?? []), absorbed.id, ...(absorbed.mergeProgress?.pendingIds ?? [])]),
  }
  for (const field of alternativeFields) {
    if (!result[field] && !survivor.lockedFields?.includes(field)) result[field] = absorbed[field] ?? ''
  }
  // Never mix one record's HTML with the other's plain-text note.
  if (!result.notes && !result.notesHtml && !survivor.lockedFields?.includes('notes')) {
    result.notes = absorbed.notes
    result.notesHtml = absorbed.notesHtml
  }
  result.alternatives = retainAlternatives(result, survivor, absorbed)
  result.emails = distinct([...survivor.emails, ...absorbed.emails], email => email.trim().toLowerCase())
  for (const field of ['phones', 'tags', 'topics', 'channels', 'listIds', 'lockedFields'] as const) {
    result[field] = distinct([...(survivor[field] ?? []), ...(absorbed[field] ?? [])])
  }
  // A differently labelled link or a case-sensitive URL path is distinct.
  result.links = distinct([...(survivor.links ?? []), ...(absorbed.links ?? [])])
  result.sources = distinct([...survivor.sources, ...absorbed.sources])
  result.firstSeenAt = [survivor.firstSeenAt, absorbed.firstSeenAt].sort()[0]!
  result.lastSeenAt = [survivor.lastSeenAt, absorbed.lastSeenAt].sort()[1]!
  result.updatedAt = [survivor.updatedAt, absorbed.updatedAt].sort()[1]!
  result.seenCount = survivor.seenCount + absorbed.seenCount
  return result
}

/** Merge two current records once; unrelated records retain object identity. */
export function consolidateContacts(store: PeopleStore, survivorId: string, absorbedId: string, now = new Date().toISOString()): { store: PeopleStore; contact: ContactRecord } {
  const survivor = store.contacts.find(record => record.id === survivorId)
  const absorbed = store.contacts.find(record => record.id === absorbedId)
  if (!survivor || !absorbed || survivorId === absorbedId) throw new Error('Choose two distinct existing contacts.')
  const contact = { ...consolidateContactRecords(survivor, absorbed), updatedAt: now }
  return {
    contact,
    store: { ...store, updatedAt: now, contacts: store.contacts.filter(record => record.id !== absorbedId).map(record => record.id === survivorId ? contact : record) },
  }
}

/** Resolve and validate inside PeopleUpdate so earlier queued edits are included. */
export async function mergeContacts(update: PeopleUpdate, survivorId: string, absorbedId: string): Promise<ContactRecord> {
  const saved = await update(current => {
    const survivor = current.contacts.find(record => record.id === survivorId)
    // Only a durable receipt permits a missing target on a retry.
    if (survivorId !== absorbedId && survivor?.mergeProgress?.absorbedIds.includes(absorbedId)
      && !current.contacts.some(record => record.id === absorbedId)) return current
    return consolidateContacts(current, survivorId, absorbedId).store
  })
  const survivor = saved.contacts.find(record => record.id === survivorId)
  if (!survivor || saved.contacts.some(record => record.id === absorbedId)) {
    throw new Error('Contact merge did not complete.')
  }
  return survivor
}
