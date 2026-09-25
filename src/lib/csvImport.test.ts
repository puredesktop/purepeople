import { describe, expect, it } from 'vitest'
import { emptyPeopleStore, mergeFeedEntry, upsertContact } from './contactsModel'
import { parseContactsCsv, parseCsv } from './csvImport'

const NOW = '2026-08-24T12:00:00.000Z'

const HUBSPOT_CSV = `"Record ID","First Name","Last Name","Email","Phone Number","Lead Status","Favorite Content Topics","Preferred channels","Create Date"
"100000000001","Casey","Example","casey@company-a.example","","In Progress","","","2020-01-10 10:00"
"100000000002","Robin","Example","","","Open","","","2020-01-11 10:00"
"100000000003","EXAMPLE, Jordan","","jordan.example@company-b.example","","Open","","","2020-01-10 10:01"
"100000000004","Example,","Cameron","","","","","","2020-01-12 10:00"
"100000000005","HubSpot","&lt;noreply@notifications.hubspot.com&gt;","noreply@notifications.hubspot.com","","","","","2020-01-11 10:01"
"100000000006","""Taylor","Example (Google Docs)"" &lt;comments-noreply@docs.google.com&gt;","comments-noreply@docs.google.com","","","","","2020-01-11 10:02"
"100000000007","Morgan","Example","morgan.example@publisher-c.example"," +12025550123","","","","2020-01-10 10:00"
"100000000008","Sam","Example (Sample Contact)","sample-contact@example.invalid","","","","","2020-01-10 10:02"
"100000000009","Taylor","Example","taylor@consultant.example","","In Progress","open science; publishing","email","2020-01-10 10:00"
`

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, and CRLF', () => {
    const rows = parseCsv('"a","b ""q""",c\r\n"1,2",3,')
    expect(rows).toEqual([
      ['a', 'b "q"', 'c'],
      ['1,2', '3', ''],
    ])
  })
})

describe('parseContactsCsv — HubSpot profile', () => {
  const result = parseContactsCsv(HUBSPOT_CSV, NOW)

  it('detects the profile and keeps only usable people rows', () => {
    expect(result.profile).toBe('hubspot')
    expect(result.entries.map(entry => entry.contact.email)).toEqual([
      'casey@company-a.example',
      'jordan.example@company-b.example',
      'morgan.example@publisher-c.example',
      'taylor@consultant.example',
    ])
    expect(result.skipped.map(skip => skip.reason)).toEqual([
      'no email',
      'no email',
      'machine address',
      'machine address',
      'sample contact',
    ])
  })

  it('flips Last, First names and maps the CRM columns', () => {
    const harry = result.entries[1]!
    expect(harry.contact.name).toBe('Jordan EXAMPLE')
    const ken = result.entries[0]!
    expect(ken.contact.status).toBe('In Progress')
    expect(ken.seenAt).toBe('2020-01-10T10:00:00.000Z')
    const andrew = result.entries[2]!
    expect(andrew.contact.phones).toEqual(['+12025550123'])
    const laura = result.entries[3]!
    expect(laura.contact.topics).toEqual(['open science', 'publishing'])
    expect(laura.contact.channels).toEqual(['email'])
    expect(laura.sourceApp).toBe('import')
  })

  it('merges into the store without touching curated fields', () => {
    let store = upsertContact(
      emptyPeopleStore(),
      { email: 'taylor@consultant.example', name: 'Taylor Example', org: 'ExampleOrg' },
      'user',
    ).store
    for (const entry of result.entries) store = mergeFeedEntry(store, entry)
    expect(store.contacts).toHaveLength(4)
    const laura = store.contacts.find(c => c.id === 'taylor@consultant.example')!
    expect(laura.org).toBe('ExampleOrg')
    expect(laura.status).toBe('In Progress')
    expect(laura.topics).toEqual(['open science', 'publishing'])
    expect(laura.sources.map(s => s.app)).toContain('import')
  })
})

describe('parseContactsCsv — generic profile', () => {
  it('maps common headers including org, links, and tags', () => {
    const result = parseContactsCsv(
      'Name,Email Address,Company,Job Title,LinkedIn,Tags\n' +
        'Kim Example,KIM@x.example,X Lab,CTO,https://linkedin.com/in/kim,"friend, ai"\n',
      NOW,
    )
    expect(result.profile).toBe('generic')
    const kim = result.entries[0]!
    expect(kim.contact.email).toBe('kim@x.example')
    expect(kim.contact.name).toBe('Kim Example')
    expect(kim.contact.org).toBe('X Lab')
    expect(kim.contact.title).toBe('CTO')
    expect(kim.contact.links).toEqual([
      { label: 'LinkedIn', url: 'https://linkedin.com/in/kim' },
    ])
    expect(kim.contact.tags).toEqual(['friend', 'ai'])
    expect(kim.seenAt).toBe(NOW)
  })
})
