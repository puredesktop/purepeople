import type { ContactRecord, EventPrep, PeopleStore } from '../types'
import { searchContacts } from './contactsModel'
import { listByIdOrName } from './peopleLists'

/**
 * An event board: the people on a list or in a search, laid out to prepare
 * for meeting them. Preparation (a star for someone to meet, a note, when
 * you met) is kept on each person under the board's scope, so the same
 * person can be starred for one fair and not another.
 */

export type BoardScope = { kind: 'list'; listId: string } | { kind: 'search'; query: string }

/** Where a board's prep is kept on each person. */
export function scopeKey(scope: BoardScope): string {
  return scope.kind === 'list' ? scope.listId : `search:${scope.query.trim().toLowerCase().replace(/\s+/g, ' ')}`
}

export function scopeTitle(store: PeopleStore, scope: BoardScope): string {
  if (scope.kind === 'list') return listByIdOrName(store, scope.listId)?.name ?? 'List'
  return `“${scope.query.trim()}”`
}

/** Everyone on the board: the list's people (optionally narrowed by a search), or the search's matches. */
export function boardPeople(store: PeopleStore, scope: BoardScope, query = ''): ContactRecord[] {
  const text = scope.kind === 'search' ? scope.query : query
  return searchContacts(store, text, 2000, scope.kind === 'list' ? scope.listId : null)
}

export const prepFor = (contact: ContactRecord, key: string): EventPrep | undefined => contact.prep?.[key]

/**
 * How well you know someone, from where PurePeople has seen them: a meeting
 * in the calendar beats email, email beats a list you imported.
 */
export function acquaintance(contact: ContactRecord): { level: 'met' | 'emailed' | 'new'; label: string } {
  const apps = new Set(contact.sources.map(s => s.app))
  if (apps.has('calendar')) return { level: 'met', label: 'Met' }
  if (apps.has('mail')) return { level: 'emailed', label: contact.seenCount > 1 ? `Emailed ×${contact.seenCount}` : 'Emailed' }
  return { level: 'new', label: 'New' }
}

/** Set or clear prep for one person on one board. An empty prep is removed, not stored. */
export function setPrep(store: PeopleStore, contactId: string, key: string, patch: Partial<Omit<EventPrep, 'updatedAt'>>, now = new Date().toISOString()): PeopleStore {
  if (!key) throw new Error('A board needs a scope.')
  let found = false
  const contacts = store.contacts.map(contact => {
    if (contact.id !== contactId) return contact
    found = true
    const current = contact.prep?.[key]
    const next: EventPrep = { ...current, ...patch, updatedAt: now }
    if (patch.note !== undefined && !patch.note.trim()) delete next.note
    if (patch.meet === false) delete next.meet
    if (patch.metAt === '') delete next.metAt
    if (patch.metAt && !/^\d{4}-\d{2}-\d{2}$/.test(patch.metAt)) throw new Error('metAt: a date like 2026-10-15.')
    const prep = { ...(contact.prep ?? {}) }
    if (next.meet || next.note || next.metAt) prep[key] = next
    else delete prep[key]
    const { prep: _old, ...rest } = contact
    return Object.keys(prep).length ? { ...rest, prep, updatedAt: now } : { ...rest, updatedAt: now }
  })
  if (!found) throw new Error('That person is not in PurePeople.')
  return { ...store, contacts, updatedAt: now }
}

/** A plain-text briefing: who to meet, why, and what to ask, for printing or pasting. */
export function briefingText(store: PeopleStore, scope: BoardScope): string {
  const key = scopeKey(scope)
  const people = boardPeople(store, scope)
  const meet = people.filter(p => prepFor(p, key)?.meet)
  const line = (p: ContactRecord) => {
    const prep = prepFor(p, key)
    const role = [p.title, p.org].filter(Boolean).join(', ')
    return [`${p.name}${role ? ` — ${role}` : ''}`, p.emails[0] ? `  ${p.emails[0]}` : '', prep?.note ? `  Note: ${prep.note}` : '', `  ${acquaintance(p).label}${p.topics?.length ? ` · ${p.topics.join(', ')}` : ''}`].filter(Boolean).join('\n')
  }
  return [`${scopeTitle(store, scope)} — ${people.length} people, ${meet.length} to meet`, '', ...(meet.length ? ['TO MEET', '', ...meet.map(line), ''] : []), 'EVERYONE ELSE', '', ...people.filter(p => !prepFor(p, key)?.meet).map(line)].join('\n')
}
