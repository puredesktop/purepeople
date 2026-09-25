import { alternativeFields } from './contactConsolidation'
import { sanitizeNotesHtml } from './sanitizeNotesHtml'
import type { ContactAlternatives } from '../types'
import type { ContactFeedEntry } from '../types'
import { isMachineEmail, normalizeEmail } from './contactsModel'
import type { OrgImportEntry } from './orgsModel'

/**
 * CSV contact import. One engine: a header-mapping table covers generic
 * exports (name/email/phone/org/… under their common aliases), and a
 * detected profile (HubSpot today) layers source-specific cleanups on
 * top — "Last, First" name flips, HTML-entity junk, sample contacts.
 *
 * Rows become ContactFeedEntry values and run through the SAME merge as
 * app feeds: dedupe by any known address, fill empty fields only, never
 * touch a locked field. An import can therefore never destroy curation.
 */

export interface CsvImportRowSkip {
  row: number
  name: string
  reason: 'no email' | 'machine address' | 'sample contact'
}

export interface CsvImportParse {
  kind: 'contacts'
  profile: 'hubspot' | 'generic'
  entries: ContactFeedEntry[]
  skipped: CsvImportRowSkip[]
}

export interface OrgCsvImportParse {
  kind: 'orgs'
  profile: 'hubspot' | 'generic'
  entries: OrgImportEntry[]
  /** 1-based CSV line numbers of rows without a company name. */
  skippedRows: number[]
}

/**
 * One entry point for the Import button: a CSV with an email column is
 * people; otherwise a CSV with a company/name column is organisations.
 */
export function parseImportCsv(
  text: string,
  now = new Date().toISOString(),
): CsvImportParse | OrgCsvImportParse {
  const header = (parseCsv(text)[0] ?? []).map(cell =>
    cell.trim().toLowerCase(),
  )
  const hasEmail = header.some(cell => ['email', 'allEmails'].includes(HEADER_MAP[cell]))
  if (hasEmail) return parseContactsCsv(text, now)
  return parseOrgsCsv(text, now)
}

/** RFC-4180-ish parser: quoted fields, "" escapes, newlines in quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const pushField = (): void => {
    row.push(field)
    field = ''
  }
  const pushRow = (): void => {
    pushField()
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') inQuotes = true
    else if (char === ',') pushField()
    else if (char === '\n') pushRow()
    else if (char !== '\r') field += char
  }
  if (inQuotes) throw new Error('CSV ends inside an unclosed quoted field.')
  if (field !== '' || row.length > 0) pushRow()
  return rows
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Header aliases → canonical column keys, matched case-insensitively. */
const HEADER_MAP: Record<string, string> = {
  'retained details': 'retained',
  'notes html': 'notesHtml',
  email: 'email',
  'e-mail': 'email',
  'email address': 'email',
  'primary email': 'email',
  emails: 'allEmails',
  links: 'links',
  name: 'name',
  'full name': 'name',
  'first name': 'firstName',
  'given name': 'firstName',
  'last name': 'lastName',
  'family name': 'lastName',
  surname: 'lastName',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
  telephone: 'phone',
  organisation: 'org',
  organization: 'org',
  company: 'org',
  'company name': 'org',
  org: 'org',
  employer: 'org',
  title: 'title',
  'job title': 'title',
  role: 'title',
  position: 'title',
  notes: 'notes',
  description: 'notes',
  tags: 'tags',
  labels: 'tags',
  lists: 'lists',
  status: 'status',
  'lead status': 'status',
  topics: 'topics',
  interests: 'topics',
  'favorite content topics': 'topics',
  channels: 'channels',
  'preferred channels': 'channels',
  linkedin: 'linkedin',
  'linkedin url': 'linkedin',
  website: 'website',
  homepage: 'website',
  url: 'website',
  'avatar url': 'avatar',
  photo: 'avatar',
  image: 'avatar',
  'create date': 'createdAt',
  created: 'createdAt',
  'created at': 'createdAt',
}

function cleanName(first: string, last: string, isHubspot: boolean): string {
  let a = decodeEntities(first).trim()
  let b = decodeEntities(last).trim()
  // Junk like `"Taylor Example (Google Docs)" <address>` — keep the words.
  a = a.replace(/<[^>]*>/g, '').replace(/^"+|"+$/g, '').trim()
  b = b.replace(/<[^>]*>/g, '').replace(/^"+|"+$/g, '').trim()
  if (isHubspot) {
    // "EXAMPLE, Jordan" in one field (other empty) is Last, First.
    const flip = (value: string): string => {
      const match = /^([^,]+),\s*(.+)$/.exec(value)
      return match ? `${match[2]!.trim()} ${match[1]!.trim()}` : value
    }
    if (a.includes(',') && !b) a = flip(a)
    else if (b.includes(',') && !a) b = flip(b)
    else if (a.endsWith(',')) {
      // First field "Example," + last field "Cameron" — surname came first.
      const surname = a.slice(0, -1).trim()
      a = b
      b = surname
    }
  }
  return [a, b].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function splitList(value: string): string[] {
  return value
    .split(/[;,]/)
    .map(item => item.trim())
    .filter(Boolean)
}

/** "Label|https://…; Label|https://…" or bare URLs, ';'-separated. */
function parseLinksCell(
  value: string,
): { label: string; url: string }[] {
  return value
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const bar = item.indexOf('|')
      return bar >= 0
        ? { label: item.slice(0, bar).trim(), url: item.slice(bar + 1).trim() }
        : { label: '', url: item }
    })
}

function firstEmailIn(value: string): string {
  const match = /[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/.exec(
    decodeEntities(value),
  )
  return match ? normalizeEmail(match[0]) : ''
}

function isoFromDate(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(trimmed)
      ? trimmed.replace(' ', 'T') + ':00Z'
      : trimmed,
  )
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/** Validate the optional JSON extension; ordinary CSV files need no new fields. */
function parseRetainedDetails(value: string): ContactAlternatives | undefined {
  if (!value) return undefined
  const raw: unknown = JSON.parse(value)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid retained contact details.')
  const details = raw as Record<string, unknown>
  const result: ContactAlternatives = {}
  for (const field of alternativeFields) {
    const values = details[field]
    if (values === undefined) continue
    if (!Array.isArray(values) || values.some(item => typeof item !== 'string')) throw new Error(`Invalid retained ${field}.`)
    result[field] = values
  }
  if (details.notes !== undefined) {
    if (!Array.isArray(details.notes)) throw new Error('Invalid retained notes.')
    result.notes = details.notes.map((note: unknown) => {
      if (!note || typeof note !== 'object') throw new Error('Invalid retained note.')
      const { notes, notesHtml } = note as Record<string, unknown>
      if ((notes !== undefined && typeof notes !== 'string') || (notesHtml !== undefined && typeof notesHtml !== 'string')) throw new Error('Invalid retained note text.')
      return { ...(typeof notes === 'string' ? { notes } : {}), ...(typeof notesHtml === 'string' ? { notesHtml: sanitizeNotesHtml(notesHtml) } : {}) }
    })
  }
  return result
}

export function parseContactsCsv(
  text: string,
  now = new Date().toISOString(),
): CsvImportParse {
  const rows = parseCsv(text)
  if (rows.length === 0)
    return { kind: 'contacts', profile: 'generic', entries: [], skipped: [] }
  const header = rows[0]!.map(cell => cell.trim().toLowerCase())
  const profile = header.includes('record id') ? 'hubspot' : 'generic'
  const columns = new Map<string, number>()
  header.forEach((cell, index) => {
    const key = HEADER_MAP[cell]
    if (key && !columns.has(key)) columns.set(key, index)
  })
  const cell = (row: string[], key: string): string => {
    const index = columns.get(key)
    return index === undefined ? '' : (row[index] ?? '').trim()
  }

  const entries: ContactFeedEntry[] = []
  const skipped: CsvImportRowSkip[] = []
  rows.slice(1).forEach((row, rowIndex) => {
    const name = columns.has('name')
      ? cleanName(cell(row, 'name'), '', profile === 'hubspot')
      : cleanName(
          cell(row, 'firstName'),
          cell(row, 'lastName'),
          profile === 'hubspot',
        )
    const email = firstEmailIn(cell(row, 'email')) || firstEmailIn(cell(row, 'allEmails'))
    const skip = (reason: CsvImportRowSkip['reason']): void => {
      skipped.push({ row: rowIndex + 2, name: name || '(unnamed)', reason })
    }
    if (!email) return skip('no email')
    if (isMachineEmail(email)) return skip('machine address')
    if (/\(sample contact\)/i.test(name)) return skip('sample contact')

    const phones = cell(row, 'phone')
      .split(';')
      .map(item => item.trim())
      .filter(Boolean)
    const aliasEmails = cell(row, 'allEmails')
      .split(/[;,\s]+/)
      .map(normalizeEmail)
      .filter(item => item.includes('@') && item !== email)
    const links = [
      ...parseLinksCell(cell(row, 'links')),
      ...(cell(row, 'linkedin')
        ? [{ label: 'LinkedIn', url: cell(row, 'linkedin') }]
        : []),
      ...(cell(row, 'website')
        ? [{ label: 'Homepage', url: cell(row, 'website') }]
        : []),
    ]
    entries.push({
      id: `csv_${rowIndex}`,
      sourceApp: 'import',
      seenAt: isoFromDate(cell(row, 'createdAt')) ?? now,
      context: profile === 'hubspot' ? 'HubSpot CSV import' : 'CSV import',
      contact: {
        email,
        ...(cell(row, 'retained') ? { retained: parseRetainedDetails(cell(row, 'retained')) } : {}),
        ...(cell(row, 'notesHtml') ? { notesHtml: sanitizeNotesHtml(cell(row, 'notesHtml')) } : {}),
        ...(aliasEmails.length ? { emails: aliasEmails } : {}),
        ...(name && normalizeEmail(name) !== email ? { name } : {}),
        ...(cell(row, 'org') ? { org: cell(row, 'org') } : {}),
        ...(cell(row, 'title') ? { title: cell(row, 'title') } : {}),
        ...(phones.length ? { phones } : {}),
        ...(cell(row, 'notes') ? { notes: cell(row, 'notes') } : {}),
        ...(cell(row, 'avatar') ? { avatarUrl: cell(row, 'avatar') } : {}),
        ...(links.length ? { links } : {}),
        ...(cell(row, 'tags') ? { tags: splitList(cell(row, 'tags')) } : {}),
        ...(cell(row, 'lists')
          ? { lists: splitList(cell(row, 'lists')) }
          : {}),
        ...(cell(row, 'status') ? { status: cell(row, 'status') } : {}),
        ...(cell(row, 'topics').length
          ? { topics: splitList(cell(row, 'topics')) }
          : {}),
        ...(cell(row, 'channels').length
          ? { channels: splitList(cell(row, 'channels')) }
          : {}),
      },
    })
  })
  return { kind: 'contacts', profile, entries, skipped }
}

/** Header aliases for organisation exports. */
const ORG_HEADER_MAP: Record<string, string> = {
  'company name': 'name',
  company: 'name',
  name: 'name',
  organisation: 'name',
  organization: 'name',
  'company owner': 'owner',
  owner: 'owner',
  'account owner': 'owner',
  aliases: 'aliases',
  'email domains': 'domains',
  domains: 'domains',
  status: 'status',
  'lead status': 'status',
  'avatar url': 'avatar',
  logo: 'avatar',
  links: 'links',
  industry: 'industry',
  city: 'city',
  'country/region': 'country',
  country: 'country',
  phone: 'phone',
  'phone number': 'phone',
  website: 'website',
  'website url': 'website',
  url: 'website',
  homepage: 'website',
  linkedin: 'linkedin',
  'linkedin url': 'linkedin',
  notes: 'notes',
  description: 'notes',
  tags: 'tags',
  labels: 'tags',
  'create date': 'createdAt',
  created: 'createdAt',
  'created at': 'createdAt',
  'last activity date': 'lastActivity',
  'last activity': 'lastActivity',
}

export function parseOrgsCsv(
  text: string,
  now = new Date().toISOString(),
): OrgCsvImportParse {
  const rows = parseCsv(text)
  if (rows.length === 0)
    return { kind: 'orgs', profile: 'generic', entries: [], skippedRows: [] }
  const header = rows[0]!.map(cell => cell.trim().toLowerCase())
  const profile = header.includes('record id') ? 'hubspot' : 'generic'
  const columns = new Map<string, number>()
  header.forEach((cell, index) => {
    const key = ORG_HEADER_MAP[cell]
    if (key && !columns.has(key)) columns.set(key, index)
  })
  const cell = (row: string[], key: string): string => {
    const index = columns.get(key)
    return index === undefined ? '' : (row[index] ?? '').trim()
  }
  const entries: OrgImportEntry[] = []
  const skippedRows: number[] = []
  rows.slice(1).forEach((row, rowIndex) => {
    const name = cell(row, 'name').replace(/\s+/g, ' ').trim()
    if (!name) {
      skippedRows.push(rowIndex + 2)
      return
    }
    const phones = cell(row, 'phone')
      .split(';')
      .map(item => item.trim())
      .filter(Boolean)
    const links = [
      ...parseLinksCell(cell(row, 'links')),
      ...(cell(row, 'website')
        ? [{ label: 'Homepage', url: cell(row, 'website') }]
        : []),
      ...(cell(row, 'linkedin')
        ? [{ label: 'LinkedIn', url: cell(row, 'linkedin') }]
        : []),
    ]
    entries.push({
      name,
      seenAt: isoFromDate(cell(row, 'createdAt')) ?? now,
      ...(cell(row, 'aliases')
        ? { aliases: splitList(cell(row, 'aliases')) }
        : {}),
      ...(cell(row, 'domains')
        ? { domains: splitList(cell(row, 'domains')) }
        : {}),
      ...(cell(row, 'status') ? { status: cell(row, 'status') } : {}),
      ...(cell(row, 'avatar') ? { avatarUrl: cell(row, 'avatar') } : {}),
      ...(isoFromDate(cell(row, 'lastActivity'))
        ? { lastActivityAt: isoFromDate(cell(row, 'lastActivity'))! }
        : {}),
      ...(cell(row, 'owner') ? { owner: cell(row, 'owner') } : {}),
      ...(cell(row, 'industry') ? { industry: cell(row, 'industry') } : {}),
      ...(cell(row, 'city') ? { city: cell(row, 'city') } : {}),
      ...(cell(row, 'country') ? { country: cell(row, 'country') } : {}),
      ...(phones.length ? { phones } : {}),
      ...(links.length ? { links } : {}),
      ...(cell(row, 'tags') ? { tags: splitList(cell(row, 'tags')) } : {}),
      ...(cell(row, 'notes') ? { notes: cell(row, 'notes') } : {}),
      context:
        profile === 'hubspot' ? 'HubSpot companies import' : 'CSV import',
    })
  })
  return { kind: 'orgs', profile, entries, skippedRows }
}
