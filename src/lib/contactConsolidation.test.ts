import { describe, expect, it } from 'vitest'
import type { ContactRecord, PeopleStore } from '../types'
import { consolidateContacts } from './contactConsolidation'
import { emptyPeopleStore, mergeFeedEntry, searchContacts, upsertContact } from './contactsModel'
import { contactsToCsv } from './csvExport'
import { parseContactsCsv } from './csvImport'
import { contactMatchesOrg, upsertOrg } from './orgsModel'
import { agentRecordView, listContactsHandler } from '../agents/handlers'

const date = '2026-08-01T10:00:00.000Z'
function person(n: number): ContactRecord {
  return {
    id: `stable-${n}`, name: `Name ${n}`, emails: [`${n}@example.org`, `alias${n}@example.org`],
    org: `Organisation ${n}`, title: `Role ${n}`, status: `Status ${n}`,
    avatarUrl: `data:image/png;base64,picture${n}`,
    phones: ['shared', `phone${n}`], tags: ['shared', `tag${n}`], topics: [`topic${n}`], channels: [`channel${n}`],
    links: [{ label: `Link ${n}`, url: `https://example.org/${n}` }], listIds: [`list${n}`],
    notes: `Plain ${n}`, notesHtml: `<p><b>Plain ${n}</b></p>`,
    sources: [{ app: 'mail', at: date, context: `Context ${n}` }],
    firstSeenAt: date, lastSeenAt: date, seenCount: n + 1, updatedAt: date,
    lockedFields: ['org', `lock${n}`],
  }
}
function store(...contacts: ContactRecord[]): PeopleStore { return { ...emptyPeopleStore(date), contacts } }

describe('lossless contact consolidation', () => {
  it('preserves populated conflicts, paired notes, collections, provenance and identity', () => {
    const a = person(0), b = person(1), unrelated = person(2)
    b.firstSeenAt = '2025-01-01T00:00:00.000Z'
    b.lastSeenAt = '2026-09-01T00:00:00.000Z'
    b.links = [{ label: 'Another label', url: a.links![0]!.url }]
    const result = consolidateContacts(store(a, b, unrelated), a.id, b.id, date)
    const c = result.contact
    expect(c.id).toBe(a.id)
    expect(c.emails).toEqual([...a.emails, ...b.emails])
    expect(c.name).toBe(a.name)
    for (const field of ['name', 'org', 'title', 'status', 'avatarUrl'] as const) {
      expect(c[field]).toBe(a[field])
      expect(c.alternatives?.[field]).toEqual([b[field]])
    }
    for (const field of ['phones', 'tags', 'topics', 'channels', 'links', 'listIds', 'lockedFields', 'sources'] as const) {
      expect(c[field]).toEqual(expect.arrayContaining([...a[field]!, ...b[field]!]))
    }
    expect(c.notes).toBe(a.notes)
    expect(c.notesHtml).toBe(a.notesHtml)
    expect(c.alternatives?.notes).toEqual([{ notes: b.notes, notesHtml: b.notesHtml }])
    expect(c.firstSeenAt).toBe(b.firstSeenAt)
    expect(c.lastSeenAt).toBe(b.lastSeenAt)
    expect(c.seenCount).toBe(3)
    expect(result.store.contacts[1]).toBe(unrelated)
    expect(a.alternatives).toBeUndefined()
    expect(() => consolidateContacts(result.store, a.id, b.id)).toThrow()
  })

  it.each(['addEmails', 'setEmails'] as const)('%s collisions use the shared operation and preserve all addresses', field => {
    const a = person(0), b = person(1)
    const patch = { email: a.id, [field]: [b.emails[0]!], org: 'Edited', tags: ['new'] }
    const result = upsertContact(store(a, b), patch, 'user', date)
    expect(result.contact.emails).toEqual([...a.emails, ...b.emails])
    expect(result.contact.alternatives?.org).toEqual(expect.arrayContaining([a.org, b.org]))
    expect(result.contact.tags).toEqual(expect.arrayContaining(['new', 'shared', 'tag0', 'tag1']))
    expect(result.contact.seenCount).toBe(3)
    const retry = upsertContact(result.store, { email: a.id, addEmails: [b.emails[0]!] }, 'user', date)
    expect(retry.contact.seenCount).toBe(3)
    expect(retry.contact.alternatives?.notes).toHaveLength(1)
  })

  it('supports legacy records and unbounded repeated merges, followed by edits and feeds', () => {
    let current = store(...Array.from({ length: 20 }, (_, i) => person(i)))
    for (let i = 1; i < 20; i++) current = consolidateContacts(current, 'stable-0', `stable-${i}`, date).store
    let c = current.contacts[0]!
    expect(c.alternatives?.name).toHaveLength(19)
    expect(c.alternatives?.notes).toHaveLength(19)
    expect(c.sources).toHaveLength(20)
    expect(c.seenCount).toBe(210)
    current = upsertContact(current, { email: c.id, name: 'New primary', notes: 'New plain', org: '' }, 'agent', date).store
    c = current.contacts[0]!
    expect(c.alternatives?.name).toHaveLength(20)
    expect(c.alternatives?.notes).toContainEqual({ notes: 'Plain 0', notesHtml: '<p><b>Plain 0</b></p>' })
    expect(c.notesHtml).toBeUndefined()
    current = mergeFeedEntry(current, { id: 'feed', sourceApp: 'mail', seenAt: date, context: 'Context 0', contact: { email: c.emails[0]!, name: 'Feed name', org: 'Feed org', notes: 'Feed note' } })
    c = current.contacts[0]!
    expect(c.name).toBe('New primary')
    expect(c.org).toBe('')
    expect(c.notes).toBe('New plain')
    expect(c.sources).toEqual(expect.arrayContaining(Array.from({ length: 20 }, (_, i) => person(i).sources[0])))
    expect(c.seenCount).toBe(211)
    expect(searchContacts(current, 'Name 19')).toEqual([c])
    expect(searchContacts(current, 'Plain 19')).toEqual([c])
    const org = upsertOrg(current, { name: 'Organisation 19' }, 'user', date).org
    expect(contactMatchesOrg(c, org)).toBe(true)
  })

  it('round-trips alternatives and rich/plain notes, and retains them through subsequent imports', () => {
    const original = consolidateContacts(store(person(0), person(1)), 'stable-0', 'stable-1', date).store
    const entries = parseContactsCsv(contactsToCsv(original), date).entries
    let restored = entries.reduce(mergeFeedEntry, emptyPeopleStore(date))
    expect(restored.contacts[0]!.alternatives).toEqual(original.contacts[0]!.alternatives)
    expect(restored.contacts[0]!.notesHtml).toBe(original.contacts[0]!.notesHtml)
    restored = upsertContact(restored, { email: '0@example.org', name: 'Curated', notes: 'Curated notes' }, 'user', date).store
    restored = entries.reduce(mergeFeedEntry, restored)
    expect(restored.contacts[0]!.name).toBe('Curated')
    expect(restored.contacts[0]!.notes).toBe('Curated notes')
    expect(restored.contacts[0]!.alternatives?.name).toEqual(expect.arrayContaining(['Name 0', 'Name 1']))
    expect(restored.contacts[0]!.alternatives?.notes).toHaveLength(2)
  })

  it('agent views expose alternatives without uploaded image bytes or rich HTML', () => {
    const merged = consolidateContacts(store(person(0), person(1)), 'stable-0', 'stable-1', date)
    const view = agentRecordView(merged.contact)
    expect(view.alternatives?.name).toEqual(['Name 1'])
    expect(view.alternatives?.uploadedPictureCount).toBe(1)
    expect(view.alternatives?.notes).toEqual([{ notes: 'Plain 1', hasRichText: true }])
    expect(JSON.stringify(view)).not.toContain('data:image')
    expect(JSON.stringify(view)).not.toContain('<p>')
    const response = listContactsHandler({ store: merged.store, setStore: async updater => updater(merged.store) }, { query: 'Name 1' })
    expect(response.content).toContain('Name 1')
    expect(response.content).not.toContain('data:image')
  })

  it('handles absent optional fields without mixing rich and plain notes', () => {
    const a: ContactRecord = { id: 'a', name: '', emails: ['a@example.org'], sources: [], firstSeenAt: date, lastSeenAt: date, seenCount: 0, updatedAt: date, notes: 'Only plain', lockedFields: ['org'] }
    const c = consolidateContacts(store(a, person(1)), a.id, 'stable-1', date).contact
    expect(c.name).toBe('Name 1')
    expect(c.org).toBeUndefined()
    expect(c.alternatives?.org).toEqual(['Organisation 1'])
    expect(c.notes).toBe('Only plain')
    expect(c.notesHtml).toBeUndefined()
    expect(c.alternatives?.notes?.[0]?.notesHtml).toBe('<p><b>Plain 1</b></p>')
  })
})
