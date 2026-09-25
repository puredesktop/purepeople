import { alternativeFields, consolidateContactRecords, distinct, retainAlternatives } from './contactConsolidation'
import type {
  ContactFeedEntry,
  ContactLink,
  ContactRecord,
  PeopleStore,
} from '../types'

export const PEOPLE_STORE_VERSION = 1


export function emptyPeopleStore(now = new Date().toISOString()): PeopleStore {
  return { storeVersion: PEOPLE_STORE_VERSION, contacts: [], updatedAt: now }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Addresses that are machines, not people — never worth a contact card. */
export function isMachineEmail(email: string): boolean {
  return /no-?reply|do-?not-?reply|notifications?@|mailer-daemon|postmaster@|bounce/i.test(
    email,
  )
}

function findByEmail(
  store: PeopleStore,
  email: string,
): ContactRecord | undefined {
  const normalized = normalizeEmail(email)
  return store.contacts.find(contact =>
    contact.emails.some(item => normalizeEmail(item) === normalized),
  )
}

function stampSource(
  sources: ContactRecord['sources'],
  app: string,
  at: string,
  context?: string,
  preserve = false,
): ContactRecord['sources'] {
  // Retain contexts absorbed by consolidation when stamping later edits/feeds.
  const rest = sources.filter(item => preserve || item.app !== app || item.context !== context)
  return distinct([{ app, at, ...(context ? { context } : {}) }, ...rest])
}

function isLocked(record: ContactRecord, field: string): boolean {
  return (record.lockedFields ?? []).includes(field)
}

/** Trim, keep http(s) only, dedupe by URL. Undefined when nothing survives. */
export function normalizeLinks(
  links: ContactLink[] | undefined,
): ContactLink[] | undefined {
  if (!links) return undefined
  const seen = new Set<string>()
  const clean: ContactLink[] = []
  for (const link of links) {
    const url = link?.url?.trim() ?? ''
    const label = link?.label?.trim() ?? ''
    if (!/^https?:\/\//i.test(url)) continue
    if (seen.has(url.toLowerCase())) continue
    seen.add(url.toLowerCase())
    clean.push({ label: label || urlLinkLabel(url), url })
  }
  return clean.length > 0 ? clean : undefined
}

/** A default label for an unlabeled URL — the recognizable host name. */
export function urlLinkLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    const known: Record<string, string> = {
      'linkedin.com': 'LinkedIn',
      'github.com': 'GitHub',
      'x.com': 'X',
      'twitter.com': 'X',
      'instagram.com': 'Instagram',
      'facebook.com': 'Facebook',
      'youtube.com': 'YouTube',
      'mastodon.social': 'Mastodon',
      'bsky.app': 'Bluesky',
    }
    for (const [domain, label] of Object.entries(known)) {
      if (host === domain || host.endsWith(`.${domain}`)) return label
    }
    return host
  } catch {
    return 'Link'
  }
}

/** A display name worth keeping — not empty and not just the address. */
function usableName(name: string | undefined, email: string): string | null {
  const trimmed = name?.trim()
  if (!trimmed) return null
  if (normalizeEmail(trimmed) === normalizeEmail(email)) return null
  return trimmed
}

/**
 * Merge ONE feed entry. Feeds fill gaps and stamp activity: an existing
 * record gains alias emails, empty fields, a source stamp, and a bumped
 * seen count — but a field the user or an agent set explicitly (locked)
 * is never overwritten by a feed.
 */
export function mergeFeedEntry(
  store: PeopleStore,
  entry: ContactFeedEntry,
): PeopleStore {
  const email = normalizeEmail(entry.contact.email)
  if (!email || isMachineEmail(email)) return store
  const seenAt = entry.seenAt
  const aliasEmails = (entry.contact.emails ?? [])
    .map(normalizeEmail)
    .filter(item => item && !isMachineEmail(item))
  const existing = findByEmail(store, email)
    ?? aliasEmails.map(alias => findByEmail(store, alias)).find(Boolean)

  if (!existing) {
    const record: ContactRecord = {
      id: store.contacts.some(contact => contact.id === email || contact.mergeProgress?.absorbedIds.includes(email)) ? `contact_${crypto.randomUUID()}` : email,
      name: usableName(entry.contact.name, email) ?? email,
      emails: [email, ...aliasEmails.filter(item => item !== email)],
      ...(entry.contact.org?.trim() ? { org: entry.contact.org.trim() } : {}),
      ...(entry.contact.title?.trim()
        ? { title: entry.contact.title.trim() }
        : {}),
      ...(entry.contact.phones?.length
        ? { phones: entry.contact.phones }
        : {}),
      ...(entry.contact.notes?.trim()
        ? { notes: entry.contact.notes.trim() }
        : {}),
      ...(entry.contact.avatarUrl?.trim()
        ? { avatarUrl: entry.contact.avatarUrl.trim() }
        : {}),
      ...(normalizeLinks(entry.contact.links)
        ? { links: normalizeLinks(entry.contact.links) }
        : {}),
      ...(entry.contact.tags?.length ? { tags: entry.contact.tags } : {}),
      ...(entry.contact.status?.trim()
        ? { status: entry.contact.status.trim() }
        : {}),
      ...(entry.contact.topics?.length
        ? { topics: entry.contact.topics }
        : {}),
      ...(entry.contact.channels?.length
        ? { channels: entry.contact.channels }
        : {}),
      ...(entry.contact.notesHtml ? { notesHtml: entry.contact.notesHtml } : {}),
      ...(entry.contact.retained ? { alternatives: entry.contact.retained } : {}),
      sources: stampSource([], entry.sourceApp, seenAt, entry.context),
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      seenCount: 1,
      updatedAt: seenAt,
    }
    return {
      ...store,
      contacts: [...store.contacts, record],
      updatedAt: seenAt,
    }
  }

  const merged: ContactRecord = { ...existing }
  merged.emails = [
    ...existing.emails,
    ...[email, ...aliasEmails].filter(
      item => !existing.emails.some(known => normalizeEmail(known) === item),
    ),
  ]
  const betterName = usableName(entry.contact.name, email)
  if (
    betterName &&
    !isLocked(existing, 'name') &&
    (existing.name.trim() === '' ||
      normalizeEmail(existing.name) === normalizeEmail(existing.id))
  ) {
    merged.name = betterName
  }
  for (const field of ['org', 'title', 'notes', 'avatarUrl', 'status'] as const) {
    const incoming = entry.contact[field]?.trim()
    if (incoming && !existing[field] && !isLocked(existing, field)) {
      merged[field] = incoming
    }
  }
  if (
    entry.contact.phones?.length &&
    !existing.phones?.length &&
    !isLocked(existing, 'phones')
  ) {
    merged.phones = entry.contact.phones
  }
  const feedLinks = normalizeLinks(entry.contact.links)
  if (feedLinks && !existing.links?.length && !isLocked(existing, 'links')) {
    merged.links = feedLinks
  }
  for (const field of ['tags', 'topics', 'channels'] as const) {
    const incoming = entry.contact[field]
    if (
      incoming?.length &&
      !existing[field]?.length &&
      !isLocked(existing, field)
    ) {
      merged[field] = incoming
    }
  }
  if (entry.contact.notesHtml && !existing.notes && !existing.notesHtml && !isLocked(existing, 'notes')) {
    merged.notesHtml = entry.contact.notesHtml
  }
  if (entry.contact.retained) {
    // Backup alternatives are additive; primary fields still obey feed locks.
    const incoming = { ...merged, alternatives: entry.contact.retained }
    merged.alternatives = retainAlternatives(merged, merged, incoming)
  }
  merged.sources = stampSource(
    existing.sources,
    entry.sourceApp,
    seenAt,
    entry.context,
    Boolean(existing.alternatives),
  )
  merged.seenCount = existing.seenCount + 1
  if (seenAt > existing.lastSeenAt) merged.lastSeenAt = seenAt
  if (seenAt < existing.firstSeenAt) merged.firstSeenAt = seenAt
  merged.updatedAt = seenAt

  return {
    ...store,
    contacts: store.contacts.map(contact =>
      contact.id === existing.id ? merged : contact,
    ),
    updatedAt: seenAt,
  }
}

export interface ContactUpsertPatch {
  email: string
  name?: string
  org?: string
  title?: string
  phones?: string[]
  notes?: string
  notesHtml?: string
  avatarUrl?: string
  links?: ContactLink[]
  tags?: string[]
  status?: string
  topics?: string[]
  channels?: string[]
  addEmails?: string[]
  /**
   * Replace the WHOLE address list (first entry is the primary). Invalid
   * or empty lists are ignored — a contact always keeps at least one
   * address. The record id stays stable even when addresses change.
   */
  setEmails?: string[]
}

/**
 * Explicit write from the user or an agent: sets the given fields AND
 * locks them, so later feeds cannot undo curation. Creates the record if
 * the address is unknown.
 *
 * When the patch's addresses span MORE than one existing record (an
 * `addEmails` alias belongs to someone already on file), the records are
 * consolidated into one that keeps everything both had: the union of
 * addresses, sources, and locked fields, the earliest firstSeenAt, the
 * summed seen count, and any display name / filled field either side
 * had — an alias merge must never look like a brand-new contact.
 */
export function upsertContact(
  store: PeopleStore,
  patch: ContactUpsertPatch,
  by: 'user' | 'agent',
  now = new Date().toISOString(),
): { store: PeopleStore; contact: ContactRecord } {
  const email = normalizeEmail(patch.email)
  if (!email) throw new Error('A contact needs an email address.')
  // UI edits address the stable id even after its original email is removed.
  const byId = store.contacts.find(contact => contact.id === email)
  const patchEmails = [
    ...(byId ? [] : [email]),
    ...(patch.addEmails ?? []).map(normalizeEmail).filter(Boolean),
    ...(patch.setEmails ?? [])
      .map(normalizeEmail)
      .filter(item => item.includes('@')),
  ]
  const involved: ContactRecord[] = byId ? [byId] : []
  for (const address of patchEmails) {
    const found = findByEmail(store, address)
    if (found && !involved.some(record => record.id === found.id)) {
      involved.push(found)
    }
  }
  const existing = byId ?? findByEmail(store, email) ?? involved[0]
  const absorbed = involved.filter(record => record.id !== existing?.id)
  const settable = [
    'name',
    'org',
    'title',
    'phones',
    'notes',
    'avatarUrl',
    'links',
    'tags',
    'status',
    'topics',
    'channels',
  ] as const
  const touched = settable.filter(field => patch[field] !== undefined || (field === 'notes' && patch.notesHtml !== undefined))

  let base: ContactRecord = existing ?? {
    id: store.contacts.some(contact => contact.mergeProgress?.absorbedIds.includes(email)) ? `contact_${crypto.randomUUID()}` : email,
    name: email,
    emails: [email],
    sources: [],
    firstSeenAt: now,
    lastSeenAt: now,
    seenCount: 0,
    updatedAt: now,
  }
  for (const other of absorbed) base = consolidateContactRecords(base, other)
  const absorbedIds = new Set(absorbed.map(record => record.id))
  const next: ContactRecord = {
    ...base,
    ...(patch.name !== undefined ? { name: patch.name.trim() || email } : {}),
    ...(patch.org !== undefined ? { org: patch.org.trim() } : {}),
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.phones !== undefined ? { phones: patch.phones } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.notesHtml !== undefined
      ? { notesHtml: patch.notesHtml }
      : patch.notes !== undefined
        ? // A plain-text write (agent tools) replaces the rich version too,
          // or the app would keep rendering the stale HTML over it.
          { notesHtml: undefined }
        : {}),
    ...(patch.avatarUrl !== undefined
      ? { avatarUrl: patch.avatarUrl.trim() }
      : {}),
    ...(patch.links !== undefined
      ? { links: normalizeLinks(patch.links) }
      : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.status !== undefined ? { status: patch.status.trim() } : {}),
    ...(patch.topics !== undefined ? { topics: patch.topics } : {}),
    ...(patch.channels !== undefined ? { channels: patch.channels } : {}),
    emails: (() => {
      const replaced = [
        ...new Set(
          (patch.setEmails ?? [])
            .map(normalizeEmail)
            .filter(item => item.includes('@')),
        ),
      ]
      if (patch.setEmails !== undefined && replaced.length > 0) {
        return absorbed.length ? distinct([...base.emails, ...replaced], normalizeEmail) : replaced
      }
      return [
        ...base.emails,
        ...patchEmails.filter(
          item =>
            !base.emails.some(known => normalizeEmail(known) === item),
        ),
      ]
    })(),
    sources: stampSource(base.sources, by, now, undefined, Boolean(base.alternatives)),
    lockedFields: [
      ...new Set([...(base.lockedFields ?? []), ...touched]),
    ],
    updatedAt: now,
  }
  // Edits to a consolidated primary must not erase a retained detail.
  if (base.alternatives) next.alternatives = retainAlternatives(next, base, next)
  // A collision combined with explicit array edits still retains both records.
  if (absorbed.length) {
    for (const field of ['phones', 'tags', 'topics', 'channels'] as const) {
      next[field] = distinct([...(next[field] ?? []), ...(base[field] ?? [])])
    }
    next.links = distinct([...(next.links ?? []), ...(base.links ?? [])])
  }
  const kept = store.contacts.filter(
    contact => !absorbedIds.has(contact.id),
  )
  const contacts = existing
    ? kept.map(contact => (contact.id === existing.id ? next : contact))
    : [...kept, next]
  return { store: { ...store, contacts, updatedAt: now }, contact: next }
}

export function removeContact(
  store: PeopleStore,
  idOrEmail: string,
): PeopleStore {
  const normalized = normalizeEmail(idOrEmail)
  return {
    ...store,
    contacts: store.contacts.filter(
      contact =>
        contact.id !== normalized &&
        !contact.emails.some(item => normalizeEmail(item) === normalized),
    ),
    updatedAt: new Date().toISOString(),
  }
}

export function contactByIdOrEmail(
  store: PeopleStore,
  idOrEmail: string,
): ContactRecord | undefined {
  const normalized = normalizeEmail(idOrEmail)
  return (
    store.contacts.find(contact => contact.id === normalized) ??
    findByEmail(store, normalized)
  )
}

/**
 * Substring search over name, addresses, org, title, and tags, ranked by
 * interaction weight (seen count, then recency). Empty query = everyone.
 */
export function searchContacts(
  store: PeopleStore,
  query: string,
  limit = 50,
  /** Restrict to one list. Scoping BEFORE the limit, so a search inside
   *  a small list is never crowded out by matches from outside it. */
  listId?: string | null,
): ContactRecord[] {
  const needle = query.trim().toLowerCase()
  const scoped = listId
    ? store.contacts.filter(contact => (contact.listIds ?? []).includes(listId))
    : store.contacts
  const matches = scoped.filter(contact => {
    if (!needle) return true
    const haystack = [
      contact.name,
      ...alternativeFields.flatMap(field => contact.alternatives?.[field] ?? []),
      contact.notes ?? '',
      ...(contact.alternatives?.notes ?? []).map(note => note.notes ?? ''),
      ...(contact.phones ?? []),
      ...contact.emails,
      contact.org ?? '',
      contact.title ?? '',
      ...(contact.tags ?? []),
      contact.status ?? '',
      ...(contact.topics ?? []),
      ...(contact.channels ?? []),
      ...(contact.links ?? []).flatMap(link => [link.label, link.url]),
    ]
      .join('\n')
      .toLowerCase()
    return haystack.includes(needle)
  })
  return matches
    .sort(
      (a, b) =>
        b.seenCount - a.seenCount ||
        b.lastSeenAt.localeCompare(a.lastSeenAt) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit)
}

/** Persisted-shape tolerance: keep unknown fields, default the missing. */
export function normalizePeopleStore(value: unknown): PeopleStore {
  if (!value || typeof value !== 'object') return emptyPeopleStore()
  const raw = value as Partial<PeopleStore>
  if (!Array.isArray(raw.contacts)) return emptyPeopleStore()
  return {
    ...raw,
    storeVersion: PEOPLE_STORE_VERSION,
    contacts: raw.contacts.filter(
      (contact): contact is ContactRecord =>
        Boolean(contact) &&
        typeof (contact as ContactRecord).id === 'string' &&
        Array.isArray((contact as ContactRecord).emails),
    ),
    updatedAt:
      typeof raw.updatedAt === 'string'
        ? raw.updatedAt
        : new Date().toISOString(),
  }
}
