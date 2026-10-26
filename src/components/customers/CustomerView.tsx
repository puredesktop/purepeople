import { RetainedCustomerProfiles } from '../people/RetainedCustomerProfiles'
import { useEffect, useState } from 'react'
import { styled } from 'styled-components'
import { CUSTOMER_STATUSES, DUE_FILTERS, listCustomers, saveCustomer, type DueFilter } from '../../lib/customers'
import { clearOpenRecordContext, publishOpenRecordContext } from '../../lib/peopleBridge'
import { searchContacts } from '../../lib/contactsModel'
import type { ContactRecord, CustomerProfile, PeopleStore, PeopleUpdate } from '../../types'
import { Action, Actions, Field, Stack } from '../common/RecordControls'

export function CustomerView({ store, update, onBack, onNewContact }: {
  store: PeopleStore; update: PeopleUpdate; onBack: () => void; onNewContact: () => void
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<CustomerProfile['status'] | 'All statuses'>('All statuses')
  const [due, setDue] = useState<DueFilter>('All dates')
  const [adding, setAdding] = useState(false)
  const [contactQuery, setContactQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const contacts = listCustomers(store, { query, status, due })
  const selected = store.contacts.find(person => person.id === selectedId)
  useEffect(() => {
    const publishing = selected
      ? publishOpenRecordContext({ kind: 'person', record: selected })
      : clearOpenRecordContext()
    void publishing.catch(error => console.warn('[purepeople] customer context:', error))
  }, [selected])
  return <Page aria-label="Customers">
    <Actions><Action onClick={onBack}>Back to People</Action><h1>Customers</h1><Action onClick={() => setAdding(!adding)}>Add existing contact</Action><Action onClick={onNewContact}>New contact</Action></Actions>
    <p>Track relationships and the next conversation, alongside your contact book.</p>
    <Field aria-label="Search customers" placeholder="Search customers, notes, next actions" value={query} onChange={event => setQuery(event.target.value)} />
    <Actions aria-label="Customer status filter">{(['All statuses', ...CUSTOMER_STATUSES] as const).map(value => <Choice key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{value}</Choice>)}</Actions>
    <Actions aria-label="Due-date filter">{DUE_FILTERS.map(value => <Choice key={value} aria-pressed={due === value} onClick={() => setDue(value)}>{value}</Choice>)}</Actions>
    {adding && <Picker><h2>Choose an existing contact</h2><Field aria-label="Find contact" placeholder="Search your contact book" value={contactQuery} onChange={event => setContactQuery(event.target.value)} />
      <PickerResults>{searchContacts(store, contactQuery, 50).map(person => <Action key={person.id} onClick={() => { setSelectedId(person.id); setAdding(false) }}>{person.name} · {person.emails[0]}{person.customer ? ` · ${person.customer.status}` : ''}</Action>)}</PickerResults>
      <small>Search by name or email. Need someone new? Use New contact.</small>
    </Picker>}
    <Columns><Roster aria-label="Customer results"><small>{contacts.length} tracked {contacts.length === 1 ? 'contact' : 'contacts'}</small>
      {contacts.length === 0 && <p>No customers match. Add an existing contact to start tracking a relationship.</p>}
      {contacts.map(person => <Card key={person.id} aria-pressed={selectedId === person.id} onClick={() => setSelectedId(person.id)}>
        <strong>{person.name}</strong><span>{person.org || person.emails[0]}</span><span>{person.customer!.status} · {person.customer!.dueDate || 'No due date'}</span><span>{person.customer!.nextAction || 'No next action'}</span>
      </Card>)}
    </Roster>
    {selected ? <CustomerEditor key={selected.id} contact={selected} update={update} /> : <Panel><h2>A relationship starts with a person</h2><p>Choose a customer, or add someone from your existing contacts.</p></Panel>}
    </Columns>
  </Page>
}

function CustomerEditor({ contact, update }: { contact: ContactRecord; update: PeopleUpdate }) {
  const [edits, setEdits] = useState<Partial<CustomerProfile>>({})
  const draft: CustomerProfile = { status: 'Lead', ...contact.customer, ...edits }
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const change = (patch: Partial<CustomerProfile>) => { setEdits(current => ({ ...current, ...patch })); setMessage('') }
  return <Panel><h2>{contact.name}</h2><p>{contact.emails.join(', ')}</p>
    {!contact.customer && <p>This contact is not tracked yet. Choose a status and save to start.</p>}
    <form onSubmit={async event => {
      event.preventDefault(); setSaving(true); setMessage('')
      try {
        await update(store => {
          const current = store.contacts.find(person => person.id === contact.id)
          // Preserve queued edits to fields this form did not change.
          const patch = current?.customer ? edits : { status: draft.status, ...edits }
          if (current?.customer && !Object.keys(patch).length) return store
          return saveCustomer(store, contact.id, patch, current?.customer ? 'update' : 'create')
        })
        setEdits({}); setMessage('Relationship saved')
      } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
      finally { setSaving(false) }
    }}><Stack>
      <Actions aria-label="Relationship status">{CUSTOMER_STATUSES.map(value => <Choice type="button" key={value} aria-pressed={draft.status === value} disabled={saving} onClick={() => change({ status: value })}>{value}</Choice>)}</Actions>
      <Label>Relationship notes<TextArea aria-label="Relationship notes" value={draft.notes ?? ''} disabled={saving} onChange={event => change({ notes: event.target.value })} /></Label>
      <Label>Next action<Field aria-label="Next action" placeholder="e.g. Arrange a discovery call" value={draft.nextAction ?? ''} disabled={saving} onChange={event => change({ nextAction: event.target.value })} /></Label>
      <Label>Due date<Field aria-label="Due date" type="date" value={draft.dueDate ?? ''} disabled={saving} onChange={event => change({ dueDate: event.target.value })} /></Label>
      <Actions><Action type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save relationship'}</Action>{message && <span role="status">{message}</span>}</Actions>
    </Stack></form>
    <RetainedCustomerProfiles contact={contact} />
  </Panel>
}

const Page = styled.section`
  width: 100%; overflow: auto; padding: 20px; box-sizing: border-box;
  background: var(--pp-paper); border-radius: 12px;
  display: flex; flex-direction: column; gap: 16px;
  h1 { font-size: 26px; font-weight: 500; margin: 0 auto 0 0; }
  h2 { font-size: 19px; font-weight: 500; margin: 0; }
  p { margin: 0; color: var(--pp-muted); line-height: 1.5; }
  > * { flex-shrink: 0; }
`
const Choice = styled(Action)`
  &[aria-pressed='true'] { background: var(--pp-wash-strong); border-color: var(--pp-accent-solid); }
`
const Columns = styled.div`
  display: grid; grid-template-columns: minmax(220px, 1fr) minmax(280px, 1.3fr); gap: 20px; align-items: start;
  @media (max-width: 700px) { grid-template-columns: 1fr; }
`
const Roster = styled(Stack)``
const Card = styled(Choice)`
  display: flex; flex-direction: column; text-align: left; gap: 6px; padding: 16px;
  span { color: var(--pp-muted); overflow-wrap: anywhere; }
`
const Panel = styled.div`
  border: 1px solid var(--pp-wash-strong); border-radius: 10px; padding: 22px;
  background: var(--pp-paper-raised); display: flex; flex-direction: column; gap: 16px;
`
const Picker = styled(Panel)``
const PickerResults = styled(Stack)`max-height: 200px; overflow: auto;`
const Label = styled.label`display: flex; flex-direction: column; gap: 8px; font-size: 13px;`
const TextArea = styled.textarea`
  font: inherit; color: var(--pp-ink); background: var(--pp-paper-raised);
  border: 1px solid var(--pp-wash-strong); border-radius: 5px; padding: 10px;
  min-height: 100px; resize: vertical;
`
