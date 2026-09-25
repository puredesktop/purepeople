import { describe, expect, it } from 'vitest'
import type { ContactFeedEntry } from '../types'
import {
  contactByIdOrEmail,
  emptyPeopleStore,
  isMachineEmail,
  mergeFeedEntry,
  removeContact,
  searchContacts,
  upsertContact,
} from './contactsModel'

const entry = (over: Partial<ContactFeedEntry['contact']> = {}, at = '2026-08-01T10:00:00.000Z'): ContactFeedEntry => ({
  id: `feed_${Math.random()}`,
  sourceApp: 'mail',
  seenAt: at,
  contact: { email: 'taylor@organization.example', name: 'Taylor Example', ...over },
  context: 'Re: catch up',
})

describe('feed merging', () => {
  it('creates a record from a first sighting', () => {
    const store = mergeFeedEntry(emptyPeopleStore(), entry())
    expect(store.contacts).toHaveLength(1)
    const laura = store.contacts[0]!
    expect(laura.id).toBe('taylor@organization.example')
    expect(laura.name).toBe('Taylor Example')
    expect(laura.seenCount).toBe(1)
    expect(laura.sources[0]).toMatchObject({ app: 'mail', context: 'Re: catch up' })
  })

  it('merges repeat sightings: count, recency, one stamp per app', () => {
    let store = mergeFeedEntry(emptyPeopleStore(), entry())
    store = mergeFeedEntry(store, entry({}, '2026-08-10T10:00:00.000Z'))
    const laura = store.contacts[0]!
    expect(store.contacts).toHaveLength(1)
    expect(laura.seenCount).toBe(2)
    expect(laura.lastSeenAt).toBe('2026-08-10T10:00:00.000Z')
    expect(laura.firstSeenAt).toBe('2026-08-01T10:00:00.000Z')
    expect(laura.sources.filter(s => s.app === 'mail')).toHaveLength(1)
  })

  it('fills empty fields but never a locked one', () => {
    let store = emptyPeopleStore()
    store = upsertContact(store, { email: 'taylor@organization.example', org: 'ExampleOrg' }, 'user').store
    store = mergeFeedEntry(store, entry({ org: 'Somewhere Else', title: 'CTO' }))
    const laura = store.contacts[0]!
    expect(laura.org).toBe('ExampleOrg')
    expect(laura.title).toBe('CTO')
  })

  it('upgrades an address-as-name but respects a real or locked name', () => {
    let store = mergeFeedEntry(emptyPeopleStore(), entry({ name: undefined }))
    expect(store.contacts[0]!.name).toBe('taylor@organization.example')
    store = mergeFeedEntry(store, entry())
    expect(store.contacts[0]!.name).toBe('Taylor Example')
    store = upsertContact(store, { email: 'taylor@organization.example', name: 'Taylor H.' }, 'agent').store
    store = mergeFeedEntry(store, entry({ name: 'Taylor Example-Smith' }))
    expect(store.contacts[0]!.name).toBe('Taylor H.')
  })

  it('joins aliases onto one record', () => {
    let store = mergeFeedEntry(emptyPeopleStore(), entry())
    store = mergeFeedEntry(store, entry({ emails: ['taylor@personal.example'] }))
    expect(store.contacts).toHaveLength(1)
    expect(store.contacts[0]!.emails).toContain('taylor@personal.example')
    // A later sighting of the alias updates the same record.
    store = mergeFeedEntry(store, {
      ...entry({}, '2026-08-12T10:00:00.000Z'),
      contact: { email: 'taylor@personal.example' },
    })
    expect(store.contacts).toHaveLength(1)
    expect(store.contacts[0]!.seenCount).toBe(3)
  })

  it('refuses machine addresses', () => {
    expect(isMachineEmail('no-reply@github.com')).toBe(true)
    expect(isMachineEmail('notifications@github.com')).toBe(true)
    expect(isMachineEmail('taylor@organization.example')).toBe(false)
    const store = mergeFeedEntry(emptyPeopleStore(), {
      ...entry(),
      contact: { email: 'no-reply@x.example', name: 'Robot' },
    })
    expect(store.contacts).toHaveLength(0)
  })
})

describe('curation and search', () => {
  it('upsert locks the fields it sets and can add aliases', () => {
    const { store, contact } = upsertContact(
      emptyPeopleStore(),
      {
        email: 'kim@x.example',
        org: 'X Lab',
        tags: ['collab'],
        addEmails: ['kim@alt.example'],
      },
      'agent',
    )
    expect(contact.lockedFields).toEqual(expect.arrayContaining(['org', 'tags']))
    expect(contact.emails).toEqual(['kim@x.example', 'kim@alt.example'])
    expect(contactByIdOrEmail(store, 'KIM@ALT.example')?.id).toBe('kim@x.example')
  })

  it('ranks by interaction weight then recency', () => {
    let store = emptyPeopleStore()
    for (let i = 0; i < 3; i++) store = mergeFeedEntry(store, entry())
    store = mergeFeedEntry(store, {
      ...entry({}, '2026-08-20T10:00:00.000Z'),
      contact: { email: 'kim@x.example', name: 'Kim' },
    })
    const ranked = searchContacts(store, '')
    expect(ranked[0]!.id).toBe('taylor@organization.example')
    expect(searchContacts(store, 'kim')[0]!.id).toBe('kim@x.example')
    expect(searchContacts(store, 'organization.example')).toHaveLength(1)
  })

  it('removes by any known address', () => {
    let store = upsertContact(
      emptyPeopleStore(),
      { email: 'kim@x.example', addEmails: ['kim@alt.example'] },
      'user',
    ).store
    store = removeContact(store, 'kim@alt.example')
    expect(store.contacts).toHaveLength(0)
  })
})

describe('alias merge via addEmails', () => {
  it('consolidates two records without losing provenance or the name', () => {
    // Morgan exists from mail traffic under his outlook address…
    let store = mergeFeedEntry(emptyPeopleStore(), {
      id: 'f1', sourceApp: 'mail', seenAt: '2026-07-01T10:00:00.000Z',
      contact: { email: 'morgan@outlook.example', name: 'Morgan Example', org: 'Example Company' },
    })
    for (let i = 0; i < 3; i++) {
      store = mergeFeedEntry(store, {
        id: `f${i + 2}`, sourceApp: 'mail', seenAt: '2026-08-01T10:00:00.000Z',
        contact: { email: 'morgan@outlook.example' },
      })
    }
    // …then an agent files his hotmail address as the same person.
    const { store: merged, contact } = upsertContact(
      store,
      { email: 'morgan@hotmail.example', addEmails: ['morgan@outlook.example'] },
      'agent',
      '2026-08-24T10:00:00.000Z',
    )
    expect(merged.contacts).toHaveLength(1)
    expect(contact.name).toBe('Morgan Example')
    expect(contact.org).toBe('Example Company')
    expect(contact.seenCount).toBe(4)
    expect(contact.firstSeenAt).toBe('2026-07-01T10:00:00.000Z')
    expect(contact.emails).toEqual(
      expect.arrayContaining(['morgan@outlook.example', 'morgan@hotmail.example']),
    )
    expect(contact.sources.map(s => s.app)).toEqual(
      expect.arrayContaining(['mail', 'agent']),
    )
  })

  it('merges two existing records, summing counts and unioning locks', () => {
    let store = mergeFeedEntry(emptyPeopleStore(), {
      id: 'f1', sourceApp: 'mail', seenAt: '2026-07-01T10:00:00.000Z',
      contact: { email: 'robin@alternate-org.example', name: 'Robin Example' },
    })
    store = mergeFeedEntry(store, {
      id: 'f2', sourceApp: 'calendar', seenAt: '2026-08-01T10:00:00.000Z',
      contact: { email: 'robin@partners.example', title: 'Partner' },
    })
    store = upsertContact(store, { email: 'robin@partners.example', org: 'Example Partners' }, 'user').store
    const { store: merged, contact } = upsertContact(
      store,
      { email: 'robin@alternate-org.example', addEmails: ['robin@partners.example'] },
      'agent',
      '2026-08-24T10:00:00.000Z',
    )
    expect(merged.contacts).toHaveLength(1)
    expect(contact.name).toBe('Robin Example')
    expect(contact.org).toBe('Example Partners')
    expect(contact.title).toBe('Partner')
    expect(contact.seenCount).toBe(2)
    expect(contact.firstSeenAt).toBe('2026-07-01T10:00:00.000Z')
    expect(contact.lastSeenAt).toBe('2026-08-01T10:00:00.000Z')
    expect(contact.lockedFields).toEqual(expect.arrayContaining(['org']))
    expect(contact.sources.map(s => s.app)).toEqual(
      expect.arrayContaining(['mail', 'calendar', 'user', 'agent']),
    )
  })
})

describe('setEmails', () => {
  it('replaces the address list, ignores invalid, keeps a stable id', () => {
    let store = upsertContact(
      emptyPeopleStore(),
      { email: 'kim@x.example', addEmails: ['kim@alt.example'] },
      'user',
    ).store
    const { store: after, contact } = upsertContact(
      store,
      { email: 'kim@x.example', setEmails: ['kim@new.example', 'not-an-email', 'kim@x.example'] },
      'user',
    )
    expect(contact.id).toBe('kim@x.example')
    expect(contact.emails).toEqual(['kim@new.example', 'kim@x.example'])
    expect(after.contacts).toHaveLength(1)
    // an empty/invalid replacement is ignored — never strand a contact
    const kept = upsertContact(
      after,
      { email: 'kim@x.example', setEmails: ['nope'] },
      'user',
    ).contact
    expect(kept.emails).toEqual(['kim@new.example', 'kim@x.example'])
  })

  it('consolidates when the new list spans another record', () => {
    let store = upsertContact(emptyPeopleStore(), { email: 'a@x.example', name: 'A' }, 'user').store
    store = upsertContact(store, { email: 'b@y.example', org: 'Y Co' }, 'user').store
    const { store: merged, contact } = upsertContact(
      store,
      { email: 'a@x.example', setEmails: ['a@x.example', 'b@y.example'] },
      'user',
    )
    expect(merged.contacts).toHaveLength(1)
    expect(contact.emails).toEqual(['a@x.example', 'b@y.example'])
    expect(contact.org).toBe('Y Co')
  })
})

describe('links', () => {
  it('normalizes, labels, and locks explicit links; feeds fill empty only', () => {
    const { store, contact } = upsertContact(
      emptyPeopleStore(),
      {
        email: 'kim@x.example',
        links: [
          { label: '', url: 'https://www.linkedin.com/in/kim' },
          { label: 'Homepage', url: 'kim.example' }, // dropped: no scheme at model level
          { label: 'dup', url: 'https://www.linkedin.com/in/kim' },
        ],
      },
      'user',
    )
    expect(contact.links).toEqual([
      { label: 'LinkedIn', url: 'https://www.linkedin.com/in/kim' },
    ])
    expect(contact.lockedFields).toContain('links')
    const after = mergeFeedEntry(store, {
      id: 'f1', sourceApp: 'mail', seenAt: '2026-08-01T10:00:00.000Z',
      contact: { email: 'kim@x.example', links: [{ label: 'Other', url: 'https://other.example' }] },
    })
    expect(after.contacts[0]!.links).toEqual([
      { label: 'LinkedIn', url: 'https://www.linkedin.com/in/kim' },
    ])
  })
})

describe('avatar and rich notes', () => {
  it('feeds fill an empty avatar but never a locked one', () => {
    let store = mergeFeedEntry(emptyPeopleStore(), {
      id: 'f1', sourceApp: 'mail', seenAt: '2026-08-01T10:00:00.000Z',
      contact: { email: 'kim@x.example', avatarUrl: 'https://x.example/a.jpg' },
    })
    expect(store.contacts[0]!.avatarUrl).toBe('https://x.example/a.jpg')
    store = upsertContact(store, { email: 'kim@x.example', avatarUrl: 'https://x.example/b.jpg' }, 'agent').store
    store = mergeFeedEntry(store, {
      id: 'f2', sourceApp: 'calendar', seenAt: '2026-08-02T10:00:00.000Z',
      contact: { email: 'kim@x.example', avatarUrl: 'https://x.example/c.jpg' },
    })
    expect(store.contacts[0]!.avatarUrl).toBe('https://x.example/b.jpg')
  })

  it('a plain-notes write replaces stale rich notes', () => {
    let store = upsertContact(
      emptyPeopleStore(),
      { email: 'kim@x.example', notesHtml: '<p><b>rich</b></p>', notes: 'rich' },
      'user',
    ).store
    store = upsertContact(store, { email: 'kim@x.example', notes: 'plain rewrite' }, 'agent').store
    const kim = store.contacts[0]!
    expect(kim.notes).toBe('plain rewrite')
    expect(kim.notesHtml).toBeUndefined()
  })
})
