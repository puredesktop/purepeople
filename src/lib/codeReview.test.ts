import { afterEach, expect, it, vi } from 'vitest'
import { emptyPeopleStore, mergeFeedEntry, upsertContact } from './contactsModel'
import { createList } from './peopleLists'
import { parseCsv, parseImportCsv } from './csvImport'
import { notesTextFromHtml } from './sanitizeNotesHtml'

afterEach(() => vi.restoreAllMocks())
it('edits a stable contact id after replacing its original email without restoring the old address', () => {
  let store = upsertContact(emptyPeopleStore(), { email: 'old@example.org', name: 'Ada' }, 'user').store
  store = upsertContact(store, { email: 'old@example.org', setEmails: ['new@example.org'] }, 'user').store
  store = upsertContact(store, { email: 'old@example.org', title: 'Editor' }, 'user').store
  expect(store.contacts).toHaveLength(1)
  expect(store.contacts[0]).toMatchObject({ id: 'old@example.org', name: 'Ada', title: 'Editor', emails: ['new@example.org'] })
})
it('keeps both list memberships when contacts are consolidated', () => {
  let store = upsertContact(emptyPeopleStore(), { email: 'a@example.org' }, 'user').store
  store = upsertContact(store, { email: 'b@example.org' }, 'user').store
  store.contacts = store.contacts.map((contact, index) => ({ ...contact, listIds: [String(index)] }))
  const merged = upsertContact(store, { email: 'a@example.org', addEmails: ['b@example.org'] }, 'user')
  expect(merged.contact.listIds).toEqual(['0', '1'])
})
it('deduplicates an incoming primary address against a known alias', () => {
  const store = upsertContact(emptyPeopleStore(), { email: 'known@example.org', name: 'Ada' }, 'user').store
  const next = mergeFeedEntry(store, { id: 'feed', sourceApp: 'mail', seenAt: '2026-09-10', contact: { email: 'new@example.org', emails: ['known@example.org'] } })
  expect(next.contacts).toHaveLength(1)
  expect(next.contacts[0].emails).toEqual(['known@example.org', 'new@example.org'])
})
it('imports an Emails-only contact export as people', () => {
  const parsed = parseImportCsv('Name,Emails\nAda,ada@example.org;alias@example.org')
  expect(parsed.kind).toBe('contacts')
  expect(parsed.entries).toHaveLength(1)
  expect(parsed.entries[0]).toMatchObject({ contact: { email: 'ada@example.org', emails: ['alias@example.org'] } })
})
it('refuses truncated quoted CSV rather than importing partial fields', () => {
  expect(() => parseCsv('Name,Email\n"Ada,ada@example.org')).toThrow(/quote/i)
})
it('assigns distinct ids to lists with colliding slugs created in the same millisecond', () => {
  vi.spyOn(Date, 'now').mockReturnValue(123)
  const first = createList(emptyPeopleStore(), 'Research A')
  const second = createList(first.store, 'Research-A')
  expect(second.list.id).not.toBe(first.list.id)
})
it('preserves paragraph and line boundaries in the plain notes mirror', () => {
  expect(notesTextFromHtml('<p>One<br>Two</p><p>Three</p>')).toBe('One\nTwo\nThree')
})
