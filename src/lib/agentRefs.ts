import type { ContactRecord, OrgRecord, PeopleList } from '../types'

/**
 * How PurePeople's items are named to the suite's activity layer (AgentActivityLayer, in AppFrame): an element
 * carries `data-agent-ref`, and an agent's tool call that names one of those refs, in its arguments or in a read's
 * answer, marks that element while it runs. Refs are the exact values the tools take, plain and as `argument:value`.
 *
 * Refs are space-separated, so a value with a space in it (a two-word org or list name, an org id made from one)
 * cannot be a ref and is left out; such an item is still marked through its other refs.
 */
export interface AgentRefProps {
  'data-agent-ref': string
  'data-agent-label': string
}

function refProps(values: Array<string | undefined>, keyed: Array<[string, string | undefined]>, label: string): AgentRefProps {
  const refs = new Set<string>()
  const add = (ref: string) => { if (ref && !/\s/.test(ref)) refs.add(ref) }
  for (const value of values) if (value) add(value.trim())
  for (const [key, value] of keyed) if (value?.trim()) add(`${key}:${value.trim()}`)
  return { 'data-agent-ref': [...refs].join(' '), 'data-agent-label': label }
}

/**
 * A person: their id and every address, as getContact (`idOrEmail`), prepareProfilePhotoResearch / setEventPrep /
 * getPersonNetwork (`contact`), upsertContact (`email`, `addEmails`), addToList / removeFromList (`emails`) and
 * mergeContacts (`survivorId`, `absorbedId`) take them, and as list/read answers return them (`id`).
 */
export function contactAgentRefs(contact: Pick<ContactRecord, 'id' | 'name' | 'emails'>): AgentRefProps {
  const emails = [...new Set(contact.emails.flatMap(email => [email, email.toLowerCase()]))]
  const idOrEmail = [contact.id, ...emails]
  return refProps(
    idOrEmail,
    [
      ['id', contact.id],
      ['survivorId', contact.id],
      ['absorbedId', contact.id],
      ...idOrEmail.flatMap(value => [['idOrEmail', value], ['contact', value]] as Array<[string, string]>),
      ...emails.flatMap(email => [['email', email], ['emails', email], ['addEmails', email]] as Array<[string, string]>),
    ],
    contact.name || contact.emails[0] || contact.id,
  )
}

/**
 * An organisation: id, name and aliases, as getOrg (`idOrName`) and upsertOrg (`name`) take them, as upsertContact
 * names a person's organisation (`org`), and as listOrgs / getOrg answers return it (`id`).
 */
export function orgAgentRefs(org: Pick<OrgRecord, 'id' | 'name' | 'aliases'>): AgentRefProps {
  const names = [...new Set([org.name, ...(org.aliases ?? [])].flatMap(name => [name, name.trim().toLowerCase()]))]
  const idOrName = [org.id, ...names]
  return refProps(
    idOrName,
    [
      ['id', org.id],
      ...idOrName.flatMap(value => [['idOrName', value], ['name', value]] as Array<[string, string]>),
      ...names.map(name => ['org', name] as [string, string]),
    ],
    org.name,
  )
}

/**
 * A list: id and name, as listContacts, renameList, deleteList, addToList, removeFromList, getEventBoard,
 * setEventPrep and getPersonNetwork take it (`list`), as createList names it (`name`), and as listLists returns it.
 */
export function listAgentRefs(list: Pick<PeopleList, 'id' | 'name'>): AgentRefProps {
  const idOrName = [...new Set([list.id, list.name, list.name.trim().toLowerCase()])]
  return refProps(
    idOrName,
    [
      ['id', list.id],
      ...idOrName.flatMap(value => [['list', value], ['name', value]] as Array<[string, string]>),
    ],
    list.name,
  )
}

/** A search-scoped event board, as getEventBoard / setEventPrep / getPersonNetwork take it (`query`). */
export function searchBoardAgentRefs(query: string, label: string): AgentRefProps {
  return refProps([query], [['query', query]], label)
}
