import { mergeContacts } from '../lib/contactConsolidation'
import type { AgentToolHandlerResult } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  contactByIdOrEmail,
  searchContacts,
  upsertContact,
  type ContactUpsertPatch,
} from '../lib/contactsModel'
import {
  orgByIdOrName,
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
  removeFromList,
  removeList,
  renameList,
  storeLists,
} from '../lib/peopleLists'
import type { ContactAlternatives, ContactRecord, OrgRecord, PeopleStore, PeopleUpdate } from '../types'
import { profilePhotoResearchBrief, type ProfilePhotoResearchMode } from '../lib/profilePhotoResearch'

export const PUREPEOPLE_AGENT_TOOL_NAMES = [
  'listContacts',
  'getContact',
  'prepareProfilePhotoResearch',
  'upsertContact',
  'mergeContacts',
  'listOrgs',
  'getOrg',
  'upsertOrg',
  'listLists',
  'createList',
  'renameList',
  'deleteList',
  'addToList',
  'removeFromList',
  'getEventBoard',
  'setEventPrep',
  'getPersonNetwork',
] as const

export const PUREPEOPLE_AGENT_LOG_LABEL = 'purepeople'

/** A tool argument was missing or unusable. Surfaced to the model verbatim. */
export class AgentPeopleToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentPeopleToolError'
  }
}

export interface PeopleAgentToolContext {
  store: PeopleStore
  setStore: PeopleUpdate
}

function ok(payload: unknown): AgentToolHandlerResult {
  return { content: JSON.stringify(payload, null, 2) }
}

/**
 * A full record as the model should see it: the rich-notes HTML is an
 * app-side mirror of `notes`, and an uploaded avatar is a base64 JPEG
 * that would cost tens of kilobytes of context for no information — both
 * are replaced by flags. Everything else passes through untouched.
 */
export function agentRecordView<T extends {
  avatarUrl?: string
  notesHtml?: string
  alternatives?: ContactAlternatives
  mergeProgress?: ContactRecord['mergeProgress']
}>(record: T): Omit<T, 'notesHtml' | 'avatarUrl' | 'alternatives' | 'mergeProgress'> & {
  alternatives?: Omit<ContactAlternatives, 'notes'> & { notes?: { notes?: string; hasRichText?: boolean }[]; uploadedPictureCount?: number }
  avatarUrl?: string
  hasAvatar?: true
} {
  const { notesHtml: _notesHtml, avatarUrl, alternatives, mergeProgress: _mergeProgress, ...fields } = record
  const rest = {
    ...fields,
    ...(alternatives ? { alternatives: {
      ...alternatives,
      avatarUrl: alternatives.avatarUrl?.filter(url => !url.toLowerCase().startsWith('data:')),
      uploadedPictureCount: alternatives.avatarUrl?.filter(url => url.toLowerCase().startsWith('data:')).length ?? 0,
      notes: alternatives.notes?.map(note => ({ notes: note.notes, hasRichText: Boolean(note.notesHtml) })),
    } } : {}),
  }
  if (!avatarUrl) return rest
  return avatarUrl.toLowerCase().startsWith('data:')
    ? { ...rest, hasAvatar: true }
    : { ...rest, avatarUrl }
}

function summary(contact: ContactRecord): Record<string, unknown> {
  return {
    id: contact.id,
    name: contact.name,
    emails: contact.emails,
    ...(contact.alternatives ? { alternatives: agentRecordView(contact).alternatives } : {}),
    ...(contact.org ? { org: contact.org } : {}),
    ...(contact.title ? { title: contact.title } : {}),
    ...(contact.phones?.length ? { phones: contact.phones } : {}),
    ...(contact.links?.length ? { links: contact.links } : {}),
    ...(contact.tags?.length ? { tags: contact.tags } : {}),
    ...(contact.status ? { status: contact.status } : {}),
    ...(contact.topics?.length ? { topics: contact.topics } : {}),
    ...(contact.channels?.length ? { channels: contact.channels } : {}),
    ...(contact.avatarUrl ? { hasAvatar: true } : {}),
    seenCount: contact.seenCount,
    lastSeenAt: contact.lastSeenAt,
    sources: contact.sources.map(source => source.app),
  }
}

export function listContactsHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const query = typeof args.query === 'string' ? args.query : ''
  const limit =
    typeof args.limit === 'number' && Number.isFinite(args.limit)
      ? Math.max(1, Math.min(200, Math.floor(args.limit)))
      : 50
  const listArg = typeof args.list === 'string' ? args.list.trim() : ''
  const list = listArg ? listByIdOrName(context.store, listArg) : undefined
  if (listArg && !list) {
    throw new AgentPeopleToolError(
      `No list called "${listArg}". Lists: ${
        storeLists(context.store)
          .map(item => item.name)
          .join(', ') || 'none yet'
      }`,
    )
  }
  const results = searchContacts(
    context.store,
    query,
    limit,
    list ? list.id : null,
  )
  return ok({
    total: context.store.contacts.length,
    ...(list ? { list: list.name } : {}),
    lists: storeLists(context.store).map(item => item.name),
    returned: results.length,
    contacts: results.map(summary),
    note: 'Ranked by interaction weight (how often the suite has seen this person), then recency. Use getContact for full details.',
  })
}

export function getContactHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const idOrEmail = typeof args.idOrEmail === 'string' ? args.idOrEmail : ''
  if (!idOrEmail.trim()) {
    throw new AgentPeopleToolError('"idOrEmail" is required.')
  }
  const contact = contactByIdOrEmail(context.store, idOrEmail)
  if (!contact) {
    throw new AgentPeopleToolError(
      `No contact matches "${idOrEmail}". Call listContacts to see who exists.`,
    )
  }
  return ok(agentRecordView(contact))
}

/** A bounded search plan for the drawer agent. This tool itself is network-free. */
export function prepareProfilePhotoResearchHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const idOrEmail = typeof args.contact === 'string' ? args.contact.trim() : ''
  if (!idOrEmail) throw new AgentPeopleToolError('"contact" is required.')
  const contact = contactByIdOrEmail(context.store, idOrEmail)
  if (!contact) {
    throw new AgentPeopleToolError(
      `No contact matches "${idOrEmail}". Call listContacts to see who exists.`,
    )
  }
  const mode: ProfilePhotoResearchMode = args.mode === 'light' ? 'light' : 'comprehensive'
  return ok(profilePhotoResearchBrief(contact, mode))
}

function orgSummary(
  store: PeopleStore,
  org: OrgRecord,
): Record<string, unknown> {
  return {
    id: org.id,
    name: org.name,
    ...(org.aliases?.length ? { aliases: org.aliases } : {}),
    ...(org.industry ? { industry: org.industry } : {}),
    ...(org.owner ? { owner: org.owner } : {}),
    ...(org.status ? { status: org.status } : {}),
    ...(org.city ? { city: org.city } : {}),
    ...(org.country ? { country: org.country } : {}),
    ...(org.domains?.length ? { domains: org.domains } : {}),
    ...(org.tags?.length ? { tags: org.tags } : {}),
    peopleCount: peopleForOrg(store, org).length,
    lastSeenAt: org.lastSeenAt,
    sources: org.sources.map(source => source.app),
  }
}

export function listOrgsHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const query = typeof args.query === 'string' ? args.query : ''
  const limit =
    typeof args.limit === 'number' && Number.isFinite(args.limit)
      ? Math.max(1, Math.min(200, Math.floor(args.limit)))
      : 50
  const results = searchOrgs(context.store, query, limit)
  return ok({
    total: storeOrgs(context.store).length,
    returned: results.length,
    orgs: results.map(org => orgSummary(context.store, org)),
    note: 'peopleCount is the computed link: contacts whose org text matches the name/aliases, or whose email domain is in domains. Use getOrg for full details and the people list.',
  })
}

export function getOrgHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): AgentToolHandlerResult {
  const idOrName = typeof args.idOrName === 'string' ? args.idOrName : ''
  if (!idOrName.trim()) throw new AgentPeopleToolError('"idOrName" is required.')
  const org = orgByIdOrName(context.store, idOrName)
  if (!org) {
    throw new AgentPeopleToolError(
      `No organisation matches "${idOrName}". Call listOrgs to see what exists.`,
    )
  }
  return ok({
    ...agentRecordView(org),
    people: peopleForOrg(context.store, org).map(contact => ({
      id: contact.id,
      name: contact.name,
      ...(contact.title ? { title: contact.title } : {}),
      ...(contact.alternatives ? { alternatives: agentRecordView(contact).alternatives } : {}),
    })),
  })
}

export async function upsertOrgHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  if (!name) throw new AgentPeopleToolError('"name" is required.')
  const strings = (key: string): string[] | undefined => {
    const value = args[key]
    if (!Array.isArray(value)) return undefined
    return value.filter((item): item is string => typeof item === 'string')
  }
  const patch: OrgUpsertPatch = {
    name,
    ...(typeof args.rename === 'string' ? { rename: args.rename } : {}),
    ...(typeof args.industry === 'string' ? { industry: args.industry } : {}),
    ...(typeof args.owner === 'string' ? { owner: args.owner } : {}),
    ...(typeof args.status === 'string' ? { status: args.status } : {}),
    ...(typeof args.city === 'string' ? { city: args.city } : {}),
    ...(typeof args.country === 'string' ? { country: args.country } : {}),
    ...(typeof args.notes === 'string' ? { notes: args.notes } : {}),
    ...(typeof args.avatarUrl === 'string'
      ? { avatarUrl: args.avatarUrl }
      : {}),
    ...(strings('aliases') ? { aliases: strings('aliases') } : {}),
    ...(strings('phones') ? { phones: strings('phones') } : {}),
    ...(strings('domains') ? { domains: strings('domains') } : {}),
    ...(strings('tags') ? { tags: strings('tags') } : {}),
    ...(Array.isArray(args.links)
      ? {
          links: args.links
            .filter(
              (item): item is { label?: unknown; url?: unknown } =>
                Boolean(item) && typeof item === 'object',
            )
            .map(item => ({
              label: typeof item.label === 'string' ? item.label : '',
              url: typeof item.url === 'string' ? item.url : '',
            })),
        }
      : {}),
  }
  let saved: OrgRecord | null = null
  const after = await context.setStore(current => {
    const result = upsertOrg(current, patch, 'agent')
    saved = result.org
    return result.store
  })
  return ok({
    saved: saved ? orgSummary(after, saved) : { name },
    note: 'Fields you set are locked against imports. Set domains to link people by email domain; aliases to match alternate org spellings.',
  })
}

/**
 * Lists are the app's own navigation, so the agent needs to see them
 * before it can act on one: every list tool answers with the current
 * roster, and a name that matches nothing is refused with the roster
 * rather than quietly creating a near-duplicate.
 */
function listRoster(store: PeopleStore): Array<Record<string, unknown>> {
  const counts = listCounts(store)
  return storeLists(store).map(list => ({
    id: list.id,
    name: list.name,
    people: counts.get(list.id) ?? 0,
  }))
}

function requireList(store: PeopleStore, raw: unknown, field = 'list') {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name) throw new AgentPeopleToolError(`"${field}" is required.`)
  const list = listByIdOrName(store, name)
  if (!list) {
    throw new AgentPeopleToolError(
      `No list called "${name}". Lists: ${
        storeLists(store)
          .map(item => item.name)
          .join(', ') || 'none yet'
      }`,
    )
  }
  return list
}

/** Emails the caller named, paired with whether we actually know them. */
function resolvePeople(
  store: PeopleStore,
  args: Record<string, unknown>,
): { known: ContactRecord[]; unknown: string[] } {
  const raw = Array.isArray(args.emails) ? args.emails : []
  const emails = raw.filter((item): item is string => typeof item === 'string')
  if (emails.length === 0) {
    throw new AgentPeopleToolError('"emails" must name at least one person.')
  }
  const known: ContactRecord[] = []
  const unknown: string[] = []
  for (const email of emails) {
    const contact = contactByIdOrEmail(store, email)
    if (contact) known.push(contact)
    else unknown.push(email)
  }
  return { known, unknown }
}

export function listListsHandler(
  context: PeopleAgentToolContext,
): AgentToolHandlerResult {
  return ok({
    lists: listRoster(context.store),
    note: 'A list is a curated collection the user works through. Use listContacts with `list` to read one.',
  })
}

export async function createListHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  if (!name) throw new AgentPeopleToolError('"name" is required.')
  const existing = listByIdOrName(context.store, name)
  let after = context.store
  await context.setStore(current => {
    after = existing ? current : createList(current, name).store
    return after
  })
  return ok({
    created: !existing,
    list: existing ? existing.name : name,
    ...(existing ? { note: 'A list of that name already existed.' } : {}),
    lists: listRoster(after),
  })
}

export async function renameListHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const list = requireList(context.store, args.list)
  const name = typeof args.name === 'string' ? args.name.trim() : ''
  if (!name) throw new AgentPeopleToolError('"name" is required.')
  const taken = listByIdOrName(context.store, name)
  if (taken && taken.id !== list.id) {
    throw new AgentPeopleToolError(
      `A list called "${taken.name}" already exists. Pick another name, or move people with addToList/removeFromList and deleteList the spare.`,
    )
  }
  await context.setStore(current => renameList(current, list.id, name))
  return ok({
    renamed: `${list.name} → ${name}`,
    note: 'Renaming a list changes no one\u2019s record; membership is held by id.',
  })
}

export async function deleteListHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const list = requireList(context.store, args.list)
  const confirm = typeof args.name === 'string' ? args.name.trim() : ''
  if (confirm !== list.name) {
    throw new AgentPeopleToolError(
      `To delete a list, pass its exact current name as "name" (got "${confirm}", expected "${list.name}").`,
    )
  }
  const held = listCounts(context.store).get(list.id) ?? 0
  await context.setStore(current => removeList(current, list.id))
  return ok({
    deleted: list.name,
    peopleKept: held,
    note: 'The list is gone; the people who were on it are untouched.',
  })
}

export async function addToListHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const name = typeof args.list === 'string' ? args.list.trim() : ''
  if (!name) throw new AgentPeopleToolError('"list" is required.')
  const { known, unknown } = resolvePeople(context.store, args)
  const existed = Boolean(listByIdOrName(context.store, name))
  let after = context.store
  await context.setStore(current => {
    after =
      known.length > 0
        ? addToList(
            current,
            name,
            known.map(contact => contact.id),
          )
        : createList(current, name).store
    return after
  })
  const list = listByIdOrName(after, name)
  return ok({
    list: list?.name ?? name,
    holds: list ? (listCounts(after).get(list.id) ?? 0) : 0,
    ...(existed ? {} : { createdList: true }),
    added: known.map(contact => contact.name),
    ...(unknown.length
      ? {
          notFound: unknown,
          note: 'Unknown addresses were skipped — add the person first with upsertContact.',
        }
      : {}),
  })
}

export async function removeFromListHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const list = requireList(context.store, args.list)
  const { known, unknown } = resolvePeople(context.store, args)
  let after = context.store
  await context.setStore(current => {
    after = known.reduce(
      (store, contact) => removeFromList(store, list.id, contact.id),
      current,
    )
    return after
  })
  return ok({
    list: list.name,
    holds: listCounts(after).get(list.id) ?? 0,
    removed: known.map(contact => contact.name),
    ...(unknown.length ? { notFound: unknown } : {}),
    note: 'Taken off the list only — the people themselves are untouched.',
  })
}

export async function upsertContactHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const email = typeof args.email === 'string' ? args.email.trim() : ''
  if (!email) throw new AgentPeopleToolError('"email" is required.')
  const strings = (key: string): string[] | undefined => {
    const value = args[key]
    if (!Array.isArray(value)) return undefined
    return value.filter((item): item is string => typeof item === 'string')
  }
  const patch: ContactUpsertPatch = {
    email,
    ...(typeof args.name === 'string' ? { name: args.name } : {}),
    ...(typeof args.org === 'string' ? { org: args.org } : {}),
    ...(typeof args.title === 'string' ? { title: args.title } : {}),
    ...(typeof args.notes === 'string' ? { notes: args.notes } : {}),
    ...(typeof args.avatarUrl === 'string'
      ? { avatarUrl: args.avatarUrl }
      : {}),
    ...(Array.isArray(args.links)
      ? {
          links: args.links
            .filter(
              (item): item is { label?: unknown; url?: unknown } =>
                Boolean(item) && typeof item === 'object',
            )
            .map(item => ({
              label: typeof item.label === 'string' ? item.label : '',
              url: typeof item.url === 'string' ? item.url : '',
            })),
        }
      : {}),
    ...(strings('phones') ? { phones: strings('phones') } : {}),
    ...(strings('tags') ? { tags: strings('tags') } : {}),
    ...(typeof args.status === 'string' ? { status: args.status } : {}),
    ...(strings('topics') ? { topics: strings('topics') } : {}),
    ...(strings('channels') ? { channels: strings('channels') } : {}),
    ...(strings('addEmails') ? { addEmails: strings('addEmails') } : {}),
  }
  const listNames = strings('lists')
  let saved: ContactRecord | null = null
  const after = await context.setStore(current => {
    const result = upsertContact(current, patch, 'agent')
    saved = result.contact
    // Lists are named, not id'd, at this surface: a list that does not
    // exist yet is created rather than refused.
    let next = result.store
    for (const name of listNames ?? []) {
      if (name.trim()) next = addToList(next, name, [result.contact.id])
    }
    saved =
      next.contacts.find(item => item.id === result.contact.id) ?? result.contact
    return next
  })
  return ok({
    saved: saved
      ? {
          ...summary(saved),
          lists: listsForContact(after, saved).map(item => item.name),
        }
      : { email },
    note: 'Fields you set are locked: automatic feeds from other apps fill gaps but never overwrite them.',
  })
}

export async function mergeContactsHandler(
  context: PeopleAgentToolContext,
  args: Record<string, unknown>,
): Promise<AgentToolHandlerResult> {
  const survivorId = typeof args.survivorId === 'string' ? args.survivorId.trim() : ''
  const absorbedId = typeof args.absorbedId === 'string' ? args.absorbedId.trim() : ''
  if (!survivorId || !absorbedId || survivorId === absorbedId) {
    throw new AgentPeopleToolError('Choose two distinct existing contact IDs: survivorId and absorbedId.')
  }
  const saved = await mergeContacts(context.setStore, survivorId, absorbedId)
  return ok({ saved: agentRecordView(saved), note: 'Merged successfully. Differing values remain in alternatives.' })
}
