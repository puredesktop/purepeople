import {
  defineAppFunction,
  type AppFunctionDefinition,
} from '@purescience/platform-ui/bridge/appFunctions'
import {
  contactByIdOrEmail,
  normalizeEmail,
  searchContacts,
  upsertContact,
  type ContactUpsertPatch,
} from '../lib/contactsModel'
import {
  isCalendarDate,
  listCustomers,
  localToday,
  saveCustomer,
} from '../lib/customers'
import {
  acquaintance,
  boardPeople,
  prepFor,
  scopeKey,
  scopeTitle,
  setPrep,
  type BoardScope,
} from '../lib/eventBoard'
import {
  allTies,
  networkAround,
  pathTo,
  tieLabel,
  tiesFor,
} from '../lib/network'
import {
  normalizeDomain,
  orgByIdOrName,
  orgForContact,
  orgKey,
  organisationRollups,
  peopleForOrg,
  searchOrgs,
  storeOrgs,
  upsertOrg,
  type OrgUpsertPatch,
} from '../lib/orgsModel'
import {
  addToList,
  createList,
  listByIdOrName,
  listCounts,
  listsForContact,
  storeLists,
} from '../lib/peopleLists'
import {
  profilePhotoResearchBrief,
  type ProfilePhotoResearchMode,
} from '../lib/profilePhotoResearch'
import type { ContactRecord, OrgRecord, PeopleStore } from '../types'
import {
  AgentPeopleToolError,
  agentRecordView,
  type PeopleAgentToolContext,
} from './handlers'

const FREEMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'fastmail.com',
  'aol.com',
  'hey.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
])

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined

function parseLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(max, Math.floor(value)))
  }
  return fallback
}

function resolveToday(value: unknown): string {
  const raw = text(value)
  if (!raw) return localToday()
  if (!isCalendarDate(raw)) {
    throw new AgentPeopleToolError(
      `Invalid "today" date "${raw}". Supply a real YYYY-MM-DD calendar date.`,
    )
  }
  return raw
}

function resolveOptionalList(store: PeopleStore, raw: unknown) {
  const name = text(raw)
  if (!name) return undefined
  const found = listByIdOrName(store, name)
  if (!found) {
    throw new AgentPeopleToolError(
      `No list called "${name}". Lists: ${
        storeLists(store)
          .map(item => item.name)
          .join(', ') || 'none yet'
      }`,
    )
  }
  return found
}

function customerDueBucket(
  dueDate: string | undefined,
  today: string,
): 'overdue' | 'dueToday' | 'upcoming' | 'noDueDate' {
  if (!dueDate) return 'noDueDate'
  if (dueDate < today) return 'overdue'
  if (dueDate === today) return 'dueToday'
  return 'upcoming'
}

function normalizedNameTokens(name: string): string[] {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function normalizedPhoneDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

function normalizedProfileUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

function emailDomains(contact: ContactRecord): string[] {
  return [
    ...new Set(
      contact.emails
        .map(email => normalizeEmail(email).split('@')[1] ?? '')
        .filter(Boolean),
    ),
  ]
}

interface DuplicateCluster {
  suggestedSurvivorId: string
  candidateAbsorbedIds: string[]
  reasons: string[]
  members: Array<{
    id: string
    name: string
    emails: string[]
    org?: string
    title?: string
    seenCount: number
    hasCustomer: boolean
    lockedFieldCount: number
  }>
}

function survivorScore(contact: ContactRecord): number {
  let populated = 0
  if (contact.org) populated++
  if (contact.title) populated++
  if (contact.phones?.length) populated++
  if (contact.notes?.trim()) populated++
  if (contact.avatarUrl) populated++
  if (contact.links?.length) populated++
  if (contact.tags?.length) populated++
  return (
    (contact.customer ? 100 : 0) +
    contact.seenCount * 2 +
    (contact.lockedFields?.length ?? 0) * 3 +
    populated
  )
}

function detectDuplicateClusters(
  contacts: readonly ContactRecord[],
): DuplicateCluster[] {
  const parent = new Map<string, string>()
  const pairReasons = new Map<string, Set<string>>()

  const find = (id: string): string => {
    let cur = id
    while (parent.get(cur) && parent.get(cur) !== cur) {
      cur = parent.get(cur)!
    }
    let walk = id
    while (parent.get(walk) && parent.get(walk) !== cur) {
      const next = parent.get(walk)!
      parent.set(walk, cur)
      walk = next
    }
    return cur
  }

  const union = (a: string, b: string, reason: string) => {
    if (a === b) return
    const key = a < b ? `${a}\0${b}` : `${b}\0${a}`
    let reasons = pairReasons.get(key)
    if (!reasons) {
      reasons = new Set<string>()
      pairReasons.set(key, reasons)
    }
    reasons.add(reason)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }

  for (const c of contacts) parent.set(c.id, c.id)

  const byFullName = new Map<string, string[]>()
  const byPhone = new Map<string, string[]>()
  const byLink = new Map<string, string[]>()
  const byWorkDomain = new Map<string, ContactRecord[]>()

  for (const c of contacts) {
    const tokens = normalizedNameTokens(c.name)
    if (tokens.length >= 2) {
      const key = tokens.join(' ')
      byFullName.set(key, [...(byFullName.get(key) ?? []), c.id])
    }
    for (const phone of c.phones ?? []) {
      const digits = normalizedPhoneDigits(phone)
      if (digits.length >= 7) {
        byPhone.set(digits, [...(byPhone.get(digits) ?? []), c.id])
      }
    }
    for (const link of c.links ?? []) {
      const norm = normalizedProfileUrl(link.url)
      if (norm.includes('/')) {
        byLink.set(norm, [...(byLink.get(norm) ?? []), c.id])
      }
    }
    for (const domain of emailDomains(c)) {
      if (!FREEMAIL_DOMAINS.has(domain)) {
        byWorkDomain.set(domain, [...(byWorkDomain.get(domain) ?? []), c])
      }
    }
  }

  const linkGroup = (ids: string[], reason: string) => {
    if (ids.length < 2) return
    for (let i = 1; i < ids.length; i++) {
      union(ids[0]!, ids[i]!, reason)
    }
  }

  for (const ids of byFullName.values()) linkGroup(ids, 'same-normalized-name')
  for (const ids of byPhone.values()) linkGroup(ids, 'shared-phone')
  for (const ids of byLink.values()) linkGroup(ids, 'shared-profile-url')

  for (const [domain, members] of byWorkDomain.entries()) {
    if (members.length < 2) continue
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!
        const b = members[j]!
        const ta = normalizedNameTokens(a.name)
        const tb = normalizedNameTokens(b.name)
        if (ta.length >= 2 && tb.length >= 2) {
          const lastA = ta[ta.length - 1]!
          const lastB = tb[tb.length - 1]!
          const firstA = ta[0]!
          const firstB = tb[0]!
          if (
            lastA === lastB &&
            (firstA === firstB ||
              firstA.startsWith(firstB) ||
              firstB.startsWith(firstA))
          ) {
            union(a.id, b.id, `same-domain-similar-name:${domain}`)
          }
        }
      }
    }
  }

  const groups = new Map<string, ContactRecord[]>()
  for (const c of contacts) {
    const root = find(c.id)
    groups.set(root, [...(groups.get(root) ?? []), c])
  }

  const clusters: DuplicateCluster[] = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const ranked = [...members].sort(
      (a, b) =>
        survivorScore(b) - survivorScore(a) ||
        b.lastSeenAt.localeCompare(a.lastSeenAt) ||
        a.id.localeCompare(b.id),
    )
    const reasons = new Set<string>()
    for (let i = 0; i < ranked.length; i++) {
      for (let j = i + 1; j < ranked.length; j++) {
        const a = ranked[i]!.id
        const b = ranked[j]!.id
        const key = a < b ? `${a}\0${b}` : `${b}\0${a}`
        for (const r of pairReasons.get(key) ?? []) reasons.add(r)
      }
    }
    clusters.push({
      suggestedSurvivorId: ranked[0]!.id,
      candidateAbsorbedIds: ranked.slice(1).map(c => c.id),
      reasons: [...reasons].sort(),
      members: ranked.map(c => ({
        id: c.id,
        name: c.name,
        emails: c.emails,
        ...(c.org ? { org: c.org } : {}),
        ...(c.title ? { title: c.title } : {}),
        seenCount: c.seenCount,
        hasCustomer: Boolean(c.customer),
        lockedFieldCount: c.lockedFields?.length ?? 0,
      })),
    })
  }

  return clusters.sort(
    (a, b) =>
      b.members.length - a.members.length ||
      a.suggestedSurvivorId.localeCompare(b.suggestedSurvivorId),
  )
}

interface UnlinkedDomainMatch {
  contactId: string
  contactName: string
  email: string
  currentOrg?: string
  matchedOrgId: string
  matchedOrgName: string
  matchedDomain: string
}

function findUnlinkedDomainMatches(
  contacts: readonly ContactRecord[],
  orgs: readonly OrgRecord[],
): UnlinkedDomainMatch[] {
  const results: UnlinkedDomainMatch[] = []
  for (const org of orgs) {
    if (!org.domains?.length) continue
    const orgDomains = new Set(org.domains.map(normalizeDomain).filter(Boolean))
    for (const contact of contacts) {
      let hitEmail = ''
      let hitDomain = ''
      for (const email of contact.emails) {
        const domain = normalizeEmail(email).split('@')[1] ?? ''
        if (orgDomains.has(domain)) {
          hitEmail = email
          hitDomain = domain
          break
        }
      }
      if (!hitDomain) continue
      const currentOrgKey = contact.org?.trim() ? orgKey(contact.org) : ''
      const alreadyLinked =
        currentOrgKey !== '' &&
        (org.id === currentOrgKey ||
          orgKey(org.name) === currentOrgKey ||
          (org.aliases ?? []).some(alias => orgKey(alias) === currentOrgKey))
      if (!alreadyLinked) {
        results.push({
          contactId: contact.id,
          contactName: contact.name,
          email: hitEmail,
          ...(contact.org?.trim() ? { currentOrg: contact.org } : {}),
          matchedOrgId: org.id,
          matchedOrgName: org.name,
          matchedDomain: hitDomain,
        })
      }
    }
  }
  return results
}

function resolveContactStrictly(
  store: PeopleStore,
  idOrEmail: string,
): ContactRecord {
  const direct = contactByIdOrEmail(store, idOrEmail)
  if (direct) return direct
  const needle = idOrEmail.trim().toLowerCase()
  const exactNameMatches = store.contacts.filter(
    c => c.name.trim().toLowerCase() === needle,
  )
  if (exactNameMatches.length === 1) return exactNameMatches[0]!
  if (exactNameMatches.length > 1) {
    throw new AgentPeopleToolError(
      `Multiple contacts are named "${idOrEmail}": ${exactNameMatches
        .map(c => `${c.name} (${c.id})`)
        .join(', ')}. Pass an exact contact id or email address.`,
    )
  }
  throw new AgentPeopleToolError(
    `No contact matches "${idOrEmail}". Call listContacts to see who exists.`,
  )
}

function resolveBoardScope(
  store: PeopleStore,
  listArg: string,
  queryArg: string,
): BoardScope {
  if (Boolean(listArg) === Boolean(queryArg)) {
    throw new AgentPeopleToolError(
      'Give exactly one of list (a list name or id) or query (a search, e.g. an event name).',
    )
  }
  if (queryArg) return { kind: 'search', query: queryArg }
  const list = resolveOptionalList(store, listArg)!
  return { kind: 'list', listId: list.id }
}

function readableBoardTitle(store: PeopleStore, key: string): string {
  if (key.startsWith('search:')) {
    return `“${key.slice('search:'.length)}”`
  }
  return listByIdOrName(store, key)?.name ?? key
}

// ============================================================================
// Composite App Functions (`fn_*`)
// ============================================================================

export const fn_directoryBriefing = defineAppFunction<PeopleAgentToolContext>({
  name: 'fn_directoryBriefing',
  category: 'briefing',
  risk: 'read',
  requiresApproval: false,
  replaces: ['listContacts', 'listOrgs', 'listLists', 'listCustomers'],
  description:
    'Compile a single-call executive briefing of the PurePeople directory and CRM pipeline: contact/org/list counts, full list roster, tracked customer status & due-date buckets (overdue, due today, upcoming, undated), top ranked contacts, top organisations with computed people counts, staleness metrics, and hygiene flags (duplicate clusters, unlinked org domains). Optionally filter to one list or search query.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Optional search substring to scope contacts, organisations, and customer follow-ups.',
      },
      list: {
        type: 'string',
        description:
          'Optional list name or id to focus the briefing on one curated collection.',
      },
      today: {
        type: 'string',
        description:
          'Optional YYYY-MM-DD reference date for customer follow-up due buckets (defaults to local today).',
      },
      topLimit: {
        type: 'number',
        description:
          'Maximum top contacts and top organisations to include (default 10, max 50).',
      },
      staleDays: {
        type: 'number',
        description:
          'Days since lastSeenAt after which a contact counts as stale (default 180).',
      },
    },
    additionalProperties: false,
  },
  run: async (ctx, args) => {
    const store = ctx.store
    const query = text(args.query)
    const list = resolveOptionalList(store, args.list)
    const today = resolveToday(args.today)
    const topLimit = parseLimit(args.topLimit, 10, 50)
    const staleDays = parseLimit(args.staleDays, 180, 3650)

    const contactScanLimit = Math.max(2000, store.contacts.length)
    const scopedContacts =
      query || list
        ? searchContacts(store, query, contactScanLimit, list ? list.id : null)
        : searchContacts(store, '', contactScanLimit, null)
    const scopedIds = new Set(scopedContacts.map(c => c.id))

    const orgs = storeOrgs(store)
    const rollups = organisationRollups(store.contacts, orgs)
    const matchedOrgs = searchOrgs(store, query, Math.max(2000, orgs.length))

    const counts = listCounts(store)
    const listRoster = storeLists(store).map(item => ({
      id: item.id,
      name: item.name,
      people: counts.get(item.id) ?? 0,
    }))

    const allTracked = listCustomers(store, { today }).filter(c =>
      scopedIds.has(c.id),
    )
    const byStatus = { Lead: 0, Customer: 0, Inactive: 0 }
    const byDue = { overdue: 0, dueToday: 0, upcoming: 0, noDueDate: 0 }
    for (const c of allTracked) {
      const profile = c.customer!
      byStatus[profile.status]++
      byDue[customerDueBucket(profile.dueDate, today)]++
    }
    const urgentFollowUps = allTracked
      .filter(c => {
        const bucket = customerDueBucket(c.customer?.dueDate, today)
        return bucket === 'overdue' || bucket === 'dueToday'
      })
      .slice(0, topLimit)
      .map(c => ({
        id: c.id,
        name: c.name,
        ...(c.org ? { org: c.org } : {}),
        status: c.customer!.status,
        dueDate: c.customer!.dueDate,
        bucket: customerDueBucket(c.customer!.dueDate, today),
        ...(c.customer!.nextAction ? { nextAction: c.customer!.nextAction } : {}),
      }))

    const cutoffMs = Date.parse(`${today}T00:00:00.000Z`) - staleDays * 86_400_000
    let staleCount = 0
    let missingOrg = 0
    let missingTitle = 0
    let missingAvatar = 0
    for (const c of scopedContacts) {
      const seenMs = Date.parse(c.lastSeenAt)
      if (Number.isFinite(seenMs) && seenMs < cutoffMs) staleCount++
      if (!c.org?.trim()) missingOrg++
      if (!c.title?.trim()) missingTitle++
      if (!c.avatarUrl) missingAvatar++
    }

    const duplicateClusters = detectDuplicateClusters(scopedContacts)
    const unlinkedDomains = findUnlinkedDomainMatches(scopedContacts, orgs)

    const topContacts = scopedContacts.slice(0, topLimit).map(c => ({
      id: c.id,
      name: c.name,
      emails: c.emails,
      ...(c.org ? { org: c.org } : {}),
      ...(c.title ? { title: c.title } : {}),
      knownAs: acquaintance(c).label,
      seenCount: c.seenCount,
      lastSeenAt: c.lastSeenAt,
      lists: listsForContact(store, c).map(item => item.name),
      ...(c.customer
        ? {
            customerStatus: c.customer.status,
            ...(c.customer.dueDate ? { dueDate: c.customer.dueDate } : {}),
          }
        : {}),
    }))

    const topOrgs = matchedOrgs
      .slice()
      .sort(
        (a, b) =>
          (rollups.counts.get(b.id) ?? 0) - (rollups.counts.get(a.id) ?? 0) ||
          (rollups.lastSeen.get(b.id) ?? b.lastSeenAt).localeCompare(
            rollups.lastSeen.get(a.id) ?? a.lastSeenAt,
          ),
      )
      .slice(0, topLimit)
      .map(org => ({
        id: org.id,
        name: org.name,
        ...(org.industry ? { industry: org.industry } : {}),
        ...(org.owner ? { owner: org.owner } : {}),
        ...(org.status ? { status: org.status } : {}),
        ...(org.domains?.length ? { domains: org.domains } : {}),
        peopleCount: rollups.counts.get(org.id) ?? 0,
        lastSeenAt: rollups.lastSeen.get(org.id) ?? org.lastSeenAt,
      }))

    return {
      mutated: false,
      summary: `Briefed ${scopedContacts.length} contacts, ${matchedOrgs.length} orgs, ${listRoster.length} lists, ${allTracked.length} tracked customers (${byDue.overdue} overdue, ${byDue.dueToday} due today)`,
      data: {
        today,
        scope: {
          ...(list ? { list: list.name } : {}),
          ...(query ? { query } : {}),
        },
        totals: {
          contacts: store.contacts.length,
          scopedContacts: scopedContacts.length,
          orgs: orgs.length,
          lists: listRoster.length,
          encounters: store.encounters?.length ?? 0,
          trackedCustomers: allTracked.length,
        },
        lists: listRoster,
        customerPipeline: {
          total: allTracked.length,
          byStatus,
          byDue,
          urgentFollowUps,
        },
        topContacts,
        topOrgs,
        activity: {
          staleDays,
          staleCount,
          activeRecentCount: scopedContacts.length - staleCount,
        },
        hygieneSignals: {
          missingOrg,
          missingTitle,
          missingAvatar,
          potentialDuplicateClusters: duplicateClusters.length,
          unlinkedDomainMatches: unlinkedDomains.length,
        },
      },
    }
  },
})

export const fn_personRelationshipDossier =
  defineAppFunction<PeopleAgentToolContext>({
    name: 'fn_personRelationshipDossier',
    category: 'relationships',
    risk: 'read',
    requiresApproval: false,
    replaces: [
      'getContact',
      'getOrg',
      'getPersonNetwork',
      'listLists',
      'prepareProfilePhotoResearch',
    ],
    description:
      'Assemble a complete 360-degree dossier for one person in a single call: full sanitized contact record (including locked fields, sources, and retained alternatives), acquaintance level, list memberships, linked organisation & colleagues, CRM customer profile & due status, per-board event prep, 1- and 2-hop encounter network with introduction paths, and an optional profile-photo research brief.',
    inputSchema: {
      type: 'object',
      properties: {
        idOrEmail: {
          type: 'string',
          description:
            'Contact id, any known email address, or exact unique full name.',
        },
        networkDepth: {
          type: 'integer',
          enum: [1, 2],
          description:
            '1 = direct encounter ties only; 2 (default) = include 2-hop introductions.',
        },
        eventList: {
          type: 'string',
          description:
            'Optional event board list name or id to scope network connections (do not combine with eventQuery).',
        },
        eventQuery: {
          type: 'string',
          description:
            'Optional event board search query to scope network connections (do not combine with eventList).',
        },
        today: {
          type: 'string',
          description:
            'Optional YYYY-MM-DD reference date for customer follow-up status.',
        },
        includePhotoPlan: {
          type: 'string',
          enum: ['light', 'comprehensive'],
          description:
            'Optional profile-photo research mode to embed an identity-grounded photo research brief without extra tool calls.',
        },
      },
      required: ['idOrEmail'],
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const store = ctx.store
      const idOrEmail = text(args.idOrEmail)
      if (!idOrEmail) {
        throw new AgentPeopleToolError('"idOrEmail" is required.')
      }
      const contact = resolveContactStrictly(store, idOrEmail)
      const today = resolveToday(args.today)
      const depth: 1 | 2 = args.networkDepth === 1 ? 1 : 2

      const eventList = text(args.eventList)
      const eventQuery = text(args.eventQuery)
      let networkScope: Set<string> | undefined
      if (eventList || eventQuery) {
        const board = resolveBoardScope(store, eventList, eventQuery)
        networkScope = new Set(boardPeople(store, board).map(p => p.id))
      }

      const lists = listsForContact(store, contact).map(l => ({
        id: l.id,
        name: l.name,
      }))

      const org = orgForContact(store, contact)
      const organisation = org
        ? {
            ...agentRecordView(org),
            colleagueCount: Math.max(0, peopleForOrg(store, org).length - 1),
            colleagues: peopleForOrg(store, org)
              .filter(p => p.id !== contact.id)
              .slice(0, 15)
              .map(p => ({
                id: p.id,
                name: p.name,
                ...(p.title ? { title: p.title } : {}),
                knownAs: acquaintance(p).label,
              })),
          }
        : null

      const network = networkAround(store, contact.id, {
        depth,
        scope: networkScope,
      })
      const nameOf = (id: string) =>
        network.nodes.find(n => n.contact.id === id)?.contact.name ?? id
      const tieBetween = (a: string, b: string) =>
        network.edges.find(
          e => (e.a === a && e.b === b) || (e.a === b && e.b === a),
        )?.tie

      const connections = network.nodes
        .filter(n => n.ring > 0)
        .map(n => {
          const path = pathTo(network, n.contact.id)
          const parent = path[path.length - 2]!
          const tie = tieBetween(parent, n.contact.id)
          return {
            id: n.contact.id,
            name: n.contact.name,
            ...(n.contact.org ? { org: n.contact.org } : {}),
            steps: n.ring,
            ...(n.ring === 2 ? { via: nameOf(parent) } : {}),
            path: path.map(nameOf),
            ...(tie ? { shared: tieLabel(tie) } : {}),
            ...(tie?.recent.length
              ? {
                  latest: tie.recent.slice(0, 3).map(r => ({
                    kind: r.kind,
                    at: r.at,
                    ...(r.subject ? { subject: r.subject } : {}),
                  })),
                }
              : {}),
          }
        })

      const eventPreps = Object.entries(contact.prep ?? {}).map(
        ([key, prep]) => ({
          scopeKey: key,
          board: readableBoardTitle(store, key),
          ...(prep.meet ? { wantToMeet: true } : {}),
          ...(prep.note ? { note: prep.note } : {}),
          ...(prep.metAt ? { metAt: prep.metAt } : {}),
          updatedAt: prep.updatedAt,
        }),
      )

      const customer = contact.customer
        ? {
            ...contact.customer,
            dueBucket: customerDueBucket(contact.customer.dueDate, today),
            ...(contact.alternatives?.customer?.length
              ? { retainedAlternatives: contact.alternatives.customer }
              : {}),
          }
        : null

      const photoMode: ProfilePhotoResearchMode | undefined =
        args.includePhotoPlan === 'light' ||
        args.includePhotoPlan === 'comprehensive'
          ? args.includePhotoPlan
          : undefined

      const directCount = connections.filter(c => c.steps === 1).length
      const secondHopCount = connections.filter(c => c.steps === 2).length

      return {
        mutated: false,
        summary: `Dossier for ${contact.name} (${acquaintance(contact).label}${
          org ? `, ${org.name}` : contact.org ? `, ${contact.org}` : ''
        }): ${lists.length} list(s), ${directCount} direct tie(s), ${secondHopCount} 2-hop tie(s)`,
        data: {
          contact: agentRecordView(contact),
          acquaintance: acquaintance(contact),
          lists,
          organisation,
          ...(!organisation && contact.org
            ? { unmodeledOrgText: contact.org }
            : {}),
          customer,
          eventPreps,
          network: {
            depth,
            directCount,
            secondHopCount,
            hidden: network.hidden,
            connections,
            ...(connections.length === 0
              ? {
                  note: 'No shared threads or meetings recorded yet: connections come from the threads and meetings Mail and Calendar report.',
                }
              : {}),
          },
          ...(photoMode
            ? { photoResearchPlan: profilePhotoResearchBrief(contact, photoMode) }
            : {}),
        },
      }
    },
  })

export const fn_orgAndEventBriefing = defineAppFunction<PeopleAgentToolContext>(
  {
    name: 'fn_orgAndEventBriefing',
    category: 'briefing',
    risk: 'read',
    requiresApproval: false,
    replaces: [
      'getOrg',
      'listOrgs',
      'getEventBoard',
      'getPersonNetwork',
      'listCustomers',
    ],
    description:
      'Prepare a rich preparation briefing for either one organisation (pass org) or one event board (pass list or query — supply exactly one). In org mode, returns full org details, linked people with acquaintance/customer status, unlinked email-domain matches, and top external encounter ties. In event mode, returns starred targets, already-met people, known vs new breakdown, on-board ties, and warm introduction paths grounded in recorded encounters.',
    inputSchema: {
      type: 'object',
      properties: {
        org: {
          type: 'string',
          description:
            'Organisation id, name, or alias for an organisation briefing (mutually exclusive with list and query).',
        },
        list: {
          type: 'string',
          description:
            'List name or id for an event board briefing (mutually exclusive with org and query).',
        },
        query: {
          type: 'string',
          description:
            'Search query (e.g. event name or tag) for an event board briefing (mutually exclusive with org and list).',
        },
        today: {
          type: 'string',
          description:
            'Optional YYYY-MM-DD reference date for customer due-date status.',
        },
        maxPeople: {
          type: 'number',
          description:
            'Maximum people entries to return in detail (default 50, max 200).',
        },
      },
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const store = ctx.store
      const orgArg = text(args.org)
      const listArg = text(args.list)
      const queryArg = text(args.query)
      const modeCount =
        (orgArg ? 1 : 0) + (listArg ? 1 : 0) + (queryArg ? 1 : 0)
      if (modeCount !== 1) {
        throw new AgentPeopleToolError(
          'Supply exactly one of "org" (organisation name/id), "list" (event list name/id), or "query" (event search).',
        )
      }
      const today = resolveToday(args.today)
      const maxPeople = parseLimit(args.maxPeople, 50, 200)
      const ties = allTies(store)
      const contactById = new Map(store.contacts.map(c => [c.id, c]))

      if (orgArg) {
        const org = orgByIdOrName(store, orgArg)
        if (!org) {
          throw new AgentPeopleToolError(
            `No organisation matches "${orgArg}". Call listOrgs via callExtendedReadTool or fn_directoryBriefing to see existing organisations.`,
          )
        }
        const linked = peopleForOrg(store, org)
          .slice()
          .sort(
            (a, b) =>
              b.seenCount - a.seenCount ||
              b.lastSeenAt.localeCompare(a.lastSeenAt) ||
              a.name.localeCompare(b.name),
          )
        const linkedIds = new Set(linked.map(p => p.id))
        const unlinkedDomainMatches = findUnlinkedDomainMatches(
          store.contacts,
          [org],
        )

        const customerSummary = {
          tracked: 0,
          Lead: 0,
          Customer: 0,
          Inactive: 0,
          overdue: 0,
          dueToday: 0,
        }
        const externalTiesMap = new Map<
          string,
          { id: string; name: string; org?: string; sharedWith: Set<string>; totalWeight: number }
        >()

        for (const person of linked) {
          if (person.customer) {
            customerSummary.tracked++
            customerSummary[person.customer.status]++
            const bucket = customerDueBucket(person.customer.dueDate, today)
            if (bucket === 'overdue') customerSummary.overdue++
            if (bucket === 'dueToday') customerSummary.dueToday++
          }
          for (const tie of tiesFor(store, person.id, ties)) {
            if (linkedIds.has(tie.contactId)) continue
            const other = contactById.get(tie.contactId)
            if (!other) continue
            let entry = externalTiesMap.get(other.id)
            if (!entry) {
              entry = {
                id: other.id,
                name: other.name,
                ...(other.org ? { org: other.org } : {}),
                sharedWith: new Set<string>(),
                totalWeight: 0,
              }
              externalTiesMap.set(other.id, entry)
            }
            entry.sharedWith.add(person.name)
            entry.totalWeight += tie.threads + tie.meetings * 2
          }
        }

        const externalBridges = [...externalTiesMap.values()]
          .sort((a, b) => b.totalWeight - a.totalWeight || a.name.localeCompare(b.name))
          .slice(0, 10)
          .map(item => ({
            id: item.id,
            name: item.name,
            ...(item.org ? { org: item.org } : {}),
            connectedToMembers: [...item.sharedWith],
          }))

        return {
          mutated: false,
          summary: `Org briefing for ${org.name}: ${linked.length} linked people, ${customerSummary.tracked} tracked customers, ${unlinkedDomainMatches.length} unlinked domain match(es)`,
          data: {
            mode: 'org',
            today,
            organisation: agentRecordView(org),
            peopleCount: linked.length,
            customerSummary,
            unlinkedDomainMatches,
            externalBridges,
            people: linked.slice(0, maxPeople).map(p => ({
              id: p.id,
              name: p.name,
              emails: p.emails,
              ...(p.title ? { title: p.title } : {}),
              knownAs: acquaintance(p).label,
              seenCount: p.seenCount,
              lastSeenAt: p.lastSeenAt,
              lists: listsForContact(store, p).map(l => l.name),
              ...(p.customer
                ? {
                    customer: {
                      ...p.customer,
                      dueBucket: customerDueBucket(p.customer.dueDate, today),
                    },
                  }
                : {}),
              tieCount: tiesFor(store, p.id, ties).length,
            })),
            ...(linked.length > maxPeople
              ? { truncated: linked.length - maxPeople }
              : {}),
          },
        }
      }

      // Event board mode (`list` or `query`)
      const scope = resolveBoardScope(store, listArg, queryArg)
      const key = scopeKey(scope)
      const people = boardPeople(store, scope)
      const onBoardIds = new Set(people.map(p => p.id))

      const toMeet: string[] = []
      const alreadyMet: Array<{ id: string; name: string; metAt: string }> = []
      const countsByAcquaintance = { met: 0, emailed: 0, new: 0 }
      const warmIntroPaths: Array<{
        targetId: string
        targetName: string
        viaId: string
        viaName: string
        viaKnownAs: string
        viaOnBoard: boolean
        shared: string
      }> = []

      for (const p of people) {
        const acq = acquaintance(p)
        countsByAcquaintance[acq.level]++
        const prep = prepFor(p, key)
        if (prep?.meet) toMeet.push(p.name)
        if (prep?.metAt) {
          alreadyMet.push({ id: p.id, name: p.name, metAt: prep.metAt })
        }
        // For new or starred people, identify strongest known introducer grounded in recorded encounters
        if (acq.level === 'new' || prep?.meet) {
          const bestIntro = tiesFor(store, p.id, ties)
            .map(tie => {
              const other = contactById.get(tie.contactId)
              if (!other) return null
              const otherAcq = acquaintance(other)
              if (otherAcq.level === 'new') return null
              return {
                tie,
                other,
                otherAcq,
                onBoard: onBoardIds.has(other.id),
              }
            })
            .filter((item): item is NonNullable<typeof item> => item !== null)
            .sort(
              (a, b) =>
                Number(b.onBoard) - Number(a.onBoard) ||
                (b.tie.threads + b.tie.meetings * 2) -
                  (a.tie.threads + a.tie.meetings * 2),
            )[0]
          if (bestIntro) {
            warmIntroPaths.push({
              targetId: p.id,
              targetName: p.name,
              viaId: bestIntro.other.id,
              viaName: bestIntro.other.name,
              viaKnownAs: bestIntro.otherAcq.label,
              viaOnBoard: bestIntro.onBoard,
              shared: tieLabel(bestIntro.tie),
            })
          }
        }
      }

      const boardName = scopeTitle(store, scope)
      return {
        mutated: false,
        summary: `Event briefing for ${boardName}: ${people.length} people (${toMeet.length} to meet, ${alreadyMet.length} already met, ${warmIntroPaths.length} warm intro path(s))`,
        data: {
          mode: 'event',
          today,
          board: boardName,
          scope: key,
          count: people.length,
          countsByAcquaintance,
          toMeet,
          alreadyMet,
          warmIntroPaths: warmIntroPaths.slice(0, 25),
          people: people.slice(0, maxPeople).map(p => {
            const prep = prepFor(p, key)
            return {
              id: p.id,
              name: p.name,
              emails: p.emails,
              ...(p.title ? { title: p.title } : {}),
              ...(p.org ? { org: p.org } : {}),
              knownAs: acquaintance(p).label,
              seenCount: p.seenCount,
              lastSeenAt: p.lastSeenAt,
              recentContext: p.sources.slice(0, 3).map(s => ({
                app: s.app,
                at: s.at,
                ...(s.context ? { context: s.context } : {}),
              })),
              ...(p.topics?.length ? { topics: p.topics } : {}),
              ...(p.tags?.length ? { tags: p.tags } : {}),
              ...(p.customer
                ? {
                    customer: {
                      ...p.customer,
                      dueBucket: customerDueBucket(p.customer.dueDate, today),
                    },
                  }
                : {}),
              ...(prep?.meet ? { wantToMeet: true } : {}),
              ...(prep?.note ? { note: prep.note } : {}),
              ...(prep?.metAt ? { metAt: prep.metAt } : {}),
              connectedOnBoard: tiesFor(store, p.id, ties)
                .filter(t => onBoardIds.has(t.contactId))
                .slice(0, 8)
                .map(t => ({
                  name: contactById.get(t.contactId)?.name ?? t.contactId,
                  shared: tieLabel(t),
                  ...(t.recent[0]?.subject ? { latest: t.recent[0].subject } : {}),
                })),
            }
          }),
          ...(people.length > maxPeople
            ? { truncated: people.length - maxPeople }
            : {}),
        },
      }
    },
  },
)

export const fn_duplicateAndHygieneAudit =
  defineAppFunction<PeopleAgentToolContext>({
    name: 'fn_duplicateAndHygieneAudit',
    category: 'hygiene',
    risk: 'read',
    requiresApproval: false,
    replaces: ['listContacts', 'getContact', 'listOrgs', 'getOrg', 'listCustomers'],
    description:
      'Audit PurePeople data quality in one read-only scan: detect probable duplicate contact clusters (by normalized full name, shared phone, shared profile URL, or same corporate domain + similar name) with recommended survivor IDs, find unlinked email-domain-to-organisation matches, list frequent contact org names lacking an organisation record, surface high-interaction contacts missing metadata, and flag overdue or undated customer follow-ups. Never modifies or merges records.',
    inputSchema: {
      type: 'object',
      properties: {
        list: {
          type: 'string',
          description: 'Optional list name or id to scope the audit.',
        },
        query: {
          type: 'string',
          description: 'Optional search substring to scope the audit.',
        },
        today: {
          type: 'string',
          description:
            'Optional YYYY-MM-DD reference date for customer follow-up checks.',
        },
        maxItems: {
          type: 'number',
          description:
            'Maximum entries returned per hygiene section (default 25, max 100).',
        },
      },
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const store = ctx.store
      const list = resolveOptionalList(store, args.list)
      const query = text(args.query)
      const today = resolveToday(args.today)
      const maxItems = parseLimit(args.maxItems, 25, 100)

      const contacts =
        query || list
          ? searchContacts(
              store,
              query,
              Math.max(2000, store.contacts.length),
              list ? list.id : null,
            )
          : store.contacts
      const contactIds = new Set(contacts.map(c => c.id))
      const orgs = storeOrgs(store)

      const duplicateClusters = detectDuplicateClusters(contacts)
      const unlinkedDomainMatches = findUnlinkedDomainMatches(contacts, orgs)

      // Contact org strings that don't match any existing OrgRecord
      const unmodeledOrgCounts = new Map<string, { label: string; count: number }>()
      for (const c of contacts) {
        const rawOrg = c.org?.trim()
        if (!rawOrg) continue
        if (orgByIdOrName(store, rawOrg)) continue
        const key = orgKey(rawOrg)
        const prev = unmodeledOrgCounts.get(key)
        if (prev) prev.count++
        else unmodeledOrgCounts.set(key, { label: rawOrg, count: 1 })
      }
      const unmodeledOrgs = [...unmodeledOrgCounts.values()]
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
        .slice(0, maxItems)

      // High-interaction contacts missing core enrichment fields
      const enrichmentGaps = contacts
        .filter(c => !c.org?.trim() || !c.title?.trim() || !c.avatarUrl)
        .slice()
        .sort(
          (a, b) =>
            b.seenCount - a.seenCount ||
            b.lastSeenAt.localeCompare(a.lastSeenAt),
        )
        .slice(0, maxItems)
        .map(c => ({
          id: c.id,
          name: c.name,
          emails: c.emails,
          seenCount: c.seenCount,
          missing: [
            ...(!c.org?.trim() ? ['org'] : []),
            ...(!c.title?.trim() ? ['title'] : []),
            ...(!c.avatarUrl ? ['avatarUrl'] : []),
            ...(!c.links?.length ? ['links'] : []),
          ],
        }))

      const allOverdueCustomers = listCustomers(store, {
        due: 'Overdue',
        today,
      }).filter(c => contactIds.has(c.id))
      const overdueCustomers = allOverdueCustomers
        .slice(0, maxItems)
        .map(c => ({
          id: c.id,
          name: c.name,
          status: c.customer!.status,
          dueDate: c.customer!.dueDate,
          ...(c.customer!.nextAction ? { nextAction: c.customer!.nextAction } : {}),
        }))

      const allDueTodayCustomers = listCustomers(store, {
        due: 'Due today',
        today,
      }).filter(c => contactIds.has(c.id))
      const dueTodayCustomers = allDueTodayCustomers
        .slice(0, maxItems)
        .map(c => ({
          id: c.id,
          name: c.name,
          status: c.customer!.status,
          dueDate: c.customer!.dueDate,
          ...(c.customer!.nextAction ? { nextAction: c.customer!.nextAction } : {}),
        }))

      const allActionWithoutDueDate = listCustomers(store, {
        due: 'No due date',
        today,
      }).filter(
        c => contactIds.has(c.id) && Boolean(c.customer?.nextAction?.trim()),
      )
      const actionWithoutDueDate = allActionWithoutDueDate
        .slice(0, maxItems)
        .map(c => ({
          id: c.id,
          name: c.name,
          status: c.customer!.status,
          nextAction: c.customer!.nextAction,
        }))

      return {
        mutated: false,
        summary: `Hygiene audit across ${contacts.length} contacts: ${duplicateClusters.length} duplicate cluster(s), ${unlinkedDomainMatches.length} unlinked domain match(es), ${allOverdueCustomers.length} overdue follow-up(s)`,
        data: {
          today,
          scannedContacts: contacts.length,
          scannedOrgs: orgs.length,
          counts: {
            duplicateClusters: duplicateClusters.length,
            unlinkedDomainMatches: unlinkedDomainMatches.length,
            unmodeledOrgs: unmodeledOrgCounts.size,
            contactsWithEnrichmentGaps: contacts.filter(
              c => !c.org?.trim() || !c.title?.trim() || !c.avatarUrl,
            ).length,
            overdueCustomers: allOverdueCustomers.length,
            dueTodayCustomers: allDueTodayCustomers.length,
            actionWithoutDueDate: allActionWithoutDueDate.length,
          },
          duplicateClusters: duplicateClusters.slice(0, maxItems),
          unlinkedDomainMatches: unlinkedDomainMatches.slice(0, maxItems),
          unmodeledOrgs,
          enrichmentGaps,
          customerHygiene: {
            overdue: overdueCustomers,
            dueToday: dueTodayCustomers,
            actionWithoutDueDate,
          },
          guidance:
            'Confirm any contact consolidation with the user and call mergeContacts directly using exact survivorId and absorbedId. Use fn_batchCurateDirectory to stamp unlinked org names, create unmodeled orgs, or update follow-ups in one commit.',
        },
      }
    },
  })

function parseLinks(
  raw: unknown,
): Array<{ label: string; url: string }> | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw
    .filter(
      (item): item is { label?: unknown; url?: unknown } =>
        Boolean(item) && typeof item === 'object',
    )
    .map(item => ({
      label: typeof item.label === 'string' ? item.label : '',
      url: typeof item.url === 'string' ? item.url : '',
    }))
}

export const fn_batchCurateDirectory =
  defineAppFunction<PeopleAgentToolContext>({
    name: 'fn_batchCurateDirectory',
    category: 'curation',
    risk: 'write',
    requiresApproval: true,
    replaces: [
      'upsertContact',
      'upsertOrg',
      'addToList',
      'createCustomer',
      'updateCustomer',
      'setEventPrep',
    ],
    description:
      'Apply a coordinated curation batch in one atomic store update (with optional dryRun preview): upsert organisations, upsert contacts (locking curated fields and filing onto lists), add existing contacts to lists, create or update customer follow-up profiles, and set per-board event prep. Validation errors abort the whole batch with zero partial writes. Never deletes lists, removes list members, or merges contacts.',
    inputSchema: {
      type: 'object',
      properties: {
        orgs: {
          type: 'array',
          description:
            'Organisations to create or update (same locked-field semantics as upsertOrg).',
          items: {
            type: 'object',
            description:
              'Org patch: required name; optional rename, industry, owner, status, city, country, notes, avatarUrl, aliases, phones, domains, tags, links.',
            properties: {
              name: { type: 'string' },
            },
            required: ['name'],
          },
        },
        contacts: {
          type: 'array',
          description:
            'Contacts to create or update (same locked-field semantics as upsertContact).',
          items: {
            type: 'object',
            description:
              'Contact patch: required email; optional name, org, title, phones, notes, tags, addEmails, avatarUrl, links, status, topics, channels, lists.',
            properties: {
              email: { type: 'string' },
            },
            required: ['email'],
          },
        },
        listAdditions: {
          type: 'array',
          description:
            'Batch list additions (creates a list if new; unknown addresses are reported, never invented).',
          items: {
            type: 'object',
            properties: {
              list: { type: 'string' },
              emails: { type: 'array', items: { type: 'string' } },
            },
            required: ['list', 'emails'],
          },
        },
        customerUpdates: {
          type: 'array',
          description:
            'Customer profile creations or updates for existing contacts (mode defaults to "upsert").',
          items: {
            type: 'object',
            properties: {
              contactIdOrEmail: { type: 'string' },
              mode: { type: 'string', enum: ['create', 'update', 'upsert'] },
              status: {
                type: 'string',
                enum: ['Lead', 'Customer', 'Inactive'],
              },
              notes: { type: 'string' },
              nextAction: { type: 'string' },
              dueDate: { type: 'string' },
            },
            required: ['contactIdOrEmail'],
          },
        },
        eventPreps: {
          type: 'array',
          description:
            'Event board preparation updates (each entry must specify exactly one of list or query, plus contact and at least one of meet/note/metAt).',
          items: {
            type: 'object',
            properties: {
              list: { type: 'string' },
              query: { type: 'string' },
              contact: { type: 'string' },
              meet: { type: 'boolean' },
              note: { type: 'string' },
              metAt: { type: 'string' },
            },
            required: ['contact'],
          },
        },
        dryRun: {
          type: 'boolean',
          description:
            'When true, validates the entire batch and returns the planned receipt without mutating the store.',
        },
      },
      additionalProperties: false,
    },
    run: async (ctx, args) => {
      const orgEntries = Array.isArray(args.orgs) ? args.orgs : []
      const contactEntries = Array.isArray(args.contacts) ? args.contacts : []
      const listAdditionEntries = Array.isArray(args.listAdditions)
        ? args.listAdditions
        : []
      const customerEntries = Array.isArray(args.customerUpdates)
        ? args.customerUpdates
        : []
      const eventPrepEntries = Array.isArray(args.eventPreps)
        ? args.eventPreps
        : []
      const dryRun = args.dryRun === true

      const totalRequested =
        orgEntries.length +
        contactEntries.length +
        listAdditionEntries.length +
        customerEntries.length +
        eventPrepEntries.length
      if (totalRequested === 0) {
        throw new AgentPeopleToolError(
          'Supply at least one entry in orgs, contacts, listAdditions, customerUpdates, or eventPreps.',
        )
      }

      interface BatchReceipt {
        orgsSaved: Array<{ id: string; name: string }>
        contactsSaved: Array<{ id: string; name: string; lists: string[] }>
        listsUpdated: Array<{
          list: string
          added: string[]
          notFound: string[]
          holds: number
        }>
        customersSaved: Array<{
          contactId: string
          name: string
          mode: 'create' | 'update'
          status: string
          dueDate?: string
        }>
        eventPrepsSaved: Array<{
          board: string
          contactId: string
          person: string
        }>
      }

      const applyBatch = (
        initial: PeopleStore,
      ): { store: PeopleStore; receipt: BatchReceipt } => {
        let next = initial
        const receipt: BatchReceipt = {
          orgsSaved: [],
          contactsSaved: [],
          listsUpdated: [],
          customersSaved: [],
          eventPrepsSaved: [],
        }

        // 1. Orgs
        for (const raw of orgEntries) {
          if (!raw || typeof raw !== 'object') {
            throw new AgentPeopleToolError('Each entry in "orgs" must be an object.')
          }
          const item = raw as Record<string, unknown>
          const name = text(item.name)
          if (!name) {
            throw new AgentPeopleToolError('Each entry in "orgs" requires a non-empty "name".')
          }
          const patch: OrgUpsertPatch = {
            name,
            ...(typeof item.rename === 'string' ? { rename: item.rename } : {}),
            ...(typeof item.industry === 'string'
              ? { industry: item.industry }
              : {}),
            ...(typeof item.owner === 'string' ? { owner: item.owner } : {}),
            ...(typeof item.status === 'string' ? { status: item.status } : {}),
            ...(typeof item.city === 'string' ? { city: item.city } : {}),
            ...(typeof item.country === 'string'
              ? { country: item.country }
              : {}),
            ...(typeof item.notes === 'string' ? { notes: item.notes } : {}),
            ...(typeof item.avatarUrl === 'string'
              ? { avatarUrl: item.avatarUrl }
              : {}),
            ...(stringArray(item.aliases)
              ? { aliases: stringArray(item.aliases) }
              : {}),
            ...(stringArray(item.phones)
              ? { phones: stringArray(item.phones) }
              : {}),
            ...(stringArray(item.domains)
              ? { domains: stringArray(item.domains) }
              : {}),
            ...(stringArray(item.tags) ? { tags: stringArray(item.tags) } : {}),
            ...(parseLinks(item.links) ? { links: parseLinks(item.links) } : {}),
          }
          const res = upsertOrg(next, patch, 'agent')
          next = res.store
          receipt.orgsSaved.push({ id: res.org.id, name: res.org.name })
        }

        // 2. Contacts
        for (const raw of contactEntries) {
          if (!raw || typeof raw !== 'object') {
            throw new AgentPeopleToolError(
              'Each entry in "contacts" must be an object.',
            )
          }
          const item = raw as Record<string, unknown>
          const email = text(item.email)
          if (!email) {
            throw new AgentPeopleToolError(
              'Each entry in "contacts" requires a non-empty "email".',
            )
          }
          const patch: ContactUpsertPatch = {
            email,
            ...(typeof item.name === 'string' ? { name: item.name } : {}),
            ...(typeof item.org === 'string' ? { org: item.org } : {}),
            ...(typeof item.title === 'string' ? { title: item.title } : {}),
            ...(typeof item.notes === 'string' ? { notes: item.notes } : {}),
            ...(typeof item.avatarUrl === 'string'
              ? { avatarUrl: item.avatarUrl }
              : {}),
            ...(parseLinks(item.links) ? { links: parseLinks(item.links) } : {}),
            ...(stringArray(item.phones)
              ? { phones: stringArray(item.phones) }
              : {}),
            ...(stringArray(item.tags) ? { tags: stringArray(item.tags) } : {}),
            ...(typeof item.status === 'string' ? { status: item.status } : {}),
            ...(stringArray(item.topics)
              ? { topics: stringArray(item.topics) }
              : {}),
            ...(stringArray(item.channels)
              ? { channels: stringArray(item.channels) }
              : {}),
            ...(stringArray(item.addEmails)
              ? { addEmails: stringArray(item.addEmails) }
              : {}),
          }
          const res = upsertContact(next, patch, 'agent')
          next = res.store
          for (const listName of stringArray(item.lists) ?? []) {
            if (listName.trim()) {
              next = addToList(next, listName, [res.contact.id])
            }
          }
          const updatedContact =
            next.contacts.find(c => c.id === res.contact.id) ?? res.contact
          receipt.contactsSaved.push({
            id: updatedContact.id,
            name: updatedContact.name,
            lists: listsForContact(next, updatedContact).map(l => l.name),
          })
        }

        // 3. List additions
        for (const raw of listAdditionEntries) {
          if (!raw || typeof raw !== 'object') {
            throw new AgentPeopleToolError(
              'Each entry in "listAdditions" must be an object.',
            )
          }
          const item = raw as Record<string, unknown>
          const listName = text(item.list)
          if (!listName) {
            throw new AgentPeopleToolError(
              'Each entry in "listAdditions" requires a non-empty "list".',
            )
          }
          const emails = stringArray(item.emails) ?? []
          if (emails.length === 0) {
            throw new AgentPeopleToolError(
              `listAdditions for "${listName}" must name at least one email.`,
            )
          }
          const known: ContactRecord[] = []
          const notFound: string[] = []
          for (const e of emails) {
            const c = contactByIdOrEmail(next, e)
            if (c) known.push(c)
            else notFound.push(e)
          }
          next =
            known.length > 0
              ? addToList(
                  next,
                  listName,
                  known.map(c => c.id),
                )
              : createList(next, listName).store
          const resolvedList = listByIdOrName(next, listName)
          receipt.listsUpdated.push({
            list: resolvedList?.name ?? listName,
            added: known.map(c => c.name),
            notFound,
            holds: resolvedList
              ? (listCounts(next).get(resolvedList.id) ?? 0)
              : 0,
          })
        }

        // 4. Customer profile updates
        for (const raw of customerEntries) {
          if (!raw || typeof raw !== 'object') {
            throw new AgentPeopleToolError(
              'Each entry in "customerUpdates" must be an object.',
            )
          }
          const item = raw as Record<string, unknown>
          const idOrEmail = text(item.contactIdOrEmail)
          if (!idOrEmail) {
            throw new AgentPeopleToolError(
              'Each entry in "customerUpdates" requires "contactIdOrEmail".',
            )
          }
          const contact = contactByIdOrEmail(next, idOrEmail)
          if (!contact) {
            throw new AgentPeopleToolError(
              `Unknown contact "${idOrEmail}" in customerUpdates. Upsert the contact first in the same batch or with upsertContact.`,
            )
          }
          const requestedMode = text(item.mode) || 'upsert'
          if (
            requestedMode !== 'create' &&
            requestedMode !== 'update' &&
            requestedMode !== 'upsert'
          ) {
            throw new AgentPeopleToolError(
              `Invalid customerUpdates mode "${requestedMode}" for "${idOrEmail}". Use "create", "update", or "upsert".`,
            )
          }
          const mode: 'create' | 'update' =
            requestedMode === 'create'
              ? 'create'
              : requestedMode === 'update'
                ? 'update'
                : contact.customer
                  ? 'update'
                  : 'create'
          const patch: Record<string, unknown> = {}
          if (item.status !== undefined) patch.status = item.status
          if (item.notes !== undefined) patch.notes = item.notes
          if (item.nextAction !== undefined) patch.nextAction = item.nextAction
          if (item.dueDate !== undefined) patch.dueDate = item.dueDate
          try {
            next = saveCustomer(next, contact.id, patch, mode)
          } catch (error) {
            throw new AgentPeopleToolError(
              error instanceof Error ? error.message : String(error),
            )
          }
          const saved = next.contacts.find(c => c.id === contact.id)!
          receipt.customersSaved.push({
            contactId: saved.id,
            name: saved.name,
            mode,
            status: saved.customer!.status,
            ...(saved.customer!.dueDate
              ? { dueDate: saved.customer!.dueDate }
              : {}),
          })
        }

        // 5. Event preps
        for (const raw of eventPrepEntries) {
          if (!raw || typeof raw !== 'object') {
            throw new AgentPeopleToolError(
              'Each entry in "eventPreps" must be an object.',
            )
          }
          const item = raw as Record<string, unknown>
          const scope = resolveBoardScope(next, text(item.list), text(item.query))
          const key = scopeKey(scope)
          const contactRef = text(item.contact)
          const contact = contactByIdOrEmail(next, contactRef)
          if (!contact) {
            throw new AgentPeopleToolError(
              `No person "${contactRef}" in eventPreps.`,
            )
          }
          const patch: { meet?: boolean; note?: string; metAt?: string } = {}
          if (typeof item.meet === 'boolean') patch.meet = item.meet
          if (typeof item.note === 'string') patch.note = item.note
          if (typeof item.metAt === 'string') patch.metAt = item.metAt.trim()
          if (!Object.keys(patch).length) {
            throw new AgentPeopleToolError(
              `eventPreps for "${contactRef}" must set at least one of meet, note, or metAt.`,
            )
          }
          try {
            next = setPrep(next, contact.id, key, patch)
          } catch (error) {
            throw new AgentPeopleToolError(
              error instanceof Error ? error.message : String(error),
            )
          }
          receipt.eventPrepsSaved.push({
            board: scopeTitle(next, scope),
            contactId: contact.id,
            person: contact.name,
          })
        }

        return { store: next, receipt }
      }

      if (dryRun) {
        const { receipt } = applyBatch(ctx.store)
        return {
          mutated: false,
          summary: `Dry-run batch valid: ${receipt.orgsSaved.length} org(s), ${receipt.contactsSaved.length} contact(s), ${receipt.listsUpdated.length} list update(s), ${receipt.customersSaved.length} customer(s), ${receipt.eventPrepsSaved.length} event prep(s)`,
          data: {
            dryRun: true,
            ...receipt,
          },
        }
      }

      let finalReceipt!: BatchReceipt
      await ctx.setStore(current => {
        const applied = applyBatch(current)
        finalReceipt = applied.receipt
        return applied.store
      })

      return {
        mutated: true,
        summary: `Curated ${finalReceipt.orgsSaved.length} org(s), ${finalReceipt.contactsSaved.length} contact(s), ${finalReceipt.listsUpdated.length} list update(s), ${finalReceipt.customersSaved.length} customer(s), ${finalReceipt.eventPrepsSaved.length} event prep(s)`,
        data: {
          dryRun: false,
          ...finalReceipt,
        },
      }
    },
  })

export const PUREPEOPLE_FUNCTIONS: readonly AppFunctionDefinition<PeopleAgentToolContext>[] =
  [
    fn_directoryBriefing,
    fn_personRelationshipDossier,
    fn_orgAndEventBriefing,
    fn_duplicateAndHygieneAudit,
    fn_batchCurateDirectory,
  ]
