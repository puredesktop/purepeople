import type { PeopleStore } from '../types'
import { storeOrgs } from './orgsModel'
import { listsForContact } from './peopleLists'

/**
 * CSV export for people and organisations — the backup half of import.
 * Headers are chosen so our own importer maps every column back
 * (csvImport.ts), making export → import a faithful round trip for the
 * data itself. JSON detail columns preserve alternatives and rich notes.
 */

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(',')
}

/** "2026-08-24 12:00" — the format the importer's date parser reads. */
function csvDate(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

function linksCell(
  links: { label: string; url: string }[] | undefined,
): string {
  return (links ?? [])
    .map(link => `${link.label.replace(/[|;]/g, ' ')}|${link.url}`)
    .join('; ')
}

const CONTACT_HEADERS = [
  'Name',
  'Email',
  'Emails',
  'Phone Number',
  'Organisation',
  'Job Title',
  'Status',
  'Topics',
  'Preferred Channels',
  'Tags',
  'Lists',
  'Links',
  'Notes',
  'Avatar URL',
  'Create Date',
  'Retained Details',
  'Notes HTML',
]

export function contactsToCsv(store: PeopleStore): string {
  const rows = store.contacts.map(contact =>
    csvRow([
      contact.name,
      contact.emails[0] ?? '',
      contact.emails.join('; '),
      (contact.phones ?? []).join('; '),
      contact.org ?? '',
      contact.title ?? '',
      contact.status ?? '',
      (contact.topics ?? []).join('; '),
      (contact.channels ?? []).join('; '),
      (contact.tags ?? []).join('; '),
      listsForContact(store, contact)
        .map(list => list.name)
        .join('; '),
      linksCell(contact.links),
      contact.notes ?? '',
      contact.avatarUrl ?? '',
      csvDate(contact.firstSeenAt),
      JSON.stringify(contact.alternatives ?? {}),
      contact.notesHtml ?? '',
    ]),
  )
  return [csvRow(CONTACT_HEADERS), ...rows].join('\r\n') + '\r\n'
}

const ORG_HEADERS = [
  'Company name',
  'Aliases',
  'Industry',
  'Company owner',
  'Status',
  'City',
  'Country/Region',
  'Phone Number',
  'Email Domains',
  'Tags',
  'Links',
  'Notes',
  'Avatar URL',
  'Create Date',
  'Last Activity Date',
]

export function orgsToCsv(store: PeopleStore): string {
  const rows = storeOrgs(store).map(org =>
    csvRow([
      org.name,
      (org.aliases ?? []).join('; '),
      org.industry ?? '',
      org.owner ?? '',
      org.status ?? '',
      org.city ?? '',
      org.country ?? '',
      (org.phones ?? []).join('; '),
      (org.domains ?? []).join('; '),
      (org.tags ?? []).join('; '),
      linksCell(org.links),
      org.notes ?? '',
      org.avatarUrl ?? '',
      csvDate(org.firstSeenAt),
      csvDate(org.lastSeenAt),
    ]),
  )
  return [csvRow(ORG_HEADERS), ...rows].join('\r\n') + '\r\n'
}
