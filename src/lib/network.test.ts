import { describe, expect, it } from 'vitest'
import type { ContactFeedEntry, EncounterRecord, PeopleStore } from '../types'
import { emptyPeopleStore, mergeFeedEntry } from './contactsModel'
import { acquaintance, boardPeople, briefingText, prepFor, scopeKey, setPrep } from './eventBoard'
import { allTies, networkAround, pathTo, tieLabel, tiesFor } from './network'
import { addToList, createList } from './peopleLists'

const seen = (email: string, name: string, app = 'mail'): ContactFeedEntry => ({ id: `f_${email}`, sourceApp: app, seenAt: '2026-08-01T10:00:00.000Z', contact: { email, name } })
const thread = (id: string, emails: string[], at = '2026-09-01T10:00:00.000Z', kind: EncounterRecord['kind'] = 'thread'): EncounterRecord => ({ id, kind, sourceApp: kind === 'thread' ? 'mail' : 'calendar', subject: `Subject ${id}`, at, emails })

function people(): PeopleStore {
  let store = emptyPeopleStore()
  for (const [email, name] of [['mira@k.example', 'Mira Example'], ['priya@m.example', 'Priya Example'], ['hana@a.example', 'Hana Example'], ['ines@d.example', 'Ines Example'], ['jonas@r.example', 'Jonas Example'], ['chloe@l.example', 'Chloé Example']])
    store = mergeFeedEntry(store, seen(email!, name!))
  return store
}

describe('ties', () => {
  it('connects everyone on the same thread and weighs meetings above threads', () => {
    const store = { ...people(), encounters: [thread('t1', ['mira@k.example', 'priya@m.example']), thread('t2', ['MIRA@k.example', 'priya@m.example', 'hana@a.example']), thread('m1', ['mira@k.example', 'hana@a.example'], '2026-09-10T10:00:00.000Z', 'meeting')] }
    const mira = tiesFor(store, 'mira@k.example')
    expect(mira.map(t => t.contactId)).toEqual(['hana@a.example', 'priya@m.example'])
    expect(tieLabel(mira[0]!)).toBe('1 thread, 1 meeting')
    expect(tieLabel(mira[1]!)).toBe('2 threads')
    expect(mira[0]!.recent[0]).toMatchObject({ id: 'm1', kind: 'meeting' })
  })
  it('ignores unknown addresses, lone participants and mass mailings', () => {
    const crowd = Array.from({ length: 50 }, (_, i) => `p${i}@x.example`)
    const store = { ...people(), encounters: [thread('t1', ['mira@k.example', 'stranger@x.example']), thread('t2', ['mira@k.example', 'priya@m.example', ...crowd])] }
    expect(allTies(store).size).toBe(0)
  })
})

describe('network', () => {
  const store = () => ({ ...people(), encounters: [
    thread('a', ['mira@k.example', 'priya@m.example']), thread('b', ['mira@k.example', 'priya@m.example']), thread('c', ['mira@k.example', 'hana@a.example']),
    thread('d', ['priya@m.example', 'ines@d.example']), thread('e', ['hana@a.example', 'chloe@l.example']), thread('f', ['chloe@l.example', 'jonas@r.example']),
  ] })
  it('puts direct ties in ring 1 and their ties in ring 2, each through its strongest parent', () => {
    const net = networkAround(store(), 'mira@k.example')
    const ring = (n: number) => net.nodes.filter(x => x.ring === n).map(x => x.contact.id).sort()
    expect(ring(1)).toEqual(['hana@a.example', 'priya@m.example'])
    expect(ring(2)).toEqual(['chloe@l.example', 'ines@d.example'])
    expect(pathTo(net, 'chloe@l.example')).toEqual(['mira@k.example', 'hana@a.example', 'chloe@l.example'])
    expect(net.edges.some(e => [e.a, e.b].sort().join() === ['hana@a.example', 'mira@k.example'].join())).toBe(true)
  })
  it('stops at one step, and a scope keeps only the people on the board', () => {
    expect(networkAround(store(), 'mira@k.example', { depth: 1 }).nodes.some(n => n.ring === 2)).toBe(false)
    const scoped = networkAround(store(), 'mira@k.example', { scope: new Set(['priya@m.example', 'ines@d.example']) })
    expect(scoped.nodes.map(n => n.contact.id).sort()).toEqual(['ines@d.example', 'mira@k.example', 'priya@m.example'])
  })
  it('refuses a person who is not there', () => {
    expect(() => networkAround(store(), 'nobody@x.example')).toThrow(/not in PurePeople/)
  })
})

describe('event board', () => {
  it('keeps prep per board, removes it when emptied, and writes a briefing', () => {
    let store = people()
    store = addToList(store, 'Frankfurt Book Fair 2026', ['mira@k.example', 'priya@m.example', 'jonas@r.example'])
    const made = { list: createList(store, 'Frankfurt Book Fair 2026').list }
    const scope = { kind: 'list' as const, listId: made.list.id }, key = scopeKey(scope)
    expect(boardPeople(store, scope)).toHaveLength(3)
    store = setPrep(store, 'mira@k.example', key, { meet: true, note: 'Bring the prototype' })
    store = setPrep(store, 'jonas@r.example', 'search:other fair', { meet: true })
    expect(prepFor(store.contacts.find(c => c.id === 'mira@k.example')!, key)).toMatchObject({ meet: true, note: 'Bring the prototype' })
    expect(prepFor(store.contacts.find(c => c.id === 'jonas@r.example')!, key)).toBeUndefined()
    const text = briefingText(store, scope)
    expect(text).toMatch(/3 people, 1 to meet/)
    expect(text).toMatch(/TO MEET\n\nMira Example[\s\S]*Note: Bring the prototype/)
    store = setPrep(store, 'mira@k.example', key, { meet: false, note: '' })
    expect(store.contacts.find(c => c.id === 'mira@k.example')!.prep).toBeUndefined()
    expect(() => setPrep(store, 'mira@k.example', key, { metAt: 'Thursday' })).toThrow(/date/)
    expect(scopeKey({ kind: 'search', query: '  Frankfurt   Fair ' })).toBe('search:frankfurt fair')
  })
  it('says how well you know someone from where they were seen', () => {
    const store = mergeFeedEntry(mergeFeedEntry(people(), seen('mira@k.example', 'Mira Example', 'calendar')), seen('new@x.example', 'New Person', 'csv'))
    expect(acquaintance(store.contacts.find(c => c.id === 'mira@k.example')!).level).toBe('met')
    expect(acquaintance(store.contacts.find(c => c.id === 'priya@m.example')!).level).toBe('emailed')
    expect(acquaintance(store.contacts.find(c => c.id === 'new@x.example')!).level).toBe('new')
  })
})
