/**
 * PurePeople's domain: one merged record per person, fed primarily by the
 * OTHER apps in the suite. Feeds fill gaps and stamp activity; explicit
 * edits (user or agent) lock their fields so a feed can never overwrite a
 * curated value.
 */

export interface ContactSourceStamp {
  /** Feeding app slug ('mail', 'calendar', …) or 'user' / 'agent'. */
  app: string
  /** ISO timestamp of the latest sighting from this source. */
  at: string
  /** Optional one-line context, e.g. a thread subject. */
  context?: string
}

/** A labeled URL on a person — LinkedIn, homepage, GitHub, anything. */
export interface ContactLink {
  label: string
  url: string
}

/** Conflicting display values retained by consolidation, without a size limit. */
export interface ContactAlternatives {
  name?: string[]
  org?: string[]
  title?: string[]
  status?: string[]
  avatarUrl?: string[]
  /** Keep each rich note paired with its own plain-text mirror. */
  notes?: { notes?: string; notesHtml?: string }[]
}

export interface ContactRecord {
  /** Durable merge receipts and deletions still to finish; saved with the full survivor. */
  mergeProgress?: { absorbedIds: string[]; pendingIds: string[] }

  alternatives?: ContactAlternatives

  /** Stable identity, retained even when the primary email changes. */
  id: string
  name: string
  /** All known addresses for this person; the primary first. */
  emails: string[]
  org?: string
  title?: string
  phones?: string[]
  /** Plain-text notes — the searchable/agent-facing mirror of notesHtml. */
  notes?: string
  /** Rich-text notes (sanitized HTML) as edited in the app. */
  notesHtml?: string
  /** Profile picture URL (https or data:image). */
  avatarUrl?: string
  /** Labeled web links (LinkedIn, homepage, social media, …). */
  links?: ContactLink[]
  /** Lists this person belongs to, by list id. */
  listIds?: string[]
  tags?: string[]
  /** Relationship/lead status, e.g. from a CRM import ("In Progress"). */
  status?: string
  /** Interests / favorite content topics. */
  topics?: string[]
  /** Preferred contact channels. */
  channels?: string[]
  /** Latest sighting per source app, newest first. */
  sources: ContactSourceStamp[]
  firstSeenAt: string
  lastSeenAt: string
  /** How many feed events mentioned this person — interaction weight. */
  seenCount: number
  /**
   * Field names set explicitly by the user or an agent. Feeds only fill
   * EMPTY fields and never touch a locked one.
   */
  lockedFields?: string[]
  /**
   * Preparing to meet this person, per board: the key is the board's scope
   * (a list id, or `search:<query>`), so a star for one event never shows at
   * another.
   */
  prep?: Record<string, EventPrep>
  updatedAt: string
}

/** One person's preparation for one event board. */
export interface EventPrep {
  /** Starred as someone to meet. */
  meet?: boolean
  /** What to ask or bring; never printed anywhere but the briefing. */
  note?: string
  /** When they were met at the event (YYYY-MM-DD). */
  metAt?: string
  updatedAt: string
}

/**
 * A thread or meeting several people were on, written by the app that saw it
 * (PureMail threads, calendar meetings). People only reads these: they are
 * what connections and the network graph are drawn from. Addresses are
 * lowercased and exclude the user's own and machine senders.
 */
export interface EncounterRecord {
  id: string
  kind: 'thread' | 'meeting'
  sourceApp: string
  subject?: string
  /** Latest message or meeting time. */
  at: string
  /** Everyone on it, other than the user. */
  emails: string[]
  /** Messages in the thread, or 1 for a meeting. */
  count?: number
}

/**
 * An organisation record. Orgs are linked to people COMPUTED, not by
 * stored foreign keys: a contact belongs to an org when its `org` text
 * matches the org's name or aliases, or its email domain is listed in
 * the org's `domains` — so links survive imports, renames, and edits
 * from either side.
 */
export interface OrgRecord {
  /** Stable id: the normalized name at creation time. */
  id: string
  name: string
  /** Alternate names ("APA" for "American Psychological Association"). */
  aliases?: string[]
  industry?: string
  /** Who owns the relationship (CRM "Company owner"). */
  owner?: string
  /** Relationship/lead status. */
  status?: string
  city?: string
  country?: string
  phones?: string[]
  /** Email domains that link people to this org (e.g. "organization.example"). */
  domains?: string[]
  links?: ContactLink[]
  tags?: string[]
  notes?: string
  notesHtml?: string
  /** Logo / picture URL. */
  avatarUrl?: string
  sources: ContactSourceStamp[]
  firstSeenAt: string
  lastSeenAt: string
  seenCount: number
  lockedFields?: string[]
  updatedAt: string
}

/**
 * A named collection of people the user curates — "publisher.example contacts",
 * "investors". Distinct from tags: a tag describes a person, a list is
 * something you open and work through, so it exists even while empty and
 * carries its own name you can rename without touching anyone's record.
 */
export interface PeopleList {
  id: string
  name: string
  createdAt: string
}

export interface PeopleStore {
  storeVersion: number
  contacts: ContactRecord[]
  orgs?: OrgRecord[]
  lists?: PeopleList[]
  /** Threads and meetings from other apps; read-only here. */
  encounters?: EncounterRecord[]
  updatedAt: string
}

export type PeopleUpdate = (updater: (current: PeopleStore) => PeopleStore) => Promise<PeopleStore>

/**
 * One pending row in the `people` app's `contactFeed` collection. People
 * commits the contact changes before deleting the consumed entry.
 */
export interface ContactFeedEntry {
  id: string
  sourceApp: string
  seenAt: string
  contact: {
    email: string
    /** Lossless details from a PurePeople CSV backup. */
    retained?: ContactAlternatives
    notesHtml?: string
    name?: string
    /** Additional addresses known to belong to the same person. */
    emails?: string[]
    org?: string
    title?: string
    phones?: string[]
    notes?: string
    avatarUrl?: string
    links?: ContactLink[]
    tags?: string[]
    /** List NAMES; the merge resolves them to ids, creating as needed. */
    lists?: string[]
    status?: string
    topics?: string[]
    channels?: string[]
  }
  context?: string
}
