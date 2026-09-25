import { useEffect, useRef } from 'react'
import { styled } from 'styled-components'
import { searchContacts } from '../../lib/contactsModel'
import { alternativeFields, consolidateContactRecords } from '../../lib/contactConsolidation'
import type { ContactMergeWorkflow } from '../../hooks/useContactMerge'
import type { ContactRecord, PeopleStore } from '../../types'
import { Action, Actions, Field, Stack } from '../common/RecordControls'

interface MergePersonProps { store: PeopleStore; workflow: ContactMergeWorkflow }
const labels = { name: 'Names', org: 'Organisations', title: 'Roles', status: 'Statuses', avatarUrl: 'Pictures' }
export function CombinedDetails({ contact, store }: { contact: ContactRecord; store: PeopleStore }) {
  return <Stack>
    {alternativeFields.map(field => <div key={field}><strong>{labels[field]}: </strong>
      {[contact[field], ...(contact.alternatives?.[field] ?? [])].filter(Boolean).map((value, index) => <div key={index}>
        {field === 'avatarUrl' ? <img src={value} alt={`Picture ${index + 1}`} width="64" height="64" /> : value}{index === 0 ? ' (primary)' : ' (retained alternative)'}
      </div>)}
    </div>)}
    <div><strong>Emails: </strong>{contact.emails.join(', ')}</div>
    <div><strong>Phones: </strong>{contact.phones?.join(', ') || '—'}</div>
    <div><strong>Lists: </strong>{contact.listIds?.map(id => store.lists?.find(list => list.id === id)?.name ?? id).join(', ') || '—'}</div>
    <div><strong>Tags: </strong>{contact.tags?.join(', ') || '—'}</div>
    <div><strong>Topics: </strong>{contact.topics?.join(', ') || '—'}</div>
    <div><strong>Channels: </strong>{contact.channels?.join(', ') || '—'}</div>
    <div><strong>Links: </strong>{contact.links?.map(link => `${link.label}: ${link.url}`).join(', ') || '—'}</div>
    <div><strong>Notes</strong>{[{ notes: contact.notes, notesHtml: contact.notesHtml }, ...(contact.alternatives?.notes ?? [])].map((note, index) => <p key={index}>{note.notes || note.notesHtml || '—'}</p>)}</div>
  </Stack>
}
export function MergePerson({ store, workflow: w }: MergePersonProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const survivor = store.contacts.find(contact => contact.id === w.survivorId)
  const target = store.contacts.find(contact => contact.id === w.targetId)
  return <Dialog ref={dialog} onCancel={event => { event.preventDefault(); w.cancel() }} aria-labelledby="merge-heading">
    <Stack>
      <h2 id="merge-heading">Merge with another person</h2>
      <p>Keep {survivor?.name}’s identity and primary values. Differing details remain editable alternatives. Both records’ lists and contact details are retained.</p>
      {w.error && <div role="alert">Could not complete the merge: {w.error} <Action disabled={w.busy} onClick={w.targetId ? w.confirm : w.retryPreparation}>Retry</Action></div>}
      <Field autoFocus aria-label="Search all people to merge" placeholder="Search all people…" value={w.query} disabled={w.busy} onChange={event => w.setQuery(event.target.value)} />
      <Candidates aria-label="People to merge">
        {searchContacts(store, w.query, Infinity).filter(contact => contact.id !== w.survivorId).map(contact => <Action key={contact.id} disabled={w.busy} aria-pressed={contact.id === w.targetId} onClick={() => w.choose(contact.id)}>{contact.name} · {contact.emails.join(', ')}</Action>)}
        {!searchContacts(store, w.query, Infinity).some(contact => contact.id !== w.survivorId) && <p>No other people found.</p>}
      </Candidates>
      {survivor && target && <>
        <h3>Combined record preview</h3>
        <p>Keep: {survivor.name} ({survivor.id})<br />Merge into it: {target.name} ({target.id})</p>
        <CombinedDetails contact={consolidateContactRecords(survivor, target)} store={store} />
      </>}
      <Actions><Action disabled={w.busy} onClick={w.cancel}>Cancel</Action><Action disabled={w.busy || !target || Boolean(w.error)} onClick={w.confirm}>{w.busy ? 'Saving…' : 'Merge people'}</Action></Actions>
    </Stack>
  </Dialog>
}
const Dialog = styled.dialog`
  width: min(640px, 85vw);
  max-height: 85vh;
  overflow: auto;
  color: var(--pp-ink);
  background: var(--pp-popover);
  border: 1px solid var(--pp-glass-edge-strong);
  border-radius: 14px;
  padding: 24px;
  box-shadow: 0 18px 60px var(--pp-shadow-deep);
  backdrop-filter: var(--pp-glass-blur);
  -webkit-backdrop-filter: var(--pp-glass-blur);
  &::backdrop { background: var(--pp-scrim); }
`
const Candidates = styled(Stack)`max-height: 180px; overflow: auto;`
