import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlatformAgentTools } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { PeopleShell } from './PeopleShell'
import { contactByIdOrEmail, emptyPeopleStore, upsertContact } from '../lib/contactsModel'
import { upsertOrg } from '../lib/orgsModel'
import type { PeopleStore, PeopleUpdate } from '../types'

vi.mock('@purescience/platform-ui/bridge/react/usePlatformAgentTools', () => ({ usePlatformAgentTools: vi.fn() }))
vi.mock('../lib/peopleBridge', () => ({
  askDrawer: vi.fn(),
  clearOpenRecordContext: vi.fn(async () => {}),
  copyText: vi.fn(),
  isStandaloneDevMode: () => true,
  publishOpenRecordContext: vi.fn(async () => {}),
  requestMailCompose: vi.fn(),
  saveTextFileAs: vi.fn(),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function people(): PeopleStore {
  let store = upsertContact(emptyPeopleStore(), { email: 'ada@acme.org', name: 'Ada Example', org: 'Acme' }, 'user').store
  store = upsertContact(store, { email: 'bo@other.org', name: 'Bo Other' }, 'user').store
  store = upsertOrg(store, { name: 'Acme' }, 'user').store
  store.lists = [{ id: 'press', name: 'Press', createdAt: '2026-10-02' }]
  store.contacts.find(contact => contact.name === 'Bo Other')!.listIds = ['press']
  return store
}

let root: Root, host: HTMLDivElement
const ANY_COMPACT_MARK = '[data-compact-view],[data-compact-part],[data-compact-hide],[class*="people-compact"]'
const view = () => host.querySelector('[data-compact-view]')?.getAttribute('data-compact-view')
const textOf = (selector: string, text: string) => [...host.querySelectorAll<HTMLElement>(selector)].find(el => el.textContent?.trim() === text)
const click = async (element: Element | undefined | null) => {
  expect(element).toBeTruthy()
  await act(async () => element!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const enter = async (input: HTMLInputElement) => {
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}
const render = async (store: PeopleStore, update: PeopleUpdate, compact?: boolean) => {
  await act(async () => root.render(<PeopleShell store={store} update={update} compact={compact} />))
}
const openPerson = (name: string) => click(textOf('div', name))

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.mocked(usePlatformAgentTools).mockClear()
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

it('with compact off, adds no mark to the page and keeps every control working', async () => {
  await render(people(), vi.fn())
  expect(host.querySelector(ANY_COMPACT_MARK)).toBeNull()
  await openPerson('Ada Example')
  expect(host.querySelector(ANY_COMPACT_MARK)).toBeNull()
  expect(textOf('button', 'Customers')).toBeTruthy()
  expect(textOf('[role="button"]', 'Network')).toBeTruthy()
  expect(textOf('[role="button"]', 'Delete contact')).toBeTruthy()
  // The org name still opens the org, with its way back.
  await click(textOf('[role="button"]', 'Acme'))
  expect(textOf('[role="button"]', '← Back')).toBeTruthy()
})

it('in compact, goes from the list to one card and back, keeping the search', async () => {
  await render(people(), vi.fn(), true)
  expect(view()).toBe('list')
  const search = host.querySelector<HTMLInputElement>('input[placeholder="Search people"]')!
  await type(search, 'ada')
  await openPerson('Ada Example')
  expect(view()).toBe('card')
  await click(textOf('button', '← All people'))
  expect(view()).toBe('list')
  expect(host.querySelector<HTMLInputElement>('input[placeholder="Search people"]')?.value).toBe('ada')
  expect(textOf('button', '← All people')).toBeUndefined()
})

it('in compact, a search lists people only', async () => {
  await render(people(), vi.fn(), true)
  await type(host.querySelector<HTMLInputElement>('input[placeholder="Search people"]')!, 'acme')
  expect(textOf('div', 'Ada Example')).toBeTruthy()
  expect(host.textContent).not.toContain('Orgs matching')
})

it('in compact, hides the chrome without removing it', async () => {
  await render(people(), vi.fn(), true)
  await openPerson('Ada Example')
  for (const [selector, text] of [['button', 'Customers'], ['[role="button"]', 'Network'], ['[role="button"]', 'Find photo'], ['[role="button"]', '✉ Email'], ['[role="button"]', 'Delete contact'], ['[role="button"]', 'Export']] as const) {
    const element = textOf(selector, text)
    expect(element, text).toBeTruthy()
    expect(element!.closest('[data-compact-hide]'), text).not.toBeNull()
  }
})

it('in compact, a corrected detail saves through the same update', async () => {
  let saved: PeopleStore | undefined
  const store = people()
  const update: PeopleUpdate = async updater => (saved = updater(store))
  await render(store, update, true)
  await openPerson('Ada Example')
  await click(textOf('[role="button"]', 'Add role'))
  const input = host.querySelector<HTMLInputElement>('input[placeholder="Add role"]')!
  await type(input, 'Editor')
  await enter(input)
  expect(contactByIdOrEmail(saved!, 'ada@acme.org')?.title).toBe('Editor')
})

it('in compact, a failed save shows on the card, where the owner is looking', async () => {
  const update = vi.fn(async () => { throw new Error('EIO: write failed') })
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
  await render(people(), update, true)
  await openPerson('Ada Example')
  await click(textOf('[role="button"]', 'Add role'))
  const input = host.querySelector<HTMLInputElement>('input[placeholder="Add role"]')!
  await type(input, 'Editor')
  await enter(input)
  expect(host.querySelector('.people-compact-bar [role="alert"]')?.textContent).toContain('EIO: write failed')
  quiet.mockRestore()
})

it('in compact, the organisation name stays on the card and creates nothing', async () => {
  const update = vi.fn()
  await render(people(), update, true)
  await openPerson('Ada Example')
  const name = host.querySelector('[data-compact-part="org-name"]')
  expect(name?.textContent).toBe('Acme')
  expect(name?.getAttribute('role')).toBeNull()
  await click(name)
  expect(view()).toBe('card')
  expect(update).not.toHaveBeenCalled()
})

it('with nothing there, offers one quiet line and one way forward', async () => {
  const empty = emptyPeopleStore()
  let saved: PeopleStore | undefined
  const update: PeopleUpdate = async updater => (saved = updater(empty))
  await render(empty, update, true)
  expect(host.querySelector('.people-compact-empty p')?.textContent).toBe('No people yet.')
  expect(host.querySelectorAll('.people-compact-empty button')).toHaveLength(1)
  expect(host.querySelector('[data-compact-part="search"]')?.hasAttribute('data-compact-hide')).toBe(true)
  await click(textOf('.people-compact-empty button', '+ New person'))
  const input = host.querySelector<HTMLInputElement>('input[placeholder="email@example.com"]')!
  expect(host.querySelector('[data-compact-part="search"]')?.hasAttribute('data-compact-hide')).toBe(false)
  await type(input, 'new@example.org')
  await enter(input)
  await render(saved!, update, true)
  expect(view()).toBe('card')
})

it('entering and leaving compact keeps the same record open, mounted, with its tools registered', async () => {
  const store = people()
  await render(store, vi.fn())
  await openPerson('Ada Example')
  const notes = host.querySelector('[aria-label="Notes"]')
  const rail = host.querySelector('[data-chrome="sidebar"]')
  await render(store, vi.fn(), true)
  expect(view()).toBe('card')
  expect(host.querySelector('[aria-label="Notes"]')).toBe(notes)
  expect(host.querySelector('[data-chrome="sidebar"]')).toBe(rail)
  const tools = vi.mocked(usePlatformAgentTools).mock.lastCall![0] as { handlers: Record<string, unknown> }
  expect(Object.keys(tools.handlers)).toEqual(expect.arrayContaining(['listContacts', 'upsertContact', 'getEventBoard', 'getPersonNetwork', 'createCustomer']))
  await render(store, vi.fn(), false)
  expect(host.querySelector('[aria-label="Notes"]')).toBe(notes)
  expect(host.querySelector(ANY_COMPACT_MARK)).toBeNull()
})

it('coming into compact from the Orgs tab, or with a list open, still shows everyone', async () => {
  const store = people()
  await render(store, vi.fn())
  await click(textOf('button', 'Press1'))
  await click(textOf('div', 'Orgs1'))
  expect(textOf('div', 'Ada Example')).toBeUndefined()
  await render(store, vi.fn(), true)
  expect(view()).toBe('list')
  expect(textOf('div', 'Ada Example')).toBeTruthy()
  expect(textOf('div', 'Bo Other')).toBeTruthy()
})

it('every compact style starts from the attribute, so none can apply with compact off', () => {
  const selectors = readFileSync('src/compact-in-room.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) ?? []
  expect(selectors.length).toBeGreaterThan(10)
  for (const group of selectors) {
    let depth = 0, part = ''
    for (const char of `${group},`) {
      if (char === '(') depth += 1
      if (char === ')') depth -= 1
      if (char === ',' && depth === 0) {
        expect(part.trim()).toMatch(/^(\[data-compact-room\]|html\[data-held-in-room\])/)
        part = ''
      } else part += char
    }
  }
})
