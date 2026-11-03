import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const call = vi.hoisted(() => vi.fn())
vi.mock('@purescience/platform-ui/bridge/client', () => ({ bridge: { call, waitForReady: async () => ({ appSlug: 'people' }), onEvent: () => () => undefined } }))
vi.mock('@purescience/platform-ui/bridge/context', () => ({ clearPlatformContext: vi.fn(), publishContext: vi.fn() }))

const { requestMailCompose } = await import('./peopleBridge')

/** One version-checked file, as the shell's JSON store has it. */
let file: { entries: Record<string, unknown> }
let version: number
let beforeWrite: (() => void) | null

beforeEach(() => {
  Object.defineProperty(window, 'parent', { value: {}, configurable: true })
  file = { entries: {} }
  version = 1
  beforeWrite = null
  call.mockReset()
  call.mockImplementation(async (method: string, args: unknown[]) => {
    if (method === 'storage.readJson') return { value: structuredClone(file), version: String(version) }
    if (method === 'storage.writeJson') {
      beforeWrite?.()
      beforeWrite = null
      const input = args[0] as { value: typeof file; ifMatch?: string }
      if (input.ifMatch !== String(version)) return { conflict: true, value: file, version: String(version) }
      file = input.value
      version++
      return { ok: true, version: String(version) }
    }
    return undefined
  })
})
afterEach(() => {
  Object.defineProperty(window, 'parent', { value: window, configurable: true })
})

describe('requestMailCompose over Mail\'s shared file', () => {
  it('keeps an entry another copy wrote between the read and the write', async () => {
    beforeWrite = () => {
      file = { entries: { fromMail: { id: 'fromMail' } } }
      version++
    }
    await requestMailCompose([{ name: 'Ana', email: 'ana@x.example' }])
    expect(Object.keys(file.entries)).toHaveLength(2)
    expect(file.entries.fromMail).toEqual({ id: 'fromMail' })
  })
})
