import { describe, expect, it } from 'vitest'
import { emptyPeopleStore, upsertContact } from './contactsModel'
import { parseImportCsv, parseOrgsCsv } from './csvImport'
import {
  mergeOrgImportEntry,
  orgByIdOrName,
  peopleForOrg,
  upsertOrg,
} from './orgsModel'

const NOW = '2026-08-24T12:00:00.000Z'

const COMPANIES_CSV = `"Record ID","Company name","Company owner","Create Date","Phone Number","Last Activity Date","City","Country/Region","Industry"
"200000000001","Example Publishing","","2020-01-10 10:00"," +12025550124","2020-01-05 10:00","Example City","United States","Publishing"
"200000000002","ExampleOrg","","2020-01-10 10:00","","2020-01-08 10:00","Example City","United States","Information Services"
"200000000003","","","2020-01-10 10:01","","2020-01-02 10:00","","",""
"200000000004","HubSpot","","2020-01-10 10:02","","2020-01-13 10:00","","",""
"200000000005","HubSpot","","2020-01-11 10:03","","","","",""
`

describe('org CSV import', () => {
  it('auto-detects companies (no email column) vs contacts', () => {
    expect(parseImportCsv(COMPANIES_CSV, NOW).kind).toBe('orgs')
    expect(
      parseImportCsv('First Name,Email\nKim,kim@x.example\n', NOW).kind,
    ).toBe('contacts')
  })

  it('maps the HubSpot company columns and skips empty names', () => {
    const result = parseOrgsCsv(COMPANIES_CSV, NOW)
    expect(result.profile).toBe('hubspot')
    expect(result.entries).toHaveLength(4)
    expect(result.skippedRows).toEqual([4])
    const examplePublishing = result.entries[0]!
    expect(examplePublishing.name).toBe('Example Publishing')
    expect(examplePublishing.industry).toBe('Publishing')
    expect(examplePublishing.city).toBe('Example City')
    expect(examplePublishing.country).toBe('United States')
    expect(examplePublishing.phones).toEqual(['+12025550124'])
    expect(examplePublishing.seenAt).toBe('2020-01-10T10:00:00.000Z')
    expect(examplePublishing.lastActivityAt).toBe('2020-01-05T10:00:00.000Z')
  })

  it('dedupes within the file by normalized name (fill-empty merge)', () => {
    const result = parseOrgsCsv(COMPANIES_CSV, NOW)
    let store = emptyPeopleStore()
    for (const entry of result.entries) store = mergeOrgImportEntry(store, entry)
    expect(store.orgs).toHaveLength(3)
    const hubspot = orgByIdOrName(store, 'HubSpot')!
    expect(hubspot.seenCount).toBe(2)
  })
})

describe('org curation and linking', () => {
  it('upsert locks fields against imports; rename keeps identity', () => {
    let store = upsertOrg(
      emptyPeopleStore(),
      { name: 'ExampleOrg', industry: 'Open source' },
      'user',
    ).store
    store = mergeOrgImportEntry(store, {
      name: 'exampleorg',
      seenAt: NOW,
      industry: 'Information Services',
      city: 'Example City',
    })
    const exampleorg = orgByIdOrName(store, 'ExampleOrg')!
    expect(store.orgs).toHaveLength(1)
    expect(exampleorg.industry).toBe('Open source')
    expect(exampleorg.city).toBe('Example City')
    const renamed = upsertOrg(
      store,
      { name: 'ExampleOrg', rename: 'Example Foundation' },
      'user',
    )
    expect(renamed.org.id).toBe('exampleorg')
    expect(renamed.org.name).toBe('Example Foundation')
  })

  it('links people by org text (name or alias) and by email domain', () => {
    let store = emptyPeopleStore()
    store = upsertContact(
      store,
      { email: 'taylor@consultant.example', org: 'Example Foundation' },
      'user',
    ).store
    store = upsertContact(store, { email: 'kim@organization.example' }, 'user').store
    store = upsertContact(store, { email: 'sam@other.example' }, 'user').store
    store = upsertOrg(store, { name: 'ExampleOrg' }, 'user').store
    const exampleorg = () => orgByIdOrName(store, 'ExampleOrg')!
    expect(peopleForOrg(store, exampleorg())).toHaveLength(0)
    store = upsertOrg(
      store,
      { name: 'ExampleOrg', aliases: ['Example Foundation'] },
      'user',
    ).store
    expect(peopleForOrg(store, exampleorg()).map(c => c.id)).toEqual([
      'taylor@consultant.example',
    ])
    store = upsertOrg(
      store,
      { name: 'ExampleOrg', domains: ['organization.example'] },
      'user',
    ).store
    expect(peopleForOrg(store, exampleorg()).map(c => c.id)).toEqual([
      'taylor@consultant.example',
      'kim@organization.example',
    ])
  })
})
