import type { ContactRecord } from '../../types'
import { alternativeFields } from '../../lib/contactConsolidation'
import type { EditRetained } from '../../lib/contactDetails'
import { sanitizeNotesHtml } from '../../lib/sanitizeNotesHtml'
import { Action, Actions, Field, Stack } from '../common/RecordControls'

interface RetainedDetailsProps { contact: ContactRecord; onEdit: EditRetained; onOpenOrg: (name: string) => void }
const labels = { name: 'Name', org: 'Organisation', title: 'Role', status: 'Status', avatarUrl: 'Picture URL' }
export function RetainedDetails({ contact, onEdit, onOpenOrg }: RetainedDetailsProps) {
  if (!alternativeFields.some(field => contact.alternatives?.[field]?.length) && !contact.alternatives?.notes?.length) return null
  return <details><summary>Retained alternative details</summary><Stack>
    <p>All merged values remain here. Making one primary keeps the previous primary as an alternative.</p>
    {alternativeFields.flatMap(field => (contact.alternatives?.[field] ?? []).map((value, index) => <Stack key={`${field}-${index}-${value}`}>
      <label>{labels[field]}<Actions>
        <Field aria-label={`Alternative ${labels[field]} ${index + 1}`} defaultValue={value} onBlur={event => { if (event.target.value !== value) onEdit({ field, index, value: event.target.value }) }} />
        <Action onClick={() => onEdit({ field, index, primary: true })}>Make primary</Action>
      </Actions></label>
      {field === 'avatarUrl' && value && <img src={value} alt="Alternative profile" width="64" height="64" />}
      {field === 'org' && value && <Action onClick={() => onOpenOrg(value)}>Open {value}</Action>}
    </Stack>))}
    {(contact.alternatives?.notes ?? []).map((note, index) => <Stack key={`${index}-${note.notesHtml ?? note.notes}`}>
      <strong>Alternative note {index + 1}</strong>
      <div contentEditable suppressContentEditableWarning role="textbox" aria-label={`Alternative note ${index + 1}`} dangerouslySetInnerHTML={{ __html: sanitizeNotesHtml(note.notesHtml ?? escapeText(note.notes ?? '')) }} onBlur={event => onEdit({ field: 'notes', index, value: event.currentTarget.innerHTML })} />
      <Action onClick={() => onEdit({ field: 'notes', index, primary: true })}>Make primary note</Action>
    </Stack>)}
  </Stack></details>
}
function escapeText(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') }
