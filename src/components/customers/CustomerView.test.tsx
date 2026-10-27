import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { PeopleUpdate } from '../../types'
import type { AgentToolHandlerResult } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'

const registration = vi.hoisted(() => ({ current: null as null | {
  tools: readonly string[]
  handlers: Record<string, (invoke: { arguments: Record<string, unknown> }) => Promise<AgentToolHandlerResult>>
} }))
vi.mock('@purescience/platform-ui/bridge/react/usePlatformAgentTools', () => ({ usePlatformAgentTools: (value: typeof registration.current) => { registration.current = value } }))
vi.mock('../../lib/peopleBridge', () => ({ clearOpenRecordContext: async () => {}, publishOpenRecordContext: async () => {}, isStandaloneDevMode: () => true }))
import { PeopleShell } from '../PeopleShell'
import { emptyPeopleStore, upsertContact } from '../../lib/contactsModel'
import { listCustomers } from '../../lib/customers'
import manifest from '../../../plugin.json'

it('registered customer tools and the reachable UI use the same records, validation and filters', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  let held = upsertContact(emptyPeopleStore(), { email: 'taylor@example.org', name: 'Taylor Example', notes: 'Original contact note' }, 'user').store
  held = upsertContact(held, { email: 'undated@example.org', name: 'Undated Person' }, 'user').store
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  function Harness() {
    const [store, setStore] = useState(held)
    const update: PeopleUpdate = async updater => { held = structuredClone(updater(held)); setStore(held); return held }
    return <PeopleShell store={store} update={update} />
  }
  const invoke = async (name: string, args: Record<string, unknown>) => {
    let result!: AgentToolHandlerResult
    await act(async () => { result = await registration.current!.handlers[name]!({ arguments: args }) })
    return JSON.parse(result.content)
  }
  const click = async (text: string) => {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent === text)
    expect(button, text).toBeTruthy()
    await act(async () => button!.click())
  }
  try {
    await act(async () => root.render(<Harness />))
    for (const name of ['createCustomer', 'updateCustomer', 'listCustomers']) {
      expect(registration.current!.tools).toContain(name)
      expect(manifest.app.agents.tools.some(tool => tool.name === name)).toBe(true)
    }
    const person = [...host.querySelectorAll('div')].find(element => element.textContent === 'Taylor Example')!
    await act(async () => person.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(host.querySelector('[aria-label="Notes"]')!.textContent).toBe('Original contact note')
    await click('Customers')
    expect(host.textContent).toContain('0 tracked contacts')
    const id = held.contacts[0].id
    const created = await invoke('createCustomer', { contactId: id, status: 'Lead', notes: 'Pilot', nextAction: 'Arrange call', dueDate: '2026-11-01' })
    expect(created.saved.id).toBe(id)
    expect(held.contacts).toHaveLength(2)
    expect(host.textContent).toContain('Taylor Example')
    await click('Add existing contact')
    await click('Taylor Example · taylor@example.org · Lead')
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Relationship notes"]')!.value).toBe('Pilot')
    for (const status of ['Customer', 'Inactive']) {
      const changed = await invoke('updateCustomer', { contactId: id, status, notes: `Notes ${status}`, nextAction: 'Review renewal', dueDate: '2026-11-02' })
      expect(changed.saved.customer).toEqual(held.contacts[0].customer)
      expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Relationship notes"]')!.value).toBe(`Notes ${status}`)
    }
    await invoke('createCustomer', { contactId: held.contacts[1].id, status: 'Customer' })
    const filters = { status: 'Inactive', due: 'Upcoming', today: '2026-10-25', query: 'renewal' }
    expect((await invoke('listCustomers', filters)).contacts).toEqual(listCustomers(held, filters as never))
    expect((await invoke('listCustomers', { due: 'No due date' })).contacts.map((person: {id: string}) => person.id)).toEqual(['undated@example.org'])
    await click('No due date')
    const roster = host.querySelector('[aria-label="Customer results"]')!
    expect(roster.textContent).toContain('Undated Person')
    expect(roster.textContent).not.toContain('Taylor Example')
    await click('All dates')
    await click('Lead')
    expect(roster.textContent).toContain('0 tracked contacts')
    const before = JSON.stringify(held)
    for (const args of [{ contactId: id, status: 'Bad' }, { contactId: id, dueDate: '2026-02-30' }, { contactId: 'missing', status: 'Lead' }]) {
      await expect(invoke('updateCustomer', args)).rejects.toThrow()
      expect(JSON.stringify(held)).toBe(before)
    }
    await click('Back to People')
    expect(host.textContent).toContain('Customers')
    expect(host.querySelector('[aria-label="Notes"]')!.textContent).toBe('Original contact note')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('creates and edits a customer through the UI without making a new contact', async () => {
  const { CustomerView } = await import('./CustomerView')
  let saved = upsertContact(emptyPeopleStore(), { email: 'ui@example.org', name: 'UI Example' }, 'user').store
  const id = saved.contacts[0].id
  let externalUpdate!: PeopleUpdate
  let failSave = false
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  function Harness() {
    const [store, setStore] = useState(saved)
    const update: PeopleUpdate = async updater => {
      if (failSave) throw new Error('Write unavailable')
      saved = structuredClone(updater(saved)); setStore(saved); return saved
    }
    externalUpdate = update
    return <CustomerView store={store} update={update} onBack={() => {}} onNewContact={() => {}} />
  }
  const click = async (text: string) => {
    const button = [...host.querySelectorAll('button')].find(item => item.textContent === text)!
    expect(button).toBeTruthy()
    await act(async () => button.click())
  }
  const input = async (label: string, value: string) => {
    const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const submit = async () => act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  try {
    await act(async () => root.render(<Harness />))
    await click('Add existing contact')
    await click('UI Example · ui@example.org')
    expect(saved.contacts[0].customer).toBeUndefined()
    await input('Relationship notes', 'Met at a product demo')
    await input('Next action', 'Arrange a pilot')
    await input('Due date', '2026-11-01')
    await submit()
    expect(saved.contacts).toHaveLength(1)
    expect(saved.contacts[0]).toMatchObject({ id, customer: { status: 'Lead', notes: 'Met at a product demo', nextAction: 'Arrange a pilot', dueDate: '2026-11-01' } })
    for (const status of ['Customer', 'Inactive']) {
      const choices = host.querySelector('[aria-label="Relationship status"]')!
      await act(async () => [...choices.querySelectorAll('button')].find(button => button.textContent === status)!.click())
      await input('Relationship notes', `Notes for ${status}`)
      await input('Next action', `Follow up with ${status}`)
      await submit()
      expect(saved.contacts[0].customer).toEqual({ status, notes: `Notes for ${status}`, nextAction: `Follow up with ${status}`, dueDate: '2026-11-01' })
    }
    await input('Relationship notes', 'User note in progress')
    await act(async () => {
      await externalUpdate(store => {
        const changed = structuredClone(store)
        changed.contacts[0].customer!.dueDate = '2026-12-01'
        changed.contacts[0].customer!.nextAction = 'Agent scheduled call'
        return changed
      })
    })
    expect(host.querySelector<HTMLInputElement>('[aria-label="Due date"]')!.value).toBe('2026-12-01')
    failSave = true
    await submit()
    expect(host.textContent).toContain('Write unavailable')
    expect(saved.contacts[0].customer!.notes).toBe('Notes for Inactive')
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Relationship notes"]')!.value).toBe('User note in progress')
    failSave = false
    await submit()
    expect(saved.contacts[0].customer).toEqual({ status: 'Inactive', notes: 'User note in progress', nextAction: 'Agent scheduled call', dueDate: '2026-12-01' })
    await input('Search customers', 'does not match')
    expect(host.querySelector('[aria-label="Customer results"]')!.textContent).toContain('0 tracked contacts')
    await input('Search customers', 'Agent scheduled call')
    expect(host.querySelector('[aria-label="Customer results"]')!.textContent).toContain('UI Example')
    expect(host.textContent).toContain('Relationship saved')
  } finally { await act(async () => root.unmount()); host.remove() }
})

it('preserves a profile created by an agent while the user is preparing enrolment', async () => {
  const { CustomerView } = await import('./CustomerView')
  const { saveCustomer } = await import('../../lib/customers')
  let saved = upsertContact(emptyPeopleStore(), { email: 'race@example.org', name: 'Race Example' }, 'user').store
  const id = saved.contacts[0].id
  let updateExternally!: PeopleUpdate
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  function Harness() {
    const [store, setStore] = useState(saved)
    updateExternally = async updater => { saved = updater(saved); setStore(saved); return saved }
    return <CustomerView store={store} update={updateExternally} onBack={() => {}} onNewContact={() => {}} />
  }
  try {
    await act(async () => root.render(<Harness />))
    const click = async (text: string) => act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === text)!.click() })
    await click('Add existing contact')
    await click('Race Example · race@example.org')
    const notes = host.querySelector<HTMLTextAreaElement>('[aria-label="Relationship notes"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(notes, 'User relationship note')
      notes.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      await updateExternally(store => saveCustomer(store, id, { status: 'Customer', dueDate: '2026-12-02', nextAction: 'Agent action' }, 'create'))
    })
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(saved.contacts).toHaveLength(1)
    expect(saved.contacts[0]).toMatchObject({ id, customer: { status: 'Customer', dueDate: '2026-12-02', nextAction: 'Agent action', notes: 'User relationship note' } })
    expect(host.textContent).toContain('Relationship saved')
  } finally { await act(async () => root.unmount()); host.remove() }
})
