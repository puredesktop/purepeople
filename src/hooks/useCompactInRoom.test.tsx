import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAdjacentApp } from '@purescience/platform-ui/bridge/react/useAdjacentApp'
import { useCompactInRoom } from './useCompactInRoom'

vi.mock('@purescience/platform-ui/bridge/react/useAdjacentApp', () => ({ useAdjacentApp: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root, container: HTMLDivElement, seen: boolean | undefined
function Probe() { seen = useCompactInRoom(); return null }
const neighbour = (name: string) => ({ tabId: 'tab-2', name, ...(name === 'Executive' ? { heldInRoom: true } : {}) })

beforeEach(() => {
  seen = undefined
  container = document.createElement('div')
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()) })

it('is true beside Executive', async () => {
  vi.mocked(useAdjacentApp).mockReturnValue(neighbour('Executive'))
  await act(async () => root.render(<Probe />))
  expect(seen).toBe(true)
})

it.each(['PurePeople', 'PureMail', 'executive', 'EXECUTIVE', 'Executive team', 'PureExecutive', ''])(
  'is false beside %j', async name => {
    vi.mocked(useAdjacentApp).mockReturnValue(neighbour(name))
    await act(async () => root.render(<Probe />))
    expect(seen).toBe(false)
  })

it('is false with no neighbour, and turns off when the split ends', async () => {
  vi.mocked(useAdjacentApp).mockReturnValue(null)
  await act(async () => root.render(<Probe />))
  expect(seen).toBe(false)
  vi.mocked(useAdjacentApp).mockReturnValue(neighbour('Executive'))
  await act(async () => root.render(<Probe />))
  expect(seen).toBe(true)
  vi.mocked(useAdjacentApp).mockReturnValue(null)
  await act(async () => root.render(<Probe />))
  expect(seen).toBe(false)
})
