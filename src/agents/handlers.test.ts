import { describe, expect, it } from 'vitest'
import { emptyPeopleStore, upsertContact } from '../lib/contactsModel'
import type { PeopleStore } from '../types'
import {
  AgentPeopleToolError,
  getContactHandler,
  listContactsHandler,
  prepareProfilePhotoResearchHandler,
  upsertContactHandler,
  mergeContactsHandler,
  type PeopleAgentToolContext,
} from './handlers'

function makeContext(initial?: PeopleStore): PeopleAgentToolContext & {
  current(): PeopleStore
} {
  let store =
    initial ??
    upsertContact(
      emptyPeopleStore(),
      { email: 'taylor@organization.example', name: 'Taylor Example', org: 'ExampleOrg' },
      'user',
    ).store
  return {
    get store() {
      return store
    },
    async setStore(updater) {
      store = updater(store)
      return store
    },
    current: () => store,
  }
}

const parse = (result: { content: string }) => JSON.parse(result.content)

describe('purepeople agent tools', () => {
  it('lists and searches, ranked, with summaries', () => {
    const context = makeContext()
    const all = parse(listContactsHandler(context, {}))
    expect(all.total).toBe(1)
    expect(all.contacts[0]).toMatchObject({
      id: 'taylor@organization.example',
      org: 'ExampleOrg',
    })
    expect(parse(listContactsHandler(context, { query: 'nobody' })).returned).toBe(0)
  })

  it('reads one full record by any address', () => {
    const context = makeContext()
    const record = parse(getContactHandler(context, { idOrEmail: 'TAYLOR@organization.example' }))
    expect(record.name).toBe('Taylor Example')
    expect(() => getContactHandler(context, { idOrEmail: 'ghost@x' })).toThrow(
      AgentPeopleToolError,
    )
  })

  it('prepares bounded photo research without mutating the record', () => {
    const context = makeContext()
    const brief = parse(prepareProfilePhotoResearchHandler(context, {
      contact: 'taylor@organization.example',
      mode: 'light',
    }))
    expect(brief).toMatchObject({
      mode: 'light',
      contact: { id: 'taylor@organization.example', name: 'Taylor Example' },
    })
    expect(brief.searchBudget).toContain('two targeted lookups')
    expect(context.current().contacts[0]?.avatarUrl).toBeUndefined()
  })

  it('upserts with locking', async () => {
    const context = makeContext()
    const result = parse(
      await upsertContactHandler(context, {
        email: 'taylor@organization.example',
        title: 'CTO',
        tags: ['collab'],
      }),
    )
    expect(result.saved.title).toBe('CTO')
    const stored = context.current().contacts[0]!
    expect(stored.lockedFields).toEqual(expect.arrayContaining(['title', 'tags']))
  })
})

describe('agent record views', () => {
  it('replaces an uploaded avatar and the rich-notes mirror with flags', async () => {
    const context = makeContext()
    await upsertContactHandler(context, {
      email: 'taylor@organization.example',
      avatarUrl: 'data:image/jpeg;base64,AAAA',
      notes: 'plain',
    })
    const record = parse(getContactHandler(context, { idOrEmail: 'taylor@organization.example' }))
    expect(record.hasAvatar).toBe(true)
    expect(record.avatarUrl).toBeUndefined()
    expect(record.notesHtml).toBeUndefined()
    expect(record.notes).toBe('plain')
  })

  it('keeps a web avatar URL, which the model can reason about', async () => {
    const context = makeContext()
    await upsertContactHandler(context, {
      email: 'taylor@organization.example',
      avatarUrl: 'https://example.com/laura.jpg',
    })
    const record = parse(getContactHandler(context, { idOrEmail: 'taylor@organization.example' }))
    expect(record.avatarUrl).toBe('https://example.com/laura.jpg')
    expect(record.hasAvatar).toBeUndefined()
  })
})

it('merges current records and returns retained alternatives without uploaded bytes', async () => {
  const context = makeContext()
  await upsertContactHandler(context, { email: 'other@x', name: 'Other', avatarUrl: 'data:image/jpeg;base64,SECRET', notes: 'Other note' })
  const result = await mergeContactsHandler(context, { survivorId: 'taylor@organization.example', absorbedId: 'other@x' })
  expect(result.content).not.toContain('SECRET')
  expect(parse(result).saved.alternatives.name).toEqual(['Other'])
  expect(parse(result).saved.hasAvatar).toBe(true)
  expect(context.current().contacts).toHaveLength(1)
})
