import type { AgentToolHandlerResult } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { acquaintance, boardPeople, prepFor, scopeKey, scopeTitle, setPrep, type BoardScope } from '../lib/eventBoard'
import { allTies, networkAround, pathTo, tieLabel, tiesFor } from '../lib/network'
import { listByIdOrName, storeLists } from '../lib/peopleLists'
import { contactByIdOrEmail } from '../lib/contactsModel'
import { AgentPeopleToolError, type PeopleAgentToolContext } from './handlers'

const ok = (payload: unknown): AgentToolHandlerResult => ({ content: JSON.stringify(payload, null, 2) })
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** A board is a list (by name or id) or a search; exactly one. */
function scopeFrom(context: PeopleAgentToolContext, args: Record<string, unknown>): BoardScope {
  const listArg = text(args.list), query = text(args.query)
  if (!!listArg === !!query) throw new AgentPeopleToolError('Give exactly one of list (a list name or id) or query (a search, e.g. an event name).')
  if (query) return { kind: 'search', query }
  const list = listByIdOrName(context.store, listArg)
  if (!list) throw new AgentPeopleToolError(`No list called "${listArg}". Lists: ${storeLists(context.store).map(item => item.name).join(', ') || 'none yet'}`)
  return { kind: 'list', listId: list.id }
}

/** Everyone on an event board with their prep, how the user knows them, and their ties to others on the board. */
export function getEventBoardHandler(context: PeopleAgentToolContext, args: Record<string, unknown>): AgentToolHandlerResult {
  const scope = scopeFrom(context, args), key = scopeKey(scope)
  const people = boardPeople(context.store, scope)
  const onBoard = new Set(people.map(p => p.id)), ties = allTies(context.store)
  const name = (id: string) => context.store.contacts.find(c => c.id === id)?.name ?? id
  return ok({
    board: scopeTitle(context.store, scope), scope: key, count: people.length,
    toMeet: people.filter(p => prepFor(p, key)?.meet).map(p => p.name),
    people: people.slice(0, 200).map(p => {
      const prep = prepFor(p, key)
      return {
        id: p.id, name: p.name, emails: p.emails, ...(p.title ? { title: p.title } : {}), ...(p.org ? { org: p.org } : {}),
        knownAs: acquaintance(p).label, seenCount: p.seenCount, lastSeenAt: p.lastSeenAt,
        recentContext: p.sources.slice(0, 3).map(s => ({ app: s.app, at: s.at, ...(s.context ? { context: s.context } : {}) })),
        ...(p.topics?.length ? { topics: p.topics } : {}), ...(p.tags?.length ? { tags: p.tags } : {}),
        ...(prep?.meet ? { wantToMeet: true } : {}), ...(prep?.note ? { note: prep.note } : {}), ...(prep?.metAt ? { metAt: prep.metAt } : {}),
        connectedOnBoard: tiesFor(context.store, p.id, ties).filter(t => onBoard.has(t.contactId)).slice(0, 8).map(t => ({ name: name(t.contactId), shared: tieLabel(t), ...(t.recent[0]?.subject ? { latest: t.recent[0].subject } : {}) })),
      }
    }),
    ...(people.length > 200 ? { truncated: `${people.length - 200} more not listed; narrow with a query` } : {}),
  })
}

/** Star someone to meet, write a note for the event, or record that they were met. Only for this board. */
export async function setEventPrepHandler(context: PeopleAgentToolContext, args: Record<string, unknown>): Promise<AgentToolHandlerResult> {
  const scope = scopeFrom(context, args), key = scopeKey(scope)
  const contact = contactByIdOrEmail(context.store, text(args.contact))
  if (!contact) throw new AgentPeopleToolError(`No person "${text(args.contact)}". Use an id or email from getEventBoard.`)
  const patch: { meet?: boolean; note?: string; metAt?: string } = {}
  if (typeof args.meet === 'boolean') patch.meet = args.meet
  if (typeof args.note === 'string') patch.note = args.note
  if (typeof args.metAt === 'string') patch.metAt = args.metAt.trim()
  if (!Object.keys(patch).length) throw new AgentPeopleToolError('Set at least one of meet, note or metAt (YYYY-MM-DD, or "" to clear).')
  const after = await context.setStore(current => setPrep(current, contact.id, key, patch))
  const saved = after.contacts.find(c => c.id === contact.id)
  return ok({ board: scopeTitle(after, scope), person: contact.name, prep: saved ? prepFor(saved, key) ?? null : null })
}

/** Who a person shares threads and meetings with, one or two steps out, and the path to each. */
export function getPersonNetworkHandler(context: PeopleAgentToolContext, args: Record<string, unknown>): AgentToolHandlerResult {
  const contact = contactByIdOrEmail(context.store, text(args.contact))
  if (!contact) throw new AgentPeopleToolError(`No person "${text(args.contact)}". Use an id or email from listContacts or getEventBoard.`)
  const depth = args.depth === 1 ? 1 : 2
  let scope: Set<string> | undefined
  if (text(args.list) || text(args.query)) scope = new Set(boardPeople(context.store, scopeFrom(context, args)).map(p => p.id))
  const network = networkAround(context.store, contact.id, { depth, scope })
  const name = (id: string) => network.nodes.find(n => n.contact.id === id)?.contact.name ?? id
  const tieBetween = (a: string, b: string) => network.edges.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))?.tie
  return ok({
    person: contact.name,
    note: network.nodes.length === 1 ? 'No shared threads or meetings recorded yet: connections come from the threads and meetings Mail and Calendar report.' : undefined,
    connections: network.nodes.filter(n => n.ring > 0).map(n => {
      const path = pathTo(network, n.contact.id), parent = path[path.length - 2]!
      const tie = tieBetween(parent, n.contact.id)
      return { name: n.contact.name, id: n.contact.id, ...(n.contact.org ? { org: n.contact.org } : {}), steps: n.ring, via: n.ring === 2 ? name(parent) : undefined,
        path: path.map(name), shared: tie ? tieLabel(tie) : undefined, latest: tie?.recent.slice(0, 3).map(r => ({ kind: r.kind, at: r.at, ...(r.subject ? { subject: r.subject } : {}) })) }
    }),
    ...(network.hidden ? { notShown: network.hidden } : {}),
  })
}
