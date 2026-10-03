import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
vi.mock('@purescience/platform-ui/bridge/react/usePlatformAgentTools', () => ({ usePlatformAgentTools: () => {} }))
vi.mock('../lib/peopleBridge', () => ({
  clearOpenRecordContext: vi.fn(async () => {}),
  isStandaloneDevMode: () => true,
  publishOpenRecordContext: vi.fn(async () => {}),
  requestMailCompose: vi.fn(),
  saveTextFileAs: vi.fn(),
}))
import { PeopleShell } from './PeopleShell'
import { emptyPeopleStore, upsertContact } from '../lib/contactsModel'

it('shows a rejected contact edit instead of hiding the failure in the console', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const store = upsertContact(emptyPeopleStore(), { email: 'qa@example.org', name: 'QA Review Person' }, 'user').store
  const update = vi.fn(async () => { throw new Error('EIO: write failed') })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await act(async () => root.render(<PeopleShell store={store} update={update} />))
    const name = [...host.querySelectorAll('div')].find(el => el.textContent === 'QA Review Person')!
    await act(async () => name.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    const remove = [...host.querySelectorAll('[role="button"]')].find(el => el.textContent === 'Delete contact')!
    await act(async () => remove.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => remove.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(update).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('EIO: write failed')
  } finally {
    await act(async () => root.unmount())
    host.remove(); warn.mockRestore()
  }
})

it('opens the deferred board and network while retaining the contact rail', async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div')
  const root = createRoot(host)
  const store = upsertContact(emptyPeopleStore(), { email: 'qa@example.org', name: 'QA Person' }, 'user').store
  store.lists = [{ id: 'qa-list', name: 'QA List', createdAt: '2026-10-02' }]
  store.contacts[0]!.listIds = ['qa-list']
  const update = vi.fn(async () => store)
  const clickText = async (selector: string, text: string) => {
    const element = [...host.querySelectorAll(selector)].find(el => el.textContent?.trim() === text)!
    expect(element).toBeTruthy()
    await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  }
  const loaded = async (label: string) => {
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
      expect(host.querySelector(`[role="dialog"][aria-label="${label}"]`)).not.toBeNull()
    })
  }
  try {
    await act(async () => root.render(<PeopleShell store={store} update={update} />))
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    await clickText('button', 'QA List1')
    await clickText('[role="button"]', 'Open as board')
    await loaded('QA List board')
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close board"]')!.click())
    const name = [...host.querySelectorAll('div')].find(el => el.textContent === 'QA Person')!
    await act(async () => name.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await clickText('[role="button"]', 'Network')
    await loaded("QA Person's network")
    expect(update).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
  }
})
