// The single bridge surface for PurePeople. Components never call
// `bridge.call` directly; every shell capability this app uses is a named
// helper here, and method names always come from `PLATFORM_BRIDGE_METHODS`.
import { bridge } from '@purescience/platform-ui/bridge/client'
import {
  clearPlatformContext,
  publishContext,
} from '@purescience/platform-ui/bridge/context'
import { PLATFORM_BRIDGE_METHODS } from '@purescience/platform-ui/bridge/methods'
import type { PeopleStore } from '../types'
import { normalizePeopleStore } from './contactsModel'
import {
  serializeOpenRecordContext,
  type OpenRecordContext,
} from './openRecordContext'

export { bridge }

export function isStandaloneDevMode(): boolean {
  return import.meta.env.DEV && window.parent === window
}

const STANDALONE_STORE_KEY = 'purepeople.store.v1'

export function readStandaloneStore(): PeopleStore {
  const raw = window.localStorage.getItem(STANDALONE_STORE_KEY)
  return normalizePeopleStore(raw ? JSON.parse(raw) : null)
}

export function writeStandaloneStore(store: PeopleStore): void {
  window.localStorage.setItem(STANDALONE_STORE_KEY, JSON.stringify(store))
}

export async function publishOpenRecordContext(
  context: OpenRecordContext,
): Promise<void> {
  if (isStandaloneDevMode()) return
  await publishContext({
    attachments: [
      {
        type: 'file',
        mimeType: 'application/json',
        name: `PurePeople open ${context.kind}.json`,
        source: {
          type: 'data',
          encoding: 'text',
          data: serializeOpenRecordContext(context),
        },
      },
    ],
  })
}

export async function clearOpenRecordContext(): Promise<void> {
  if (isStandaloneDevMode()) return
  await clearPlatformContext()
}

/**
 * Save text to a user-chosen file via the native save dialog. Returns the
 * chosen path, or null when cancelled/unavailable (standalone dev falls
 * back to a browser download).
 */
export async function saveTextFileAs(
  defaultName: string,
  content: string,
): Promise<string | null> {
  if (isStandaloneDevMode()) {
    const url = URL.createObjectURL(
      new Blob([content], { type: 'text/csv;charset=utf-8' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = defaultName
    anchor.click()
    URL.revokeObjectURL(url)
    return defaultName
  }
  const result = (await bridge.call(PLATFORM_BRIDGE_METHODS.DIALOG_SAVE_FILE, [
    {
      defaultName,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    },
  ])) as { path?: string | null } | null
  const path = result?.path ?? null
  if (!path) return null
  await bridge.call(PLATFORM_BRIDGE_METHODS.FS_WRITE, [path, content])
  return path
}

/**
 * Queue a "start an email to these people" intent in PureMail's storage
 * (the calendar-invite-intents pattern in reverse) and front the mail
 * app. PureMail sweeps the file and opens a compose with To prefilled.
 */
const MAIL_APP_SLUG = 'mail'
const COMPOSE_INTENTS_FILE = 'compose-intents.json'

export async function requestMailCompose(
  recipients: { name: string; email: string }[],
): Promise<void> {
  if (isStandaloneDevMode() || recipients.length === 0) return
  const { appSlug } = await bridge.waitForReady()
  const existing = (await bridge.call(
    PLATFORM_BRIDGE_METHODS.STORAGE_READ_JSON,
    [{ appSlug: MAIL_APP_SLUG, fileName: COMPOSE_INTENTS_FILE }],
  )) as { value?: { entries?: Record<string, unknown> } } | null
  const entries = { ...(existing?.value?.entries ?? {}) }
  const id = `people_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  entries[id] = {
    id,
    at: new Date().toISOString(),
    from: appSlug,
    to: recipients,
  }
  await bridge.call(PLATFORM_BRIDGE_METHODS.STORAGE_WRITE_JSON, [
    { appSlug: MAIL_APP_SLUG, fileName: COMPOSE_INTENTS_FILE, value: { entries } },
  ])
  await bridge.call(PLATFORM_BRIDGE_METHODS.WORKSPACE_OPEN_APP, [
    { appSlug: MAIL_APP_SLUG, resourceId: `compose/${id}` },
  ])
}

/**
 * Hand a request to the drawer's assistant as a message in this app's
 * conversation, then show the drawer. PurePeople never calls a model; the
 * assistant reads the people with its own tools. False when the shell
 * cannot take a message, so the caller can only open the drawer.
 */
export async function askDrawer(content: string): Promise<boolean> {
  if (isStandaloneDevMode()) return false
  try {
    const { appSlug } = await bridge.waitForReady()
    const snapshot = await bridge.call<{ id?: string; sessionId?: string }>(PLATFORM_BRIDGE_METHODS.ASSISTANTS_SESSIONS_OPEN, [appSlug])
    const sessionId = snapshot?.id ?? snapshot?.sessionId ?? null
    if (!sessionId) return false
    await bridge.call(PLATFORM_BRIDGE_METHODS.WORKSPACE_UPDATE_CURRENT_TAB, [{ sessionId }]).catch(() => undefined)
    await bridge.call(PLATFORM_BRIDGE_METHODS.ASSISTANTS_MESSAGES_SEND, [{ id: sessionId, input: { content } }])
    await bridge.call(PLATFORM_BRIDGE_METHODS.WORKSPACE_TOGGLE_AGENT_DRAWER, [{ open: true }]).catch(() => undefined)
    return true
  } catch (error) {
    console.error('[purepeople] could not hand the request to the assistant', error)
    return false
  }
}

/** Put text on the clipboard through the shell (a frame's own clipboard access can be blocked). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (isStandaloneDevMode()) { await navigator.clipboard.writeText(text); return true }
    const result = await bridge.call<{ ok: boolean }>(PLATFORM_BRIDGE_METHODS.CLIPBOARD_WRITE, [text])
    return result?.ok !== false
  } catch (error) {
    console.error('[purepeople] could not copy', error)
    return false
  }
}
