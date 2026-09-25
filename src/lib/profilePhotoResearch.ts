import type { ContactRecord } from '../types'

export type ProfilePhotoResearchMode = 'light' | 'comprehensive'

export interface ProfilePhotoResearchBrief {
  contact: {
    id: string
    name: string
    emails: string[]
    org?: string
    title?: string
    links: ContactRecord['links']
    currentAvatar?: string
  }
  mode: ProfilePhotoResearchMode
  searchBudget: string
  sourceOrder: string[]
  rules: string[]
  suggestedQueries: string[]
  finish: string
}

function quoted(value: string): string {
  return `"${value.replaceAll('"', '')}"`
}

export function profilePhotoResearchBrief(
  contact: ContactRecord,
  mode: ProfilePhotoResearchMode,
): ProfilePhotoResearchBrief {
  const discriminator =
    contact.org || contact.title || contact.emails[0]?.split('@')[1] || ''
  const baseQuery = [quoted(contact.name), discriminator]
    .filter(Boolean)
    .join(' ')
  const comprehensive = mode === 'comprehensive'

  return {
    contact: {
      id: contact.id,
      name: contact.name,
      emails: contact.emails,
      ...(contact.org ? { org: contact.org } : {}),
      ...(contact.title ? { title: contact.title } : {}),
      links: contact.links ?? [],
      ...(contact.avatarUrl ? { currentAvatar: contact.avatarUrl } : {}),
    },
    mode,
    searchBudget: comprehensive
      ? 'Use several targeted lookups, stopping as soon as one high-confidence portrait has been verified.'
      : 'Use at most two targeted lookups. Do not run a broad image search.',
    sourceOrder: comprehensive
      ? [
          'Wikidata identity match and its Wikimedia Commons P18 image',
          'official staff, author, speaker, publication, or personal profile page',
          'an already-linked verified GitHub or comparable public profile',
          'LinkedIn for identity confirmation; use its image only when the direct URL is public and durable',
          'web image search for discovery only; open and verify the source page',
        ]
      : [
          'the record’s existing links',
          'an exact Wikidata identity match with a Wikimedia Commons P18 image',
          'one official profile page on the known organisation or email domain',
        ],
    rules: [
      'Match the name and at least one strong discriminator; for a common name require two record facts.',
      'Choose a clear single-person portrait, not a logo, group, search thumbnail, proxy, or expiring signed URL.',
      'LinkedIn is identity evidence, not a preferred image host.',
      'When identity remains uncertain, leave the image unchanged and report the candidates.',
      'Preserve existing links when adding the verified source page.',
    ],
    suggestedQueries: [
      baseQuery,
      `${baseQuery} site:wikidata.org`,
      ...(comprehensive
        ? [
            `${baseQuery} profile`,
            `${baseQuery} LinkedIn`,
            `${baseQuery} speaker OR author`,
          ]
        : []),
    ],
    finish:
      'If one result is high confidence, save its direct public image URL with upsertContact and retain the verified source page in links. Otherwise explain what remains ambiguous.',
  }
}

export function comprehensivePhotoResearchPrompt(
  contact: ContactRecord,
): string {
  return [
    `Find the best durable profile photo for the open PurePeople record “${contact.name}” (${contact.id}).`,
    `First call prepareProfilePhotoResearch with contact “${contact.id}” and mode “comprehensive”, then follow that brief.`,
    'Do the research in this assistant drawer. Do not ask the app to call a model or start a separate agent.',
    'If one portrait is a high-confidence identity match, preserve the existing links and save the image and its source with upsertContact. If the result is ambiguous, do not change the record; show me the candidates instead.',
  ].join(' ')
}
