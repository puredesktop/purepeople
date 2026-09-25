import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { MergePerson } from './MergePerson'
import { RetainedDetails } from './RetainedDetails'
import { useContactMerge } from '../../hooks/useContactMerge'
import { emptyPeopleStore, upsertContact } from '../../lib/contactsModel'
import { editRetainedDetail } from '../../lib/contactDetails'
import type { PeopleStore, PeopleUpdate } from '../../types'

it('cancels, retries a failed merge across lists, and exposes retained details after reload', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  let saved = upsertContact(emptyPeopleStore(), { email: 'a@example.org', name: 'Alice', org: 'First', title: 'Editor', status: 'Active', avatarUrl: 'https://example.org/a.png', notes: 'First note', phones: ['111'] }, 'user').store
  saved = upsertContact(saved, { email: 'b@example.org', name: 'Bea', org: 'Second', title: 'Writer', status: 'New', avatarUrl: 'https://example.org/b.png', notes: 'Second note', phones: ['222'] }, 'user').store
  saved.contacts = saved.contacts.map((contact, i) => ({ ...contact, listIds: [i ? 'second' : 'first'] }))
  saved.lists = [{ id: 'first', name: 'First list', createdAt: '' }, { id: 'second', name: 'Second list', createdAt: '' }]
  const id = saved.contacts[0]!.id
  let fail = true
  const write = vi.fn((updater: Parameters<PeopleUpdate>[0]) => {
    if (fail) throw new Error('Disk unavailable')
    saved = updater(saved)
    return saved
  })
  function Harness({ initial }: { initial: PeopleStore }) {
    const [store, setStore] = useState(initial)
    const merge = useContactMerge(async updater => { const next = write(updater); setStore(next); return next }, async () => {}, () => {})
    return <><button onClick={() => merge.open(id)}>Open merge</button>{merge.survivorId && <MergePerson store={store} workflow={merge} />}<RetainedDetails contact={store.contacts[0]!} onOpenOrg={() => {}} onEdit={edit => { const next = editRetainedDetail(store, id, edit); saved = next; setStore(next) }} /></>
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const click = async (text: string) => {
    const button = [...host.querySelectorAll('button')].find(button => button.textContent === text)!
    expect(button).toBeTruthy()
    await act(async () => button.click())
  }
  try {
    await act(async () => root.render(<Harness initial={saved} />))
    await click('Open merge')
    expect(host.querySelector('[aria-label="People to merge"]')?.textContent).not.toContain('Alice')
    await click('Bea · b@example.org')
    expect(host.textContent).toContain('Second list')
    await click('Cancel')
    expect(write).not.toHaveBeenCalled()
    await click('Open merge'); await click('Bea · b@example.org'); await click('Merge people')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Disk unavailable')
    expect(saved.contacts).toHaveLength(2)
    fail = false
    await click('Retry')
    expect(saved.contacts).toHaveLength(1)
    expect(saved.contacts[0]!.id).toBe(id)
    expect(saved.contacts[0]!.listIds).toEqual(['first', 'second'])
    expect(saved.contacts[0]!.emails).toEqual(['a@example.org', 'b@example.org'])
    expect(saved.contacts[0]!.phones).toEqual(['111', '222'])
    await act(async () => root.render(<Harness key="reload" initial={JSON.parse(JSON.stringify(saved))} />))
    for (const value of ['Bea', 'Second', 'Writer', 'New', 'https://example.org/b.png']) {
      expect([...host.querySelectorAll('input')].some(input => input.value === value)).toBe(true)
    }
    expect(host.textContent).toContain('Second note')
    await click('Make primary')
    expect(saved.contacts[0]!.name).toBe('Bea')
    expect(saved.contacts[0]!.alternatives?.name).toContain('Alice')
    await click('Make primary note')
    expect(saved.contacts[0]!.notes).toBe('Second note')
    expect(saved.contacts[0]!.alternatives?.notes?.[0]?.notes).toBe('First note')
  } finally {
    await act(async () => root.unmount()); host.remove(); error.mockRestore()
  }
})
