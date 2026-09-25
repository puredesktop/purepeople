import type {
  ContactLink,
  ContactRecord,
  OrgRecord,
  PeopleStore,
} from '../types'
import { normalizeEmail, normalizeLinks } from './contactsModel'

/**
 * Organisation records living beside contacts in the same store, with
 * the same rules: explicit edits (user/agent) lock their fields, imports
 * fill empty fields only, provenance is stamped per source.
 *
 * People↔org links are COMPUTED (see orgKey/peopleForOrg), never stored
 * — a contact's `org` text or email domain is the join.
 */

const MAX_SOURCE_STAMPS = 8

/** Case/whitespace-insensitive identity for org names. */
export function orgKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function storeOrgs(store: PeopleStore): OrgRecord[] {
  return store.orgs ?? []
}

function orgMatchesKey(org: OrgRecord, key: string): boolean {
  return (
    org.id === key ||
    orgKey(org.name) === key ||
    (org.aliases ?? []).some(alias => orgKey(alias) === key)
  )
}

export function orgByIdOrName(
  store: PeopleStore,
  idOrName: string,
): OrgRecord | undefined {
  const key = orgKey(idOrName)
  if (!key) return undefined
  return storeOrgs(store).find(org => orgMatchesKey(org, key))
}

function isLocked(org: OrgRecord, field: string): boolean {
  return (org.lockedFields ?? []).includes(field)
}

function stampSource(
  sources: OrgRecord['sources'],
  app: string,
  at: string,
  context?: string,
): OrgRecord['sources'] {
  const rest = sources.filter(item => item.app !== app)
  return [{ app, at, ...(context ? { context } : {}) }, ...rest].slice(
    0,
    MAX_SOURCE_STAMPS,
  )
}

export interface OrgUpsertPatch {
  /** Existing org id/name/alias to update, or a new org's name. */
  name: string
  /** New display name (the id stays stable). */
  rename?: string
  aliases?: string[]
  industry?: string
  owner?: string
  status?: string
  city?: string
  country?: string
  phones?: string[]
  domains?: string[]
  links?: ContactLink[]
  tags?: string[]
  notes?: string
  notesHtml?: string
  avatarUrl?: string
}

const SETTABLE = [
  'aliases',
  'industry',
  'owner',
  'status',
  'city',
  'country',
  'phones',
  'domains',
  'links',
  'tags',
  'notes',
  'avatarUrl',
] as const

export function upsertOrg(
  store: PeopleStore,
  patch: OrgUpsertPatch,
  by: 'user' | 'agent',
  now = new Date().toISOString(),
): { store: PeopleStore; org: OrgRecord } {
  const name = patch.name.trim()
  if (!name) throw new Error('An organisation needs a name.')
  const existing = orgByIdOrName(store, name)
  const touched: string[] = SETTABLE.filter(
    field => patch[field] !== undefined,
  )
  if (patch.rename !== undefined) touched.push('name')
  const base: OrgRecord = existing ?? {
    id: orgKey(name),
    name,
    sources: [],
    firstSeenAt: now,
    lastSeenAt: now,
    seenCount: 0,
    updatedAt: now,
  }
  const next: OrgRecord = {
    ...base,
    ...(patch.rename?.trim() ? { name: patch.rename.trim() } : {}),
    ...(patch.aliases !== undefined ? { aliases: patch.aliases } : {}),
    ...(patch.industry !== undefined
      ? { industry: patch.industry.trim() }
      : {}),
    ...(patch.owner !== undefined ? { owner: patch.owner.trim() } : {}),
    ...(patch.status !== undefined ? { status: patch.status.trim() } : {}),
    ...(patch.city !== undefined ? { city: patch.city.trim() } : {}),
    ...(patch.country !== undefined ? { country: patch.country.trim() } : {}),
    ...(patch.phones !== undefined ? { phones: patch.phones } : {}),
    ...(patch.domains !== undefined
      ? {
          domains: patch.domains
            .map(domain => domain.trim().toLowerCase().replace(/^@/, ''))
            .filter(Boolean),
        }
      : {}),
    ...(patch.links !== undefined
      ? { links: normalizeLinks(patch.links) }
      : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.notesHtml !== undefined
      ? { notesHtml: patch.notesHtml }
      : patch.notes !== undefined
        ? { notesHtml: undefined }
        : {}),
    ...(patch.avatarUrl !== undefined
      ? { avatarUrl: patch.avatarUrl.trim() }
      : {}),
    sources: stampSource(base.sources, by, now),
    lockedFields: [...new Set([...(base.lockedFields ?? []), ...touched])],
    updatedAt: now,
  }
  const orgs = existing
    ? storeOrgs(store).map(org => (org.id === existing.id ? next : org))
    : [...storeOrgs(store), next]
  return { store: { ...store, orgs, updatedAt: now }, org: next }
}

export function removeOrg(store: PeopleStore, idOrName: string): PeopleStore {
  const key = orgKey(idOrName)
  return {
    ...store,
    orgs: storeOrgs(store).filter(org => !orgMatchesKey(org, key)),
    updatedAt: new Date().toISOString(),
  }
}

/** One imported org row. Merged fill-empty, like contact feed entries. */
export interface OrgImportEntry {
  name: string
  seenAt: string
  lastActivityAt?: string
  owner?: string
  industry?: string
  city?: string
  country?: string
  phones?: string[]
  links?: ContactLink[]
  tags?: string[]
  notes?: string
  aliases?: string[]
  domains?: string[]
  status?: string
  avatarUrl?: string
  context?: string
}

export function mergeOrgImportEntry(
  store: PeopleStore,
  entry: OrgImportEntry,
): PeopleStore {
  const name = entry.name.trim()
  if (!name) return store
  const seenAt = entry.seenAt
  const lastAt = entry.lastActivityAt ?? seenAt
  const existing = orgByIdOrName(store, name)
  if (!existing) {
    const record: OrgRecord = {
      id: orgKey(name),
      name,
      ...(entry.industry?.trim() ? { industry: entry.industry.trim() } : {}),
      ...(entry.owner?.trim() ? { owner: entry.owner.trim() } : {}),
      ...(entry.city?.trim() ? { city: entry.city.trim() } : {}),
      ...(entry.country?.trim() ? { country: entry.country.trim() } : {}),
      ...(entry.phones?.length ? { phones: entry.phones } : {}),
      ...(normalizeLinks(entry.links)
        ? { links: normalizeLinks(entry.links) }
        : {}),
      ...(entry.tags?.length ? { tags: entry.tags } : {}),
      ...(entry.notes?.trim() ? { notes: entry.notes.trim() } : {}),
      ...(entry.aliases?.length ? { aliases: entry.aliases } : {}),
      ...(entry.domains?.length ? { domains: entry.domains } : {}),
      ...(entry.status?.trim() ? { status: entry.status.trim() } : {}),
      ...(entry.avatarUrl?.trim()
        ? { avatarUrl: entry.avatarUrl.trim() }
        : {}),
      sources: stampSource([], 'import', seenAt, entry.context),
      firstSeenAt: seenAt,
      lastSeenAt: lastAt,
      seenCount: 1,
      updatedAt: seenAt,
    }
    return {
      ...store,
      orgs: [...storeOrgs(store), record],
      updatedAt: seenAt,
    }
  }
  const merged: OrgRecord = { ...existing }
  for (const field of [
    'industry',
    'owner',
    'city',
    'country',
    'notes',
    'status',
    'avatarUrl',
  ] as const) {
    const incoming = entry[field]?.trim()
    if (incoming && !existing[field] && !isLocked(existing, field)) {
      merged[field] = incoming
    }
  }
  if (
    entry.phones?.length &&
    !existing.phones?.length &&
    !isLocked(existing, 'phones')
  ) {
    merged.phones = entry.phones
  }
  const links = normalizeLinks(entry.links)
  if (links && !existing.links?.length && !isLocked(existing, 'links')) {
    merged.links = links
  }
  for (const field of ['tags', 'aliases', 'domains'] as const) {
    const incoming = entry[field]
    if (
      incoming?.length &&
      !existing[field]?.length &&
      !isLocked(existing, field)
    ) {
      merged[field] = incoming
    }
  }
  merged.sources = stampSource(
    existing.sources,
    'import',
    seenAt,
    entry.context,
  )
  merged.seenCount = existing.seenCount + 1
  if (lastAt > existing.lastSeenAt) merged.lastSeenAt = lastAt
  if (seenAt < existing.firstSeenAt) merged.firstSeenAt = seenAt
  merged.updatedAt = seenAt
  return {
    ...store,
    orgs: storeOrgs(store).map(org =>
      org.id === existing.id ? merged : org,
    ),
    updatedAt: seenAt,
  }
}

/**
 * Substring search over name, aliases, industry, place, owner and tags,
 * ranked by activity recency then name.
 */
export function searchOrgs(
  store: PeopleStore,
  query: string,
  limit = 200,
): OrgRecord[] {
  const needle = query.trim().toLowerCase()
  return storeOrgs(store)
    .filter(org => {
      if (!needle) return true
      return [
        org.name,
        ...(org.aliases ?? []),
        org.industry ?? '',
        org.city ?? '',
        org.country ?? '',
        org.owner ?? '',
        org.status ?? '',
        ...(org.tags ?? []),
        ...(org.domains ?? []),
      ]
        .join('\n')
        .toLowerCase()
        .includes(needle)
    })
    .sort(
      (a, b) =>
        b.lastSeenAt.localeCompare(a.lastSeenAt) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit)
}

/** The computed org↔people join: org text match or email-domain match. */
export function contactMatchesOrg(
  contact: ContactRecord,
  org: OrgRecord,
): boolean {
  for (const name of [contact.org ?? '', ...(contact.alternatives?.org ?? [])]) {
    const key = orgKey(name)
    if (orgMatchesKey(org, key)) return true
  }
  if (org.domains?.length) {
    return contact.emails.some(email => {
      const domain = normalizeEmail(email).split('@')[1] ?? ''
      return org.domains!.includes(domain)
    })
  }
  return false
}

export function peopleForOrg(
  store: PeopleStore,
  org: OrgRecord,
): ContactRecord[] {
  return store.contacts.filter(contact => contactMatchesOrg(contact, org))
}

export function orgForContact(
  store: PeopleStore,
  contact: ContactRecord,
): OrgRecord | undefined {
  return storeOrgs(store).find(org => contactMatchesOrg(contact, org))
}
