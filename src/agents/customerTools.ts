import { listCustomers, saveCustomer, type CustomerFilters } from '../lib/customers'
import { agentRecordView, type PeopleAgentToolContext } from './handlers'

export function listCustomersHandler(context: PeopleAgentToolContext, args: Record<string, unknown>) {
  const contacts = listCustomers(context.store, args as CustomerFilters)
  return { content: JSON.stringify({ contacts: contacts.map(agentRecordView), returned: contacts.length }) }
}

export async function saveCustomerHandler(context: PeopleAgentToolContext, args: Record<string, unknown>, mode: 'create' | 'update') {
  const { contactId, ...patch } = args
  if (typeof contactId !== 'string' || !contactId) throw new Error('contactId is required. Call listContacts first.')
  const saved = await context.setStore(store => saveCustomer(store, contactId, patch, mode))
  return { content: JSON.stringify({ saved: agentRecordView(saved.contacts.find(person => person.id === contactId)!) }) }
}
