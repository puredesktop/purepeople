import type { ContactRecord, EncounterRecord, PeopleStore } from '../types'

/**
 * Who shares threads and meetings with whom, from the encounters other apps
 * record (PureMail threads, calendar meetings). Two people are connected
 * when both are on the same thread or meeting; the tie's weight is how many
 * they share. The user is never on an encounter (feeding apps leave their
 * own addresses out), so a network is always about other people.
 */

export interface Shared { id: string; kind: EncounterRecord['kind']; subject?: string; at: string }
export interface Tie {
  /** The other person. */
  contactId: string
  threads: number
  meetings: number
  lastAt: string
  /** The most recent shared threads and meetings, newest first. */
  recent: Shared[]
}

const RECENT = 5
/** Threads or meetings with more people than this are broadcasts, not relationships. */
export const MAX_PARTICIPANTS = 40

/** Every address a contact answers to, lowercased, mapped to its id. */
function addressIndex(store: PeopleStore): Map<string, string> {
  const index = new Map<string, string>()
  for (const contact of store.contacts) for (const email of contact.emails) index.set(email.trim().toLowerCase(), contact.id)
  return index
}

/** All ties in the store: contact id → (other contact id → tie). */
export function allTies(store: PeopleStore): Map<string, Map<string, Tie>> {
  const byAddress = addressIndex(store)
  const ties = new Map<string, Map<string, Tie>>()
  const link = (a: string, b: string, encounter: EncounterRecord) => {
    let row = ties.get(a)
    if (!row) ties.set(a, row = new Map())
    let tie = row.get(b)
    if (!tie) row.set(b, tie = { contactId: b, threads: 0, meetings: 0, lastAt: encounter.at, recent: [] })
    if (encounter.kind === 'meeting') tie.meetings++
    else tie.threads++
    if (encounter.at > tie.lastAt) tie.lastAt = encounter.at
    tie.recent.push({ id: encounter.id, kind: encounter.kind, ...(encounter.subject ? { subject: encounter.subject } : {}), at: encounter.at })
  }
  for (const encounter of store.encounters ?? []) {
    // A mass mailing says little about who knows whom: count everyone on it, known or not.
    if (new Set(encounter.emails.map(email => email.trim().toLowerCase())).size > MAX_PARTICIPANTS) continue
    // One person with two addresses on a thread is still one person.
    const ids = [...new Set(encounter.emails.map(email => byAddress.get(email.trim().toLowerCase())).filter((id): id is string => !!id))]
    if (ids.length < 2) continue
    for (const a of ids) for (const b of ids) if (a !== b) link(a, b, encounter)
  }
  for (const row of ties.values()) for (const tie of row.values()) tie.recent = tie.recent.sort((x, y) => y.at.localeCompare(x.at)).slice(0, RECENT)
  return ties
}

export const tieWeight = (tie: Tie) => tie.threads + tie.meetings * 2

/** One person's ties, strongest first. */
export function tiesFor(store: PeopleStore, contactId: string, ties = allTies(store)): Tie[] {
  return [...(ties.get(contactId)?.values() ?? [])].sort((a, b) => tieWeight(b) - tieWeight(a) || b.lastAt.localeCompare(a.lastAt))
}

/** "4 threads, 2 meetings". */
export function tieLabel(tie: Pick<Tie, 'threads' | 'meetings'>): string {
  const parts = [tie.threads ? `${tie.threads} thread${tie.threads === 1 ? '' : 's'}` : '', tie.meetings ? `${tie.meetings} meeting${tie.meetings === 1 ? '' : 's'}` : ''].filter(Boolean)
  return parts.join(', ') || 'no shared threads'
}

export interface NetworkNode { contact: ContactRecord; ring: 0 | 1 | 2; parentId?: string; angle: number; inScope: boolean }
export interface NetworkEdge { a: string; b: string; tie: Tie }
export interface Network { centerId: string; nodes: NetworkNode[]; edges: NetworkEdge[]; hidden: number }

/**
 * The network around one person: the people they share threads with (ring
 * 1) and, with depth 2, the people those share threads with (ring 2), each
 * reached through its strongest ring-1 tie. `scope` limits who is shown
 * (e.g. the people on an event board); the centre always shows. Rings are
 * capped so the drawing stays readable; `hidden` counts what was left out.
 */
export function networkAround(store: PeopleStore, centerId: string, options: { depth?: 1 | 2; scope?: Set<string>; maxRing1?: number; maxRing2?: number } = {}): Network {
  const ties = allTies(store)
  const depth = options.depth ?? 2, maxRing1 = options.maxRing1 ?? 12, maxRing2 = options.maxRing2 ?? 18
  const contact = (id: string) => store.contacts.find(c => c.id === id)
  const center = contact(centerId)
  if (!center) throw new Error('That person is not in PurePeople.')
  const inScope = (id: string) => !options.scope || options.scope.has(id)
  const direct = tiesFor(store, centerId, ties)
  const ring1All = direct.filter(t => inScope(t.contactId))
  const ring1 = ring1All.slice(0, maxRing1)
  const seen = new Set([centerId, ...ring1.map(t => t.contactId)])
  const ring2: { id: string; parentId: string; weight: number }[] = []
  let hidden = ring1All.length - ring1.length
  if (depth === 2) {
    const best = new Map<string, { parentId: string; weight: number }>()
    for (const t1 of ring1) for (const t2 of tiesFor(store, t1.contactId, ties)) {
      if (seen.has(t2.contactId) || !inScope(t2.contactId)) continue
      const current = best.get(t2.contactId)
      if (!current || tieWeight(t2) > current.weight) best.set(t2.contactId, { parentId: t1.contactId, weight: tieWeight(t2) })
    }
    const ranked = [...best.entries()].sort((a, b) => b[1].weight - a[1].weight)
    hidden += Math.max(0, ranked.length - maxRing2)
    for (const [id, info] of ranked.slice(0, maxRing2)) ring2.push({ id, ...info })
  }
  // The circle is shared out by weight: each direct tie gets a sector sized
  // to one slot plus one per person reached through it, sits in its middle,
  // and its second-ring people fill that sector, so paths read outward and
  // no side of the circle crowds while the other stays empty.
  const children = new Map<string, string[]>()
  for (const r of ring2) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r.id])
  const slots = ring1.map(t => 1 + (children.get(t.contactId)?.length ?? 0))
  const total = slots.reduce((a, b) => a + b, 0) || 1
  const nodes: NetworkNode[] = [{ contact: center, ring: 0, angle: 0, inScope: true }]
  let cursor = -90 - (360 * slots[0]! / total) / 2
  ring1.forEach((t, i) => {
    const sector = (360 * slots[i]!) / total
    const angle = cursor + sector / 2
    nodes.push({ contact: contact(t.contactId)!, ring: 1, parentId: centerId, angle, inScope: inScope(t.contactId) })
    const ids = children.get(t.contactId) ?? []
    const step = sector / Math.max(1, ids.length)
    ids.forEach((id, j) => nodes.push({ contact: contact(id)!, ring: 2, parentId: t.contactId, angle: cursor + step * (j + 0.5), inScope: inScope(id) }))
    cursor += sector
  })
  const shown = new Set(nodes.map(n => n.contact.id))
  const edges: NetworkEdge[] = []
  for (const id of shown) for (const tie of ties.get(id)?.values() ?? []) if (shown.has(tie.contactId) && id < tie.contactId) edges.push({ a: id, b: tie.contactId, tie })
  return { centerId, nodes, edges, hidden }
}

/** From the centre to one person: the chain of ids through the rings. */
export function pathTo(network: Network, contactId: string): string[] {
  const parent = new Map(network.nodes.map(n => [n.contact.id, n.parentId]))
  const path: string[] = []
  for (let id: string | undefined = contactId; id; id = parent.get(id)) { path.unshift(id); if (path.length > 4) break }
  return path
}
