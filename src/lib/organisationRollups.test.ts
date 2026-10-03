import { expect, it } from 'vitest'
import { organisationRollups, peopleForOrg } from './orgsModel'
import type { ContactRecord, OrgRecord, PeopleStore } from '../types'

function person(id: string, extra: Partial<ContactRecord> = {}): ContactRecord {
  return { id, name: id, emails: [`${id}@shared.example`], sources: [], firstSeenAt: '2025-01-01', lastSeenAt: '2026-09-01', seenCount: 1, updatedAt: '2026-09-01', ...extra }
}
function org(id: string, extra: Partial<OrgRecord> = {}): OrgRecord {
  return { id, name: id, sources: [], firstSeenAt: '2025-01-01', lastSeenAt: '2026-01-01', seenCount: 1, updatedAt: '2026-01-01', ...extra }
}

it('matches the existing join for names, aliases, alternatives, domains and overlapping organisations', () => {
  const orgs = [org('a', { name: 'Example A', aliases: ['Old A'], domains: ['shared.example'] }), org('b', { name: 'Example B', domains: ['shared.example'] }), org('empty')]
  const contacts = [person('one', { org: ' OLD  A ', emails: ['one@shared.example', 'other@shared.example'] }), person('two', { org: 'Unrelated', alternatives: { org: ['Example B'] }, emails: ['two@elsewhere.example'] }), person('three', { org: 'a', emails: [], lastSeenAt: '2026-10-02' })]
  const store: PeopleStore = { storeVersion: 1, updatedAt: '2026-10-02', contacts, orgs }
  const result = organisationRollups(contacts, orgs)
  for (const value of orgs) {
    const members = peopleForOrg(store, value)
    expect(result.counts.get(value.id)).toBe(members.length)
    expect(result.lastSeen.get(value.id)).toBe([value.lastSeenAt, ...members.map(member => member.lastSeenAt)].sort().at(-1))
  }
  expect(result.counts.get('a')).toBe(2)
  expect(result.counts.get('b')).toBe(2)
  expect(result.counts.get('empty')).toBe(0)
})

it('preserves domain matching and the organisation recency when its members are older', () => {
  const value = org('new', { domains: ['shared.example'], lastSeenAt: '2026-10-02' })
  const result = organisationRollups([person('one', { emails: [' ONE@SHARED.EXAMPLE '] })], [value])
  expect(result.counts.get('new')).toBe(1)
  expect(result.lastSeen.get('new')).toBe('2026-10-02')
})
