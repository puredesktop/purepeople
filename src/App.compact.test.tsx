import { act, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'
import { useCompactInRoom } from './hooks/useCompactInRoom'
import { emptyPeopleStore } from './lib/contactsModel'

vi.mock('./hooks/useCompactInRoom', () => ({ useCompactInRoom: vi.fn() }))
vi.mock('@purescience/platform-bridge/components/AppFrame', () => ({
  AppFrame: ({ children, ...rest }: { children: ReactNode } & ComponentProps<'div'>) => <div data-testid="frame" {...rest}>{children}</div>,
}))
vi.mock('@purescience/platform-ui/bridge/react/usePlatformBridge', () => ({ usePlatformBridge: () => ({ meta: { appSlug: 'people' } }) }))
vi.mock('./lib/peopleBridge', () => ({ isStandaloneDevMode: () => false }))
vi.mock('./hooks/usePeopleData', () => ({ usePeopleData: () => ({ store: emptyPeopleStore(), update: vi.fn(), loading: false, error: null }) }))
vi.mock('./components/PeopleShell', () => ({ PeopleShell: ({ compact }: { compact: boolean }) => <output>{String(compact)}</output> }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root, container: HTMLDivElement
async function render(compact: boolean) {
  vi.mocked(useCompactInRoom).mockReturnValue(compact)
  await act(async () => root.render(<App />))
}
beforeEach(() => { container = document.createElement('div'); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()) })

it('marks the frame and tells the app only while the hook is on', async () => {
  const frame = () => container.querySelector('[data-testid="frame"]')!
  await render(false)
  expect(frame().hasAttribute('data-compact-room')).toBe(false)
  expect(container.querySelector('output')?.textContent).toBe('false')
  await render(true)
  expect(frame().hasAttribute('data-compact-room')).toBe(true)
  expect(container.querySelector('output')?.textContent).toBe('true')
})
