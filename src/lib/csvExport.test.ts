import { describe, expect, it } from 'vitest'
import { emptyPeopleStore, mergeFeedEntry, upsertContact } from './contactsModel'
import { contactsToCsv, orgsToCsv } from './csvExport'
import { parseImportCsv } from './csvImport'
import { mergeOrgImportEntry, orgByIdOrName, upsertOrg } from './orgsModel'

const NOW = '2026-08-24T12:00:00.000Z'

describe('CSV export → import round trip (backup)', () => {
  it('contacts survive a full round trip', () => {
    let store = upsertContact(
      emptyPeopleStore(NOW),
      {
        email: 'taylor@consultant.example',
        name: 'Taylor, "the" Example', // commas + quotes exercise escaping
        org: 'Example Foundation',
        title: 'Consultant',
        phones: ['+1 555 0100', '+12025550125'],
        tags: ['collab'],
        status: 'In Progress',
        topics: ['open science', 'publishing'],
        channels: ['email'],
        links: [
          { label: 'LinkedIn', url: 'https://example.com/profiles/taylor' },
          { label: 'Homepage', url: 'https://consultant.example' },
        ],
        notes: 'Line one\nLine two',
        addEmails: ['taylor.h@organization.example'],
      },
      'user',
      NOW,
    ).store
    const csv = contactsToCsv(store)
    const parsed = parseImportCsv(csv, NOW)
    expect(parsed.kind).toBe('contacts')
    if (parsed.kind !== 'contacts') return
    expect(parsed.entries).toHaveLength(1)
    let restored = emptyPeopleStore(NOW)
    for (const entry of parsed.entries) restored = mergeFeedEntry(restored, entry)
    const laura = restored.contacts[0]!
    expect(laura.name).toBe('Taylor, "the" Example')
    expect(laura.emails).toEqual([
      'taylor@consultant.example',
      'taylor.h@organization.example',
    ])
    expect(laura.org).toBe('Example Foundation')
    expect(laura.title).toBe('Consultant')
    expect(laura.phones).toEqual(['+1 555 0100', '+12025550125'])
    expect(laura.tags).toEqual(['collab'])
    expect(laura.status).toBe('In Progress')
    expect(laura.topics).toEqual(['open science', 'publishing'])
    expect(laura.channels).toEqual(['email'])
    expect(laura.links).toEqual([
      { label: 'LinkedIn', url: 'https://example.com/profiles/taylor' },
      { label: 'Homepage', url: 'https://consultant.example' },
    ])
    expect(laura.firstSeenAt).toBe('2026-08-24T12:00:00.000Z')
  })

  it('orgs survive a full round trip', () => {
    let store = upsertOrg(
      emptyPeopleStore(NOW),
      {
        name: 'ExampleOrg',
        aliases: ['Example Foundation'],
        industry: 'Information Services',
        owner: 'Alex Example',
        status: 'Active',
        city: 'Example City',
        country: 'United States',
        phones: ['+1 415 555 0100'],
        domains: ['organization.example'],
        tags: ['oss'],
        links: [{ label: 'Homepage', url: 'https://organization.example' }],
        notes: 'Open source publishing',
      },
      'user',
      NOW,
    ).store
    const csv = orgsToCsv(store)
    const parsed = parseImportCsv(csv, NOW)
    expect(parsed.kind).toBe('orgs')
    if (parsed.kind !== 'orgs') return
    let restored = emptyPeopleStore(NOW)
    for (const entry of parsed.entries)
      restored = mergeOrgImportEntry(restored, entry)
    const exampleorg = orgByIdOrName(restored, 'ExampleOrg')!
    expect(exampleorg.name).toBe('ExampleOrg')
    expect(exampleorg.aliases).toEqual(['Example Foundation'])
    expect(exampleorg.industry).toBe('Information Services')
    expect(exampleorg.owner).toBe('Alex Example')
    expect(exampleorg.status).toBe('Active')
    expect(exampleorg.city).toBe('Example City')
    expect(exampleorg.country).toBe('United States')
    expect(exampleorg.phones).toEqual(['+1 415 555 0100'])
    expect(exampleorg.domains).toEqual(['organization.example'])
    expect(exampleorg.tags).toEqual(['oss'])
    expect(exampleorg.links).toEqual([
      { label: 'Homepage', url: 'https://organization.example' },
    ])
    // alias matching still finds the restored record
    expect(orgByIdOrName(restored, 'Example Foundation')?.id).toBe('exampleorg')
  })
})

describe('lists survive the backup round trip', () => {
  it('exports list names and restores membership on import', async () => {
    const { addToList, listByIdOrName, listCounts } = await import('./peopleLists')
    const { upsertContact } = await import('./contactsModel')
    let store = upsertContact(
      emptyPeopleStore(NOW),
      { email: 'ana@publisher.example', name: 'Ana Example' },
      'user',
      NOW,
    ).store
    store = addToList(store, 'publisher.example', ['ana@publisher.example'], NOW)

    const csv = contactsToCsv(store)
    expect(csv).toContain('publisher.example')

    const parsed = parseImportCsv(csv, NOW)
    expect(parsed.kind).toBe('contacts')
    if (parsed.kind !== 'contacts') return
    expect(parsed.entries[0]!.contact.lists).toEqual(['publisher.example'])

    // restoring into an empty store recreates the list and the membership
    let restored = emptyPeopleStore(NOW)
    for (const entry of parsed.entries) {
      restored = mergeFeedEntry(restored, entry)
      for (const name of entry.contact.lists ?? []) {
        restored = addToList(restored, name, [entry.contact.email], NOW)
      }
    }
    const list = listByIdOrName(restored, 'publisher.example')!
    expect(listCounts(restored).get(list.id)).toBe(1)
  })
})
