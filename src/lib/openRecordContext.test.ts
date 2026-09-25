import { describe, expect, it } from 'vitest'
import type { ContactRecord, OrgRecord } from '../types'
import { serializeOpenRecordContext } from './openRecordContext'

const timestamps = {
  sources: [{ app: 'mail', at: '2026-09-20T10:00:00.000Z' }],
  firstSeenAt: '2026-09-01T10:00:00.000Z',
  lastSeenAt: '2026-09-20T10:00:00.000Z',
  seenCount: 3,
  updatedAt: '2026-09-21T10:00:00.000Z',
}

describe('open record drawer context', () => {
  it('identifies the exact open person without publishing image or rich HTML data', () => {
    const record: ContactRecord = {
      id: 'maya@example.test',
      name: 'Maya Example',
      emails: ['maya@example.test', 'maya@lab.test'],
      org: 'Example Lab',
      title: 'Research lead',
      notes: 'Met at the autumn workshop.',
      notesHtml: '<p>Met at the <strong>autumn workshop</strong>.</p>',
      avatarUrl: 'data:image/png;base64,very-large-image',
      ...timestamps,
    }

    const context = JSON.parse(
      serializeOpenRecordContext({ kind: 'person', record }),
    )

    expect(context).toMatchObject({
      contextType: 'purepeople-open-record',
      currentlyOpen: true,
      kind: 'person',
      record: {
        id: 'maya@example.test',
        name: 'Maya Example',
        emails: ['maya@example.test', 'maya@lab.test'],
        organisation: 'Example Lab',
      },
    })
    expect(context.record).not.toHaveProperty('avatarUrl')
    expect(context.record).not.toHaveProperty('notesHtml')
  })

  it('identifies an open organisation by its stable id and visible fields', () => {
    const record: OrgRecord = {
      id: 'example-lab',
      name: 'Example Lab',
      aliases: ['EL'],
      domains: ['example.test'],
      industry: 'Research',
      ...timestamps,
    }

    const context = JSON.parse(
      serializeOpenRecordContext({ kind: 'organisation', record }),
    )

    expect(context).toMatchObject({
      kind: 'organisation',
      record: {
        id: 'example-lab',
        name: 'Example Lab',
        aliases: ['EL'],
        domains: ['example.test'],
        industry: 'Research',
      },
    })
  })

  it('bounds long notes while preserving the instruction to read the full record', () => {
    const record: ContactRecord = {
      id: 'long@example.test',
      name: 'Long Notes',
      emails: ['long@example.test'],
      notes: 'x'.repeat(7_000),
      ...timestamps,
    }

    const context = JSON.parse(
      serializeOpenRecordContext({ kind: 'person', record }),
    )

    expect(context.record.notes.length).toBeLessThan(7_000)
    expect(context.record.notes).toContain('Read the record with the app tool')
  })
})
