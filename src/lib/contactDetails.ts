import type { ContactRecord, PeopleStore } from '../types'
import { retainAlternatives, type alternativeFields } from './contactConsolidation'
import { notesTextFromHtml, sanitizeNotesHtml } from './sanitizeNotesHtml'

export type RetainedField = typeof alternativeFields[number] | 'notes'
export interface RetainedEdit { field: RetainedField; index: number; value?: string; primary?: boolean }
export type EditRetained = (edit: RetainedEdit) => void

export function editRetainedDetail(store: PeopleStore, id: string, edit: RetainedEdit): PeopleStore {
  const before = store.contacts.find(contact => contact.id === id)
  if (!before) throw new Error('Person no longer exists.')
  const next: ContactRecord = { ...before, alternatives: { ...before.alternatives }, updatedAt: new Date().toISOString(), lockedFields: [...new Set([...(before.lockedFields ?? []), edit.field])] }
  if (edit.field === 'notes') {
    const values = [...(before.alternatives?.notes ?? [])]
    const note = values[edit.index]
    if (!note) return store
    if (edit.primary) {
      next.notes = note.notes
      next.notesHtml = note.notesHtml
      next.alternatives = retainAlternatives(next, before)
    } else {
      const notesHtml = sanitizeNotesHtml(edit.value ?? '')
      values[edit.index] = { notesHtml, notes: notesTextFromHtml(notesHtml) }
      next.alternatives!.notes = values
    }
  } else {
    const values = [...(before.alternatives?.[edit.field] ?? [])]
    const value = values[edit.index]
    if (value === undefined) return store
    if (edit.primary) {
      next[edit.field] = value
      next.alternatives = retainAlternatives(next, before)
    } else {
      values[edit.index] = edit.value?.trim() ?? ''
      next.alternatives![edit.field] = values
    }
  }
  return { ...store, updatedAt: next.updatedAt, contacts: store.contacts.map(contact => contact.id === id ? next : contact) }
}
