import { describe, expect, it } from 'vitest'
import { emptyPeopleStore, upsertContact } from '../lib/contactsModel'
import { addToList } from '../lib/peopleLists'
import type { PeopleStore } from '../types'
import { getEventBoardHandler, getPersonNetworkHandler, setEventPrepHandler } from './eventTools'
import { AgentPeopleToolError } from './handlers'

const NOW = '2026-09-22T09:00:00.000Z'
function context(initial: PeopleStore) {
  const held = { store: initial }
  return { get store() { return held.store }, async setStore(updater: (current: PeopleStore) => PeopleStore) { held.store = updater(held.store); return held.store } }
}
function seeded() {
  let store = emptyPeopleStore(NOW)
  for (const [email, name] of [['mira@k.example', 'Mira Example'], ['priya@m.example', 'Priya Example'], ['jonas@r.example', 'Jonas Example']])
    store = upsertContact(store, { email: email!, name: name!, org: 'Example Press' }, 'user', NOW).store
  store = addToList(store, 'Frankfurt Book Fair 2026', ['mira@k.example', 'priya@m.example'])
  store = { ...store, encounters: [{ id: 't1', kind: 'thread', sourceApp: 'mail', subject: 'Re: peer review pilot', at: NOW, emails: ['mira@k.example', 'priya@m.example'] }, { id: 't2', kind: 'thread', sourceApp: 'mail', at: NOW, emails: ['priya@m.example', 'jonas@r.example'] }] }
  return context(store)
}
const parse = (result: { content: string }) => JSON.parse(result.content)

describe('event board tools', () => {
  it('reads a board by list name, with ties to others on the board', () => {
    const board = parse(getEventBoardHandler(seeded(), { list: 'frankfurt book fair 2026' }))
    expect(board.count).toBe(2)
    const mira = board.people.find((p: { name: string }) => p.name === 'Mira Example')
    expect(mira.connectedOnBoard).toEqual([{ name: 'Priya Example', shared: '1 thread', latest: 'Re: peer review pilot' }])
  })
  it('needs exactly one of list or query, and a real list', () => {
    expect(() => getEventBoardHandler(seeded(), {})).toThrow(AgentPeopleToolError)
    expect(() => getEventBoardHandler(seeded(), { list: 'x', query: 'y' })).toThrow(/exactly one/)
    expect(() => getEventBoardHandler(seeded(), { list: 'Nope' })).toThrow(/No list called "Nope"/)
  })
  it('stars and notes someone for one board only', async () => {
    const ctx = seeded()
    const saved = parse(await setEventPrepHandler(ctx, { list: 'Frankfurt Book Fair 2026', contact: 'mira@k.example', meet: true, note: 'Bring the prototype' }))
    expect(saved.prep).toMatchObject({ meet: true, note: 'Bring the prototype' })
    expect(parse(getEventBoardHandler(ctx, { list: 'Frankfurt Book Fair 2026' })).toMeet).toEqual(['Mira Example'])
    expect(parse(getEventBoardHandler(ctx, { query: 'Example Press' })).toMeet).toEqual([])
    await expect(setEventPrepHandler(ctx, { list: 'Frankfurt Book Fair 2026', contact: 'mira@k.example' })).rejects.toThrow(/at least one/)
  })
  it('finds a path two steps out and says who connects them', () => {
    const net = parse(getPersonNetworkHandler(seeded(), { contact: 'mira@k.example' }))
    const jonas = net.connections.find((c: { name: string }) => c.name === 'Jonas Example')
    expect(jonas).toMatchObject({ steps: 2, via: 'Priya Example', path: ['Mira Example', 'Priya Example', 'Jonas Example'], shared: '1 thread' })
    const scoped = parse(getPersonNetworkHandler(seeded(), { contact: 'mira@k.example', list: 'Frankfurt Book Fair 2026' }))
    expect(scoped.connections.map((c: { name: string }) => c.name)).toEqual(['Priya Example'])
  })
})
