import { CrossAppDragHandle } from '@purescience/platform-ui/components/assets/CrossAppDragHandle'
import { useContactMerge } from '../hooks/useContactMerge'
import { MergePerson } from './people/MergePerson'
import { EventBoard } from './board/EventBoard'
import { getEventBoardHandler, getPersonNetworkHandler, setEventPrepHandler } from '../agents/eventTools'
import { NetworkView } from './board/NetworkView'
import { scopeTitle, type BoardScope } from '../lib/eventBoard'
import { RetainedDetails } from './people/RetainedDetails'
import { Action } from './common/RecordControls'
import { editRetainedDetail } from '../lib/contactDetails'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createGlobalStyle, styled } from 'styled-components'
import { usePlatformAgentTools } from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import {
  addToListHandler,
  AgentPeopleToolError,
  createListHandler,
  deleteListHandler,
  getContactHandler,
  getOrgHandler,
  listContactsHandler,
  listListsHandler,
  listOrgsHandler,
  prepareProfilePhotoResearchHandler,
  PUREPEOPLE_AGENT_LOG_LABEL,
  PUREPEOPLE_AGENT_TOOL_NAMES,
  removeFromListHandler,
  renameListHandler,
  upsertContactHandler,
  mergeContactsHandler,
  upsertOrgHandler,
} from '../agents/handlers'
import {
  contactByIdOrEmail,
  mergeFeedEntry,
  normalizeEmail,
  removeContact,
  searchContacts,
  upsertContact,
} from '../lib/contactsModel'
import {
  addToList,
  contactInList,
  createList,
  fileImportedContacts,
  listByIdOrName,
  listCounts,
  listsForContact,
  removeFromList,
  removeList,
  renameList,
  storeLists,
} from '../lib/peopleLists'
import {
  mergeOrgImportEntry,
  orgByIdOrName,
  orgForContact,
  orgKey,
  peopleForOrg,
  removeOrg,
  searchOrgs,
  storeOrgs,
  upsertOrg,
} from '../lib/orgsModel'
import {
  askDrawer,
  clearOpenRecordContext,
  isStandaloneDevMode,
  publishOpenRecordContext,
  requestMailCompose,
  saveTextFileAs,
} from '../lib/peopleBridge'
import { comprehensivePhotoResearchPrompt } from '../lib/profilePhotoResearch'
import { contactsToCsv, orgsToCsv } from '../lib/csvExport'
import { imageFileToAvatarDataUrl } from '../lib/avatarImage'
import {
  parseImportCsv,
  type CsvImportParse,
  type OrgCsvImportParse,
} from '../lib/csvImport'
import {
  notesTextFromHtml,
  sanitizeNotesHtml,
} from '../lib/sanitizeNotesHtml'
import type {
  ContactLink,
  ContactRecord,
  OrgRecord,
  PeopleStore,
  PeopleUpdate,
} from '../types'

/** Staleness threshold for the "not seen" list partition. */
const STALE_MONTHS = 6

/** Rows the rail renders before asking for a narrower search. */
const RAIL_LIMIT = 500

const LINK_LABEL_SUGGESTIONS = [
  'LinkedIn',
  'Homepage',
  'Website',
  'X',
  'GitHub',
  'Instagram',
  'Facebook',
  'Mastodon',
  'Bluesky',
  'YouTube',
]

type SortMode = 'lastSeen' | 'added' | 'name' | 'org'

const SORT_LABELS: Record<SortMode, string> = {
  lastSeen: 'Last seen',
  added: 'Recently added',
  name: 'Name A–Z',
  org: 'Org',
}

/** "today" / "2d" / "3w" / "5mo" / "1y" / "—", per the design's list meta. */
function relativeSeen(iso: string | undefined, now: number): string {
  if (!iso) return '—'
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return '—'
  const days = Math.max(0, Math.floor((now - at) / 86_400_000))
  if (days < 1) return 'today'
  if (days < 7) return `${days}d`
  if (days < 35) return `${Math.max(1, Math.round(days / 7))}w`
  if (days < 365) return `${Math.max(1, Math.round(days / 30))}mo`
  return `${Math.round(days / 365)}y`
}

/** Sentence form of relativeSeen: "today", "3w ago", "—". */
function relativeSeenAgo(iso: string | undefined, now: number): string {
  const short = relativeSeen(iso, now)
  return short === 'today' || short === '—' ? short : `${short} ago`
}

function fmtDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function seedNotesHtml(
  notesHtml: string | undefined,
  notes: string | undefined,
): string {
  if (notesHtml) return sanitizeNotesHtml(notesHtml)
  if (!notes) return ''
  return sanitizeNotesHtml(
    notes
      .split('\n')
      .map(
        line => `<p>${line.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`,
      )
      .join(''),
  )
}

/**
 * Click-to-edit value: renders as text (muted imperative when empty),
 * becomes a bare input on click. Enter/blur commits, Escape reverts —
 * the row hover and text cursor are the only edit affordances.
 */
function Inline({
  value,
  empty,
  onCommit,
  serif,
  size,
  color,
}: {
  value: string
  empty: string
  onCommit: (value: string) => void
  serif?: boolean
  size?: number
  color?: string
}): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  // Escape reverts; the blur the browser may fire as the input unmounts
  // must not then commit the abandoned draft.
  const cancelled = useRef(false)
  if (draft === null) {
    return (
      <InlineText
        role="button"
        tabIndex={0}
        $serif={serif}
        $size={size}
        $color={value ? color : undefined}
        $empty={!value}
        onClick={() => setDraft(value)}
        onKeyDown={event => {
          if (event.key === 'Enter') setDraft(value)
        }}
      >
        {value || empty}
      </InlineText>
    )
  }
  return (
    <InlineInput
      autoFocus
      $serif={serif}
      $size={size}
      value={draft}
      placeholder={empty}
      onChange={event => setDraft(event.currentTarget.value)}
      onBlur={() => {
        if (!cancelled.current) onCommit(draft)
        cancelled.current = false
        setDraft(null)
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          onCommit(draft)
          setDraft(null)
        }
        if (event.key === 'Escape') {
          cancelled.current = true
          setDraft(null)
        }
      }}
    />
  )
}

/** Chip set with hover-× removal and a dashed add-chip with typeahead. */
function ChipSet({
  items,
  suggestions,
  addLabel,
  variant,
  onChange,
}: {
  items: string[]
  suggestions: string[]
  addLabel: string
  variant: 'tag' | 'topic'
  onChange: (items: string[]) => void
}): React.ReactElement {
  const [draft, setDraft] = useState<string | null>(null)
  const listId = useRef(
    `chips-${Math.random().toString(36).slice(2, 8)}`,
  ).current
  const Chip = variant === 'tag' ? TagChip : TopicChip
  const cancelled = useRef(false)
  const commit = (): void => {
    const value = cancelled.current ? '' : (draft ?? '').trim()
    cancelled.current = false
    if (value && !items.includes(value)) onChange([...items, value])
    setDraft(null)
  }
  return (
    <ChipRow>
      {items.map(item => (
        <Chip key={item}>
          {item}
          <ChipX
            role="button"
            aria-label={`Remove ${item}`}
            onClick={() => onChange(items.filter(other => other !== item))}
          >
            ×
          </ChipX>
        </Chip>
      ))}
      {draft === null ? (
        <AddChip role="button" tabIndex={0} onClick={() => setDraft('')}>
          {addLabel}
        </AddChip>
      ) : (
        <>
          <ChipInput
            autoFocus
            list={listId}
            value={draft}
            onChange={event => setDraft(event.currentTarget.value)}
            onBlur={commit}
            onKeyDown={event => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') {
                cancelled.current = true
                setDraft(null)
              }
            }}
          />
          <datalist id={listId}>
            {suggestions
              .filter(item => !items.includes(item))
              .map(item => (
                <option key={item} value={item} />
              ))}
          </datalist>
        </>
      )}
    </ChipRow>
  )
}

/** Plain string-list editor rendered as lines (or inline values). */
function ListEditor({
  items,
  empty,
  addLabel,
  inline,
  onChange,
}: {
  items: string[]
  empty: string
  addLabel: string
  inline?: boolean
  onChange: (items: string[]) => void
}): React.ReactElement {
  if (items.length === 0) {
    return (
      <Inline
        value=""
        empty={empty}
        size={15}
        onCommit={value => {
          if (value.trim()) onChange([value.trim()])
        }}
      />
    )
  }
  return (
    <ColumnOrRow $inline={inline}>
      {items.map((item, index) => (
        <LinkLine key={`${item}-${index}`}>
          <Inline
            value={item}
            empty=""
            size={15}
            onCommit={value => {
              const next = [...items]
              if (value.trim()) next[index] = value.trim()
              else next.splice(index, 1)
              onChange(next)
            }}
          />
        </LinkLine>
      ))}
      <Inline
        value=""
        empty={addLabel}
        size={13.5}
        onCommit={value => {
          if (value.trim()) onChange([...items, value.trim()])
        }}
      />
    </ColumnOrRow>
  )
}

function Chevron(): React.ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      style={{ stroke: 'var(--pp-icon)' }}
      strokeWidth="2.6"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function PeopleShell({
  store,
  update,
}: {
  store: PeopleStore
  update: PeopleUpdate
}): React.ReactElement {
  const [saveError, setSaveError] = useState<string | null>(null)
  const storeRef = useRef(store)
  storeRef.current = store
  const commit: PeopleUpdate = async updater => {
    try {
      const saved = await update(updater)
      storeRef.current = saved
      setSaveError(null)
      return saved
    } catch (error) {
      console.error('[purepeople] save failed:', error)
      setSaveError(error instanceof Error ? error.message : String(error))
      throw error
    }
  }
  const pendingEdits = useRef(new Set<Promise<void>>())
  const failedEdits = useRef(new Set<Parameters<PeopleUpdate>[0]>())
  const setStore = (
    updater: Parameters<PeopleUpdate>[0],
    onSaved?: () => void,
  ): void => {
    const pending = commit(updater).then(() => { failedEdits.current.delete(updater); onSaved?.() }).catch(error => {
      console.error('[purepeople] save failed:', error)
      failedEdits.current.add(updater)
    }).finally(() => pendingEdits.current.delete(pending))
    pendingEdits.current.add(pending)
  }

  const now = Date.now()
  const [tab, setTab] = useState<'people' | 'orgs'>('people')
  /** null = every person; otherwise the list being worked through. */
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [newListOpen, setNewListOpen] = useState(false)
  const [newListDraft, setNewListDraft] = useState('')
  const [listEditOpen, setListEditOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>('lastSeen')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  /** An event board over the app: a list or a search, laid out to prepare for meeting its people. */
  const [board, setBoard] = useState<BoardScope | null>(null)
  /** A person's network over the app, optionally scoped to the board it came from. */
  const [network, setNetwork] = useState<{ centerId: string; scopeIds?: string[]; label?: string } | null>(null)
  const [navStack, setNavStack] = useState<
    { tab: 'people' | 'orgs'; id: string | null }[]
  >([])
  const [newDraft, setNewDraft] = useState<string | null>(null)
  const [deleteArmed, setDeleteArmed] = useState(false)
  useEffect(() => setDeleteArmed(false), [selectedId, selectedOrgId, tab])
  const [listDeleteArmed, setListDeleteArmed] = useState(false)
  useEffect(() => setListDeleteArmed(false), [activeListId, tab])
  useEffect(() => setNewDraft(null), [tab])

  const toolContextRef = useRef({ store, setStore: commit })
  toolContextRef.current = { get store() { return storeRef.current }, setStore: commit }
  usePlatformAgentTools({
    // Standalone Vite has no shell to register with; skip the handshake.
    ready: !isStandaloneDevMode(),
    tools: PUREPEOPLE_AGENT_TOOL_NAMES,
    logLabel: PUREPEOPLE_AGENT_LOG_LABEL,
    errorType: AgentPeopleToolError,
    handlers: {
      listContacts: async invoke =>
        listContactsHandler(toolContextRef.current, invoke.arguments ?? {}),
      getContact: async invoke =>
        getContactHandler(toolContextRef.current, invoke.arguments ?? {}),
      prepareProfilePhotoResearch: async invoke =>
        prepareProfilePhotoResearchHandler(toolContextRef.current, invoke.arguments ?? {}),
      upsertContact: async invoke =>
        upsertContactHandler(toolContextRef.current, invoke.arguments ?? {}),
      mergeContacts: async invoke =>
        mergeContactsHandler(toolContextRef.current, invoke.arguments ?? {}),
      listOrgs: async invoke =>
        listOrgsHandler(toolContextRef.current, invoke.arguments ?? {}),
      getOrg: async invoke =>
        getOrgHandler(toolContextRef.current, invoke.arguments ?? {}),
      upsertOrg: async invoke =>
        upsertOrgHandler(toolContextRef.current, invoke.arguments ?? {}),
      listLists: async () => listListsHandler(toolContextRef.current),
      createList: async invoke =>
        createListHandler(toolContextRef.current, invoke.arguments ?? {}),
      renameList: async invoke =>
        renameListHandler(toolContextRef.current, invoke.arguments ?? {}),
      deleteList: async invoke =>
        deleteListHandler(toolContextRef.current, invoke.arguments ?? {}),
      addToList: async invoke =>
        addToListHandler(toolContextRef.current, invoke.arguments ?? {}),
      removeFromList: async invoke =>
        removeFromListHandler(toolContextRef.current, invoke.arguments ?? {}),
      getEventBoard: async invoke =>
        getEventBoardHandler(toolContextRef.current, invoke.arguments ?? {}),
      setEventPrep: async invoke =>
        setEventPrepHandler(toolContextRef.current, invoke.arguments ?? {}),
      getPersonNetwork: async invoke =>
        getPersonNetworkHandler(toolContextRef.current, invoke.arguments ?? {}),
    },
  })

  // ---- selection + derived collections -------------------------------
  const selected = selectedId
    ? contactByIdOrEmail(store, selectedId) ?? null
    : null
  const selectedOrg = selectedOrgId
    ? orgByIdOrName(store, selectedOrgId) ?? null
    : null
  const orgPeople = useMemo(
    () => (selectedOrg ? peopleForOrg(store, selectedOrg) : []),
    [store, selectedOrg],
  )
  const selectedContactOrg = useMemo(
    () => (selected ? orgForContact(store, selected) ?? null : null),
    [store, selected],
  )

  // Keep the drawer grounded in the record on screen. Publishing replaces the
  // previous snapshot for this tab, so switching records cannot leave stale
  // identity behind; store edits republish the updated values too.
  useEffect(() => {
    const context =
      tab === 'people' && selected
        ? { kind: 'person' as const, record: selected }
        : tab === 'orgs' && selectedOrg
          ? { kind: 'organisation' as const, record: selectedOrg }
          : null

    const update = context
      ? publishOpenRecordContext(context)
      : clearOpenRecordContext()
    void update.catch(error =>
      console.warn('[purepeople] could not publish open record context:', error),
    )
  }, [selected, selectedOrg, tab])

  useEffect(
    () => () => {
      void clearOpenRecordContext().catch(() => undefined)
    },
    [],
  )

  const peopleMatches = useMemo(() => {
    const list = [...searchContacts(store, query, RAIL_LIMIT, activeListId)]
    if (sort === 'added')
      list.sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
    else if (sort === 'name')
      list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'org')
      list.sort(
        (a, b) =>
          (a.org ?? '￿').localeCompare(b.org ?? '￿') ||
          a.name.localeCompare(b.name),
      )
    else list.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    return list
  }, [store, query, sort, activeListId])
  const stalePartition = useMemo(() => {
    if (sort !== 'lastSeen') return { recent: peopleMatches, stale: [] }
    const cutoff = now - STALE_MONTHS * 30 * 86_400_000
    return {
      recent: peopleMatches.filter(
        contact => Date.parse(contact.lastSeenAt) >= cutoff,
      ),
      stale: peopleMatches.filter(
        contact => Date.parse(contact.lastSeenAt) < cutoff,
      ),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleMatches, sort])
  // Org last-seen rolls up from its people (max), so a stale org is
  // visible in the list without opening it.
  const orgRollups = useMemo(() => {
    const lastSeen = new Map<string, string>()
    const counts = new Map<string, number>()
    for (const org of storeOrgs(store)) {
      const people = peopleForOrg(store, org)
      counts.set(org.id, people.length)
      let last = org.lastSeenAt
      for (const person of people) {
        if (person.lastSeenAt > last) last = person.lastSeenAt
      }
      lastSeen.set(org.id, last)
    }
    return { lastSeen, counts }
  }, [store])
  const orgMatches = useMemo(() => {
    const list = [...searchOrgs(store, query, RAIL_LIMIT)]
    if (sort === 'name' || sort === 'org')
      list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'added')
      list.sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt))
    else
      list.sort((a, b) =>
        (orgRollups.lastSeen.get(b.id) ?? b.lastSeenAt).localeCompare(
          orgRollups.lastSeen.get(a.id) ?? a.lastSeenAt,
        ),
      )
    return list
  }, [store, query, sort, orgRollups])
  // Search spans both tabs; with a query, the OTHER tab's matches are
  // appended as labelled rows — the tabs are a filter, not a boundary.
  const hasQuery = query.trim().length > 0

  const lists = storeLists(store)
  const counts = useMemo(() => listCounts(store), [store])
  const activeList = activeListId
    ? lists.find(list => list.id === activeListId) ?? null
    : null
  useEffect(() => {
    // A list deleted while open drops the view back to everyone.
    if (activeListId && !activeList) setActiveListId(null)
  }, [activeListId, activeList])

  const createListNamed = (name: string): void => {
    if (!name.trim()) return
    let createdId = ''
    setStore(current => {
      const result = createList(current, name)
      createdId = result.list.id
      return result.store
    }, () => {
      setActiveListId(createdId || null)
      setNewListDraft('')
      setNewListOpen(false)
    })
  }

  const renameActiveList = (raw: string): void => {
    if (!activeList) return
    const name = raw.trim()
    if (!name || name === activeList.name) return
    const taken = listByIdOrName(storeRef.current, name)
    if (taken && taken.id !== activeList.id) {
      setImportNote(`A list called "${taken.name}" already exists.`)
      return
    }
    setStore(current => renameList(current, activeList.id, name))
  }

  const toggleContactList = (contactId: string, listId: string): void => {
    setStore(current => {
      const contact = contactByIdOrEmail(current, contactId)
      if (!contact) return current
      return contactInList(contact, listId)
        ? removeFromList(current, listId, contactId)
        : addToList(
            current,
            lists.find(list => list.id === listId)?.name ?? listId,
            [contactId],
          )
    })
  }

  // ---- navigation ----------------------------------------------------
  const pushNav = (): void =>
    setNavStack(stack => [
      ...stack.slice(-15),
      { tab, id: tab === 'people' ? selectedId : selectedOrgId },
    ])
  const openPerson = (id: string, push = false): void => {
    if (push) pushNav()
    setSelectedId(id)
    setTab('people')
  }
  const openOrg = (idOrName: string, push = false): void => {
    const existing = orgByIdOrName(storeRef.current, idOrName)
    let id = existing?.id ?? orgKey(idOrName)
    const show = (): void => {
      if (push) pushNav()
      setSelectedOrgId(id)
      setTab('orgs')
    }
    if (!existing) {
      setStore(current => {
        const result = upsertOrg(current, { name: idOrName }, 'user')
        id = result.org.id
        return result.store
      }, show)
    } else show()
  }
  const goBack = (): void => {
    const top = navStack[navStack.length - 1]
    if (!top) return
    setNavStack(stack => stack.slice(0, -1))
    setTab(top.tab)
    if (top.tab === 'people') setSelectedId(top.id)
    else setSelectedOrgId(top.id)
  }

  // ---- person editing ------------------------------------------------
  const editField = (
    field: 'name' | 'org' | 'title' | 'avatarUrl' | 'status',
    value: string,
  ): void => {
    if (!selected) return
    setStore(
      current =>
        upsertContact(current, { email: selected.id, [field]: value }, 'user')
          .store,
    )
  }
  const editList = (
    field: 'phones' | 'tags' | 'topics' | 'channels',
    items: string[],
  ): void => {
    if (!selected) return
    setStore(
      current =>
        upsertContact(current, { email: selected.id, [field]: items }, 'user')
          .store,
    )
  }
  const setEmailsList = (emails: string[]): void => {
    if (!selected) return
    const clean = emails
      .map(normalizeEmail)
      .filter(item => item.includes('@'))
    if (clean.length === 0) return
    setStore(
      current =>
        upsertContact(
          current,
          { email: selected.id, setEmails: clean },
          'user',
        ).store,
    )
  }
  const commitLinks = (links: ContactLink[]): void => {
    if (tab === 'orgs') {
      if (!selectedOrg) return
      setStore(
        current =>
          upsertOrg(current, { name: selectedOrg.id, links }, 'user').store,
      )
      return
    }
    if (!selected) return
    setStore(
      current =>
        upsertContact(current, { email: selected.id, links }, 'user').store,
    )
  }

  // ---- org editing ---------------------------------------------------
  const editOrgField = (
    field:
      | 'rename'
      | 'industry'
      | 'owner'
      | 'city'
      | 'country'
      | 'avatarUrl'
      | 'status',
    value: string,
  ): void => {
    if (!selectedOrg) return
    if (field === 'rename' && !value.trim()) return
    setStore(
      current =>
        upsertOrg(current, { name: selectedOrg.id, [field]: value }, 'user')
          .store,
    )
  }
  const editOrgList = (
    field: 'phones' | 'tags' | 'aliases' | 'domains',
    items: string[],
  ): void => {
    if (!selectedOrg) return
    setStore(
      current =>
        upsertOrg(current, { name: selectedOrg.id, [field]: items }, 'user')
          .store,
    )
  }

  // ---- avatar --------------------------------------------------------
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false)
  const [photoLinkDraft, setPhotoLinkDraft] = useState<string | null>(null)
  const [avatarZoom, setAvatarZoom] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [photoResearchStatus, setPhotoResearchStatus] = useState<string | null>(null)
  const avatarFileRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    setPhotoMenuOpen(false)
    setPhotoLinkDraft(null)
    setAvatarZoom(false)
    setAvatarError(null)
    setPhotoResearchStatus(null)
  }, [selectedId, selectedOrgId, tab])
  useEffect(() => {
    if (!avatarZoom) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAvatarZoom(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [avatarZoom])
  const setAvatarUrl = (url: string): void => {
    if (tab === 'orgs') editOrgField('avatarUrl', url)
    else editField('avatarUrl', url)
  }
  const onAvatarFile = (file: File | undefined): void => {
    if (!file) return
    setAvatarError(null)
    void imageFileToAvatarDataUrl(file)
      .then(dataUrl => setAvatarUrl(dataUrl))
      .catch(error =>
        setAvatarError(
          error instanceof Error ? error.message : 'Upload failed.',
        ),
      )
  }
  const requestPhotoResearch = async (): Promise<void> => {
    if (!selected) return
    setPhotoResearchStatus('Opening the assistant drawer…')
    const handed = await askDrawer(comprehensivePhotoResearchPrompt(selected))
    setPhotoResearchStatus(
      handed
        ? 'The assistant is researching this person in the drawer.'
        : 'Open this profile in PureDesktop to use the assistant drawer.',
    )
  }

  // ---- notes ---------------------------------------------------------
  const notesTimerRef = useRef<number | null>(null)
  const pendingNotesRef = useRef<{
    target: 'contact' | 'org'
    key: string
    html: string
  } | null>(null)
  const applyNotes = (
    current: PeopleStore,
    pending: { target: 'contact' | 'org'; key: string; html: string },
  ): PeopleStore => {
    const clean = sanitizeNotesHtml(pending.html)
    const notes = notesTextFromHtml(clean)
    return pending.target === 'org'
      ? upsertOrg(
          current,
          { name: pending.key, notesHtml: clean, notes },
          'user',
        ).store
      : upsertContact(
          current,
          { email: pending.key, notesHtml: clean, notes },
          'user',
        ).store
  }
  const scheduleNotes = (
    target: 'contact' | 'org',
    key: string,
    rawHtml: string,
  ): void => {
    pendingNotesRef.current = { target, key, html: rawHtml }
    if (notesTimerRef.current !== null)
      window.clearTimeout(notesTimerRef.current)
    notesTimerRef.current = window.setTimeout(() => {
      notesTimerRef.current = null
      const pending = pendingNotesRef.current
      if (!pending) return
      pendingNotesRef.current = null
      setStore(current => applyNotes(current, pending))
    }, 500)
  }

  // Commit pending editor text on blur, hide, and unmount.
  const flushNow = (): void => {
    const pending = pendingNotesRef.current
    if (!pending) return
    pendingNotesRef.current = null
    if (notesTimerRef.current !== null) {
      window.clearTimeout(notesTimerRef.current)
      notesTimerRef.current = null
    }
    setStore(current => applyNotes(current, pending))
  }
  const flushNowRef = useRef(flushNow)
  flushNowRef.current = flushNow
  useEffect(() => {
    const onHide = (): void => {
      if (document.visibilityState === 'hidden') flushNowRef.current()
    }
    const onPageHide = (): void => flushNowRef.current()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      flushNowRef.current()
    }
  }, [])

  const prepareMerge = async (): Promise<void> => {
    flushNow()
    await Promise.all([...pendingEdits.current])
    for (const updater of failedEdits.current) {
      await commit(updater)
      failedEdits.current.delete(updater)
    }
  }
  const merge = useContactMerge(commit, prepareMerge, (survivor, absorbedId) => {
    setSelectedId(survivor.id)
    setTab('people')
    setQuery('')
    setNavStack(stack => stack.map(entry => entry.tab === 'people' && entry.id === absorbedId ? { ...entry, id: survivor.id } : entry))
  })

  // Seed the uncontrolled notes editors from the record. The editor is
  // re-seeded whenever the STORED notes differ from what it was last
  // seeded with — an agent tool or a feed can rewrite notes while the
  // record is open — but never while the user is typing in it or has an
  // edit waiting to flush: the editor is the authority then, and a reseed
  // would move the caret and lose keystrokes.
  const notesEditorRef = useRef<HTMLDivElement | null>(null)
  const seededNotesRef = useRef<{ key: string; html: string } | null>(null)
  const orgNotesEditorRef = useRef<HTMLDivElement | null>(null)
  const seededOrgNotesRef = useRef<{ key: string; html: string } | null>(
    null,
  )
  const seedEditor = (
    editor: HTMLDivElement | null,
    seeded: React.RefObject<{ key: string; html: string } | null>,
    target: 'contact' | 'org',
    key: string,
    notesHtml: string | undefined,
    notes: string | undefined,
  ): void => {
    if (!editor) return
    const html = seedNotesHtml(notesHtml, notes)
    const sameRecord = seeded.current?.key === key
    if (sameRecord && seeded.current?.html === html) return
    const pending = pendingNotesRef.current
    const busy =
      sameRecord &&
      (document.activeElement === editor ||
        (pending?.target === target && pending.key === key))
    if (busy) return
    seeded.current = { key, html }
    editor.innerHTML = html
  }
  useEffect(() => {
    if (!selected) return
    seedEditor(
      notesEditorRef.current,
      seededNotesRef,
      'contact',
      selected.id,
      selected.notesHtml,
      selected.notes,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])
  useEffect(() => {
    if (!selectedOrg) return
    seedEditor(
      orgNotesEditorRef.current,
      seededOrgNotesRef,
      'org',
      selectedOrg.id,
      selectedOrg.notesHtml,
      selectedOrg.notes,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrg])

  // ---- import / export ----------------------------------------------
  const csvFileRef = useRef<HTMLInputElement | null>(null)
  const [importPreview, setImportPreview] = useState<
    CsvImportParse | OrgCsvImportParse | null
  >(null)
  const [importNote, setImportNote] = useState<string | null>(null)
  const [importIntoList, setImportIntoList] = useState(true)
  const onCsvFile = (file: File | undefined): void => {
    if (!file) return
    setImportNote(null)
    void file
      .text()
      .then(text => setImportPreview(parseImportCsv(text)))
      .catch(() => setImportNote('That file could not be read.'))
  }
  const importNewCount = !importPreview
    ? 0
    : importPreview.kind === 'orgs'
      ? importPreview.entries.filter(entry => !orgByIdOrName(store, entry.name))
          .length
      : importPreview.entries.filter(
          entry => !contactByIdOrEmail(store, entry.contact.email),
        ).length
  const importSkipCount = !importPreview
    ? 0
    : importPreview.kind === 'orgs'
      ? importPreview.skippedRows.length
      : importPreview.skipped.length
  const runImport = (): void => {
    const preview = importPreview
    if (!preview) return
    const updates = preview.entries.length - importNewCount
    const what = preview.kind === 'orgs' ? 'organisations' : 'contacts'
    const onSaved = (): void => {
      setImportPreview(null)
      setImportNote(
        `Imported ${preview.entries.length} ${what} — ${importNewCount} new, ` +
          `${updates} updated, ${importSkipCount} rows skipped.`,
      )
    }
    if (preview.kind === 'orgs') {
      setStore(current =>
        preview.entries.reduce(
          (acc, entry) => mergeOrgImportEntry(acc, entry),
          current,
        ),
        onSaved,
      )
      setTab('orgs')
    } else {
      const listName = importIntoList ? activeList?.name : undefined
      setStore(current => {
        const merged = preview.entries.reduce(
          (acc, entry) => mergeFeedEntry(acc, entry),
          current,
        )
        // Lists named in the file itself (a re-imported backup) are
        // restored first; the open list, if chosen, applies on top.
        return fileImportedContacts(
          merged,
          preview.entries.map(entry => entry.contact),
          listName,
        )
      }, onSaved)
    }
  }
  const exportCsv = (): void => {
    const kind = tab === 'orgs' ? 'orgs' : 'contacts'
    const text =
      kind === 'orgs'
        ? orgsToCsv(storeRef.current)
        : contactsToCsv(storeRef.current)
    const count =
      kind === 'orgs'
        ? storeOrgs(storeRef.current).length
        : storeRef.current.contacts.length
    const stamp = new Date().toISOString().slice(0, 10)
    void saveTextFileAs(`purepeople-${kind}-${stamp}.csv`, text)
      .then(path => {
        if (path)
          setImportNote(
            `Exported ${count} ${
              kind === 'orgs' ? 'organisations' : 'contacts'
            } to ${path}.`,
          )
      })
      .catch(() => setImportNote('Export failed.'))
  }

  // ---- email ---------------------------------------------------------
  const [emailNote, setEmailNote] = useState<string | null>(null)
  useEffect(() => setEmailNote(null), [selectedId])
  const emailSelected = (): void => {
    if (!selected) return
    const contact = selected
    void requestMailCompose([
      { name: contact.name, email: contact.emails[0] ?? '' },
    ])
      .then(() => setEmailNote(`Opening a draft to ${contact.name} in Mail…`))
      .catch(() => setEmailNote('Could not reach Mail.'))
  }

  // ---- org linking review -------------------------------------------
  const [reviewOpen, setReviewOpen] = useState(false)
  const [personPickerDraft, setPersonPickerDraft] = useState<string | null>(
    null,
  )
  useEffect(() => {
    setReviewOpen(false)
    setPersonPickerDraft(null)
  }, [selectedOrgId, tab])
  const domainMatchCount = (domain: string): number =>
    store.contacts.filter(contact =>
      contact.emails.some(
        email => normalizeEmail(email).split('@')[1] === domain,
      ),
    ).length
  // "Unlinked match": the domain links this person here, but their own
  // org text says nothing (or something else). Reviewing stamps the org
  // name onto the person, making the link explicit instead of inferred.
  const unlinkedMatches = useMemo(() => {
    if (!selectedOrg?.domains?.length) return []
    return store.contacts.filter(contact => {
      const domainHit = contact.emails.some(email =>
        selectedOrg.domains!.includes(
          normalizeEmail(email).split('@')[1] ?? '',
        ),
      )
      if (!domainHit) return false
      if (!contact.org?.trim()) return true
      const key = orgKey(contact.org)
      return !(
        selectedOrg.id === key ||
        orgKey(selectedOrg.name) === key ||
        (selectedOrg.aliases ?? []).some(alias => orgKey(alias) === key)
      )
    })
  }, [store, selectedOrg])

  const allTags = useMemo(
    () => [
      ...new Set([
        ...store.contacts.flatMap(contact => contact.tags ?? []),
        ...storeOrgs(store).flatMap(org => org.tags ?? []),
      ]),
    ],
    [store],
  )
  const allTopics = useMemo(
    () => [
      ...new Set(store.contacts.flatMap(contact => contact.topics ?? [])),
    ],
    [store],
  )

  const ownerContact = selectedOrg?.owner
    ? store.contacts.find(
        contact =>
          contact.name.trim().toLowerCase() ===
          selectedOrg.owner!.trim().toLowerCase(),
      )
    : undefined

  // ---- link add draft ------------------------------------------------
  const [linkDraft, setLinkDraft] = useState<{
    label: string
    url: string
  } | null>(null)
  useEffect(() => setLinkDraft(null), [selectedId, selectedOrgId, tab])
  const commitLinkDraft = (links: ContactLink[]): void => {
    if (!linkDraft) return
    let url = linkDraft.url.trim()
    if (!url) {
      setLinkDraft(null)
      return
    }
    if (!/^https?:\/\//i.test(url) && /^[\w-]+(\.[\w-]+)+/.test(url)) {
      url = `https://${url}`
    }
    commitLinks([...links, { label: linkDraft.label.trim(), url }])
    setLinkDraft(null)
  }

  // ===================================================================

  const renderLinksRow = (
    links: ContactLink[],
    labelWidth: number,
  ): React.ReactElement => (
    <FieldRow $label={labelWidth}>
      <FieldLabel>Links</FieldLabel>
      <Column>
        {links.map(link => (
          <LinkLine key={link.url}>
            <LinkLabel>{link.label}</LinkLabel>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              {link.url.replace(/^https?:\/\/(www\.)?/, '')}
            </a>
            <LineX
              role="button"
              aria-label={`Remove link ${link.label}`}
              onClick={() =>
                commitLinks(links.filter(item => item.url !== link.url))
              }
            >
              ×
            </LineX>
          </LinkLine>
        ))}
        {linkDraft ? (
          <LinkAddPair>
            <ChipInput
              autoFocus
              list="purepeople-link-labels"
              placeholder="Label"
              value={linkDraft.label}
              onChange={event =>
                setLinkDraft({
                  ...linkDraft,
                  label: event.currentTarget.value,
                })
              }
            />
            <datalist id="purepeople-link-labels">
              {LINK_LABEL_SUGGESTIONS.map(label => (
                <option key={label} value={label} />
              ))}
            </datalist>
            <ChipInput
              placeholder="https://…"
              style={{ flex: 1 }}
              value={linkDraft.url}
              onChange={event =>
                setLinkDraft({ ...linkDraft, url: event.currentTarget.value })
              }
              onKeyDown={event => {
                if (event.key === 'Enter') commitLinkDraft(links)
                if (event.key === 'Escape') setLinkDraft(null)
              }}
            />
            <QuietLink role="button" onClick={() => commitLinkDraft(links)}>
              Add
            </QuietLink>
          </LinkAddPair>
        ) : (
          <AddLine
            role="button"
            tabIndex={0}
            onClick={() => setLinkDraft({ label: '', url: '' })}
          >
            + add link
          </AddLine>
        )}
      </Column>
    </FieldRow>
  )

  const renderAvatarExtras = (
    avatarUrl: string | undefined,
  ): React.ReactElement => (
    <>
      {photoMenuOpen ? (
        <PhotoMenu>
          <PhotoMenuItem
            role="button"
            onClick={() => {
              setPhotoMenuOpen(false)
              avatarFileRef.current?.click()
            }}
          >
            Upload photo…
          </PhotoMenuItem>
          <PhotoMenuItem
            role="button"
            onClick={() => {
              setPhotoMenuOpen(false)
              setPhotoLinkDraft(avatarUrl ?? '')
            }}
          >
            Use image link…
          </PhotoMenuItem>
          {avatarUrl ? (
            <>
              <PhotoMenuItem
                role="button"
                onClick={() => {
                  setPhotoMenuOpen(false)
                  setAvatarZoom(true)
                }}
              >
                View full size
              </PhotoMenuItem>
              <PhotoMenuItem
                role="button"
                onClick={() => {
                  setPhotoMenuOpen(false)
                  setAvatarUrl('')
                }}
              >
                Remove photo
              </PhotoMenuItem>
            </>
          ) : null}
        </PhotoMenu>
      ) : null}
      {photoLinkDraft !== null ? (
        <ChipInput
          autoFocus
          placeholder="https://…/photo.jpg (Enter applies)"
          style={{ width: 280 }}
          value={photoLinkDraft}
          onChange={event => setPhotoLinkDraft(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') setPhotoLinkDraft(null)
            if (event.key !== 'Enter') return
            setAvatarUrl(photoLinkDraft.trim())
            setPhotoLinkDraft(null)
          }}
          onBlur={() => setPhotoLinkDraft(null)}
        />
      ) : null}
      {avatarError ? (
        <QuietAlert role="alert">{avatarError}</QuietAlert>
      ) : null}
    </>
  )

  const notesEditorProps = (
    target: 'contact' | 'org',
    key: string,
    ref: React.RefObject<HTMLDivElement | null>,
  ): Record<string, unknown> => ({
    contentEditable: true,
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': target === 'org' ? 'Organisation notes' : 'Notes',
    onInput: (event: React.FormEvent<HTMLDivElement>) =>
      scheduleNotes(target, key, event.currentTarget.innerHTML),
    onBlur: () => flushNow(),
    onPaste: (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault()
      const html = event.clipboardData?.getData('text/html')
      const text = event.clipboardData?.getData('text/plain') ?? ''
      document.execCommand(
        'insertHTML',
        false,
        html
          ? sanitizeNotesHtml(html)
          : text
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/\n/g, '<br>'),
      )
      scheduleNotes(target, key, ref.current?.innerHTML ?? '')
    },
  })

  const notesTools = (
    target: 'contact' | 'org',
    key: string,
    ref: React.RefObject<HTMLDivElement | null>,
  ): React.ReactElement => (
    <NotesTools className="notes-tools">
      {(
        [
          ['B', 'bold', 700, 'normal'],
          ['I', 'italic', 400, 'italic'],
          ['•', 'insertUnorderedList', 400, 'normal'],
        ] as const
      ).map(([label, command, weight, styleKind]) => (
        <NotesTool
          key={command}
          style={{ fontWeight: weight, fontStyle: styleKind }}
          onMouseDown={event => {
            event.preventDefault()
            ref.current?.focus()
            document.execCommand(command)
            scheduleNotes(target, key, ref.current?.innerHTML ?? '')
          }}
        >
          {label}
        </NotesTool>
      ))}
    </NotesTools>
  )

  return (
    <Root>
      <PeopleTokens />
      <Rail>
        <RailTabs>
          <RailTab $active={tab === 'people'} onClick={() => setTab('people')}>
            <span>People</span>
            <TabCount $active={tab === 'people'}>
              {store.contacts.length}
            </TabCount>
          </RailTab>
          <RailTab $active={tab === 'orgs'} onClick={() => setTab('orgs')}>
            <span>Orgs</span>
            <TabCount $active={tab === 'orgs'}>
              {storeOrgs(store).length}
            </TabCount>
          </RailTab>
          <TabSpacer />
          <NewLink role="button" tabIndex={0} onClick={() => setNewDraft('')}>
            + New
          </NewLink>
        </RailTabs>

        {tab === 'people' && (
          <ListBar>
            <ListChip
              $active={activeListId === null}
              onClick={() => setActiveListId(null)}
            >
              Everyone
              <ListCount>{store.contacts.length}</ListCount>
            </ListChip>
            {lists.map(list => (
              <ListChip
                key={list.id}
                $active={activeListId === list.id}
                title={list.name}
                onClick={() =>
                  setActiveListId(current =>
                    current === list.id ? null : list.id,
                  )
                }
              >
                {list.name}
                <ListCount>{counts.get(list.id) ?? 0}</ListCount>
              </ListChip>
            ))}
            {newListOpen ? (
              <ChipInput
                autoFocus
                placeholder="List name"
                value={newListDraft}
                onChange={event => setNewListDraft(event.currentTarget.value)}
                onBlur={() => {
                  createListNamed(newListDraft)
                  setNewListOpen(false)
                }}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    setNewListDraft('')
                    setNewListOpen(false)
                  }
                  if (event.key === 'Enter') createListNamed(newListDraft)
                }}
              />
            ) : (
              <AddChip
                role="button"
                tabIndex={0}
                onClick={() => setNewListOpen(true)}
              >
                + list
              </AddChip>
            )}
          </ListBar>
        )}

        {activeList ? (
          <ListToolRow>
            {listEditOpen ? (
              <ChipInput
                autoFocus
                defaultValue={activeList.name}
                aria-label="List name"
                onBlur={event => {
                  renameActiveList(event.currentTarget.value)
                  setListEditOpen(false)
                }}
                onKeyDown={event => {
                  if (event.key === 'Escape') setListEditOpen(false)
                  if (event.key !== 'Enter') return
                  renameActiveList(event.currentTarget.value)
                  setListEditOpen(false)
                }}
              />
            ) : (
              <>
                <QuietLink role="button" onClick={() => setListEditOpen(true)}>
                  Rename
                </QuietLink>
                <DeleteLink
                  role="button"
                  $armed={listDeleteArmed}
                  onClick={() => {
                    if (!listDeleteArmed) {
                      setListDeleteArmed(true)
                      return
                    }
                    setStore(
                      current => removeList(current, activeList.id),
                      () => setActiveListId(null),
                    )
                  }}
                >
                  {listDeleteArmed ? 'Really delete? Click again' : 'Delete list'}
                </DeleteLink>
                <TabSpacer />
                <ListHint>
                  Deleting a list keeps its people
                </ListHint>
              </>
            )}
          </ListToolRow>
        ) : null}

        <RailHead>
          {newDraft !== null ? (
            <SearchInput
              autoFocus
              placeholder={
                tab === 'orgs' ? 'New organisation name' : 'email@example.com'
              }
              value={newDraft}
              onChange={event => setNewDraft(event.currentTarget.value)}
              onBlur={() => setNewDraft(null)}
              onKeyDown={event => {
                if (event.key === 'Escape') setNewDraft(null)
                if (event.key !== 'Enter') return
                const value = newDraft.trim()
                if (!value) return
                if (tab === 'orgs') {
                  openOrg(value)
                } else {
                  if (!value.includes('@')) return
                  const email = value.toLowerCase()
                  setStore(
                    current => upsertContact(current, { email }, 'user').store,
                    () => setSelectedId(email),
                  )
                }
                setNewDraft(null)
              }}
            />
          ) : (
            <SearchInput
              placeholder={
                tab === 'orgs'
                  ? 'Search orgs, industries, domains'
                  : activeList
                    ? `Search ${activeList.name}`
                    : 'Search people, orgs, tags'
              }
              value={query}
              onChange={event => setQuery(event.currentTarget.value)}
            />
          )}
          <SortRow>
            <SortLabel>Sort</SortLabel>
            <SortChipWrap>
              <SortChip onClick={() => setSortMenuOpen(open => !open)}>
                {SORT_LABELS[sort]}
                <Chevron />
              </SortChip>
              {sortMenuOpen ? (
                <SortMenu>
                  {(Object.keys(SORT_LABELS) as SortMode[]).map(mode => (
                    <SortMenuItem
                      key={mode}
                      $active={mode === sort}
                      onClick={() => {
                        setSort(mode)
                        setSortMenuOpen(false)
                      }}
                    >
                      {SORT_LABELS[mode]}
                    </SortMenuItem>
                  ))}
                </SortMenu>
              ) : null}
            </SortChipWrap>
            <TabSpacer />
            {tab === 'people' && (activeList || query.trim()) ? (
              <QuietLink
                role="button"
                title="See everyone here as faces, star who to meet, and prepare"
                onClick={() => setBoard(activeList ? { kind: 'list', listId: activeList.id } : { kind: 'search', query: query.trim() })}
              >
                Open as board
              </QuietLink>
            ) : null}
            <QuietLink
              role="button"
              onClick={() => csvFileRef.current?.click()}
            >
              Import
            </QuietLink>
            <QuietLink role="button" onClick={exportCsv}>
              Export
            </QuietLink>
          </SortRow>
        </RailHead>
        <HiddenFileInput
          ref={csvFileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={event => {
            onCsvFile(event.currentTarget.files?.[0])
            event.currentTarget.value = ''
          }}
        />
        {importPreview ? (
          <ImportPanel>
            <div>
              {importPreview.profile === 'hubspot' ? 'HubSpot export' : 'CSV'}{' '}
              — {importPreview.entries.length}{' '}
              {importPreview.kind === 'orgs' ? 'organisations' : 'contacts'}{' '}
              ready ({importNewCount} new,{' '}
              {importPreview.entries.length - importNewCount} updating).{' '}
              {importSkipCount} rows skipped. Imports fill empty fields only.
            </div>
            {activeList && importPreview.kind === 'contacts' ? (
              <label
                style={{ display: 'flex', gap: 6, alignItems: 'center' }}
              >
                <input
                  type="checkbox"
                  checked={importIntoList}
                  onChange={event =>
                    setImportIntoList(event.currentTarget.checked)
                  }
                />
                Add them to {activeList.name}
              </label>
            ) : null}
            <ImportActions>
              <ImportButton onClick={runImport}>
                Import {importPreview.entries.length}
              </ImportButton>
              <QuietLink role="button" onClick={() => setImportPreview(null)}>
                Cancel
              </QuietLink>
            </ImportActions>
          </ImportPanel>
        ) : null}
        {importNote ? (
          <ImportPanel role="status" onClick={() => setImportNote(null)}>
            {importNote}
          </ImportPanel>
        ) : null}
        {saveError ? (
          <ImportPanel role="alert">Could not save: {saveError}. Your change was not confirmed; retry it.</ImportPanel>
        ) : null}
        <RailList>
          {tab === 'people' ? (
            <>
              {stalePartition.recent.map(contact => (
                <RailRow
                  key={contact.id}
                  $active={selected?.id === contact.id}
                  onClick={() => {
                    setSelectedId(contact.id)
                    setNavStack([])
                  }}
                >
                  <RailRowText>
                    <RailRowName $active={selected?.id === contact.id}>
                      {contact.name}
                    </RailRowName>
                    <RailRowSub>
                      {contact.org || contact.emails[0]?.split('@')[1] || ''}
                    </RailRowSub>
                  </RailRowText>
                  <RailRowSeen>
                    {relativeSeen(contact.lastSeenAt, now)}
                  </RailRowSeen>
                </RailRow>
              ))}
              {stalePartition.stale.length > 0 && (
                <StaleHeader>
                  <span>Not seen in {STALE_MONTHS} months</span>
                  <Rule />
                </StaleHeader>
              )}
              {stalePartition.stale.map(contact => (
                <RailRow
                  key={contact.id}
                  $active={selected?.id === contact.id}
                  onClick={() => {
                    setSelectedId(contact.id)
                    setNavStack([])
                  }}
                >
                  <RailRowText>
                    <RailRowName $stale>{contact.name}</RailRowName>
                    <RailRowSub $stale>
                      {contact.org || contact.emails[0]?.split('@')[1] || ''}
                    </RailRowSub>
                  </RailRowText>
                  <RailRowSeen $stale>
                    {relativeSeen(contact.lastSeenAt, now)}
                  </RailRowSeen>
                </RailRow>
              ))}
              {peopleMatches.length === 0 && (
                <EmptyNote>
                  {store.contacts.length === 0
                    ? 'No people yet. Other apps feed this list as you use them.'
                    : 'No matches.'}
                </EmptyNote>
              )}
              {peopleMatches.length >= RAIL_LIMIT && (
                <EmptyNote>
                  Showing the first {RAIL_LIMIT}. Search to narrow the list.
                </EmptyNote>
              )}
              {hasQuery && orgMatches.length > 0 && (
                <>
                  <StaleHeader>
                    <span>Orgs matching</span>
                    <Rule />
                  </StaleHeader>
                  {orgMatches.map(org => (
                    <RailRow key={`x-${org.id}`} onClick={() => openOrg(org.id)}>
                      <RailRowText>
                        <RailRowName>{org.name}</RailRowName>
                        <RailRowSub>
                          {[org.industry, org.city]
                            .filter(Boolean)
                            .join(' · ')}
                        </RailRowSub>
                      </RailRowText>
                      <TypeBadge>Org</TypeBadge>
                    </RailRow>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              {orgMatches.map(org => (
                <RailRow
                  key={org.id}
                  $active={selectedOrg?.id === org.id}
                  onClick={() => {
                    setSelectedOrgId(org.id)
                    setNavStack([])
                  }}
                >
                  <RailRowText>
                    <RailRowName $active={selectedOrg?.id === org.id}>
                      {org.name}
                    </RailRowName>
                    <RailRowSub>
                      {[org.industry, org.city].filter(Boolean).join(' · ')}
                    </RailRowSub>
                  </RailRowText>
                  <CountBadge>{orgRollups.counts.get(org.id) ?? 0}</CountBadge>
                  <RailRowSeen $fixed>
                    {relativeSeen(orgRollups.lastSeen.get(org.id), now)}
                  </RailRowSeen>
                </RailRow>
              ))}
              {orgMatches.length === 0 && (
                <EmptyNote>
                  {storeOrgs(store).length === 0
                    ? 'No organisations yet. Import a companies CSV or add one.'
                    : 'No matches.'}
                </EmptyNote>
              )}
              {orgMatches.length >= RAIL_LIMIT && (
                <EmptyNote>
                  Showing the first {RAIL_LIMIT}. Search to narrow the list.
                </EmptyNote>
              )}
              {hasQuery && peopleMatches.length > 0 && (
                <>
                  <StaleHeader>
                    <span>People matching</span>
                    <Rule />
                  </StaleHeader>
                  {peopleMatches.map(contact => (
                    <RailRow
                      key={`x-${contact.id}`}
                      onClick={() => openPerson(contact.id)}
                    >
                      <RailRowText>
                        <RailRowName>{contact.name}</RailRowName>
                        <RailRowSub>{contact.org ?? ''}</RailRowSub>
                      </RailRowText>
                      <TypeBadge>Person</TypeBadge>
                    </RailRow>
                  ))}
                </>
              )}
            </>
          )}
        </RailList>
      </Rail>

      <Detail>
        {tab === 'orgs' ? (
          selectedOrg ? (
            <>
              <DetailScroll>
                <Measure $wide>
                  {navStack.length > 0 && (
                    <BackLink role="button" onClick={goBack}>
                      ← Back
                    </BackLink>
                  )}
                  <HeaderBlock>
                    <HeaderTop>
                      {selectedOrg.avatarUrl ? (
                        <AvatarImg
                          $square
                          src={selectedOrg.avatarUrl}
                          alt=""
                          onClick={() => setPhotoMenuOpen(open => !open)}
                        />
                      ) : (
                        <AvatarFallback
                          $square
                          onClick={() => setPhotoMenuOpen(open => !open)}
                        >
                          {selectedOrg.name.trim().charAt(0).toUpperCase() ||
                            '?'}
                        </AvatarFallback>
                      )}
                      <HeaderNameCol>
                        <Inline
                          value={selectedOrg.name}
                          empty="Organisation name"
                          serif
                          size={32}
                          color="var(--pp-ink-deep)"
                          onCommit={value => editOrgField('rename', value)}
                        />
                        <SubLine>
                          <Inline
                            value={selectedOrg.industry ?? ''}
                            empty="Add industry"
                            size={13.5}
                            color="var(--pp-text-soft)"
                            onCommit={value => editOrgField('industry', value)}
                          />
                          <Dot>·</Dot>
                          <Inline
                            value={selectedOrg.city ?? ''}
                            empty="City"
                            size={13.5}
                            color="var(--pp-text-soft)"
                            onCommit={value => editOrgField('city', value)}
                          />
                          <Dot>,</Dot>
                          <Inline
                            value={selectedOrg.country ?? ''}
                            empty="Country"
                            size={13.5}
                            color="var(--pp-text-soft)"
                            onCommit={value => editOrgField('country', value)}
                          />
                        </SubLine>
                      </HeaderNameCol>
                    </HeaderTop>
                    {renderAvatarExtras(selectedOrg.avatarUrl)}
                    <ChipSet
                      items={selectedOrg.tags ?? []}
                      suggestions={allTags}
                      addLabel="+ tag"
                      variant="tag"
                      onChange={items => editOrgList('tags', items)}
                    />
                  </HeaderBlock>

                  <Rows>
                    <FieldRow $label={132}>
                      <FieldLabel>People here</FieldLabel>
                      <Column>
                        {orgPeople.map(person => (
                          <PersonNavRow
                            key={person.id}
                            onClick={() => openPerson(person.id, true)}
                          >
                            <MiniAvatar>
                              {person.name.trim().charAt(0).toUpperCase()}
                            </MiniAvatar>
                            <PersonNavName>{person.name}</PersonNavName>
                            <PersonNavRole>
                              {person.title ?? ''}
                            </PersonNavRole>
                            <TabSpacer />
                            <RailRowSeen>
                              {relativeSeen(person.lastSeenAt, now)}
                            </RailRowSeen>
                            <NavChevron>›</NavChevron>
                          </PersonNavRow>
                        ))}
                        {personPickerDraft !== null ? (
                          <>
                            <ChipInput
                              autoFocus
                              placeholder="Type a name…"
                              value={personPickerDraft}
                              onChange={event =>
                                setPersonPickerDraft(event.currentTarget.value)
                              }
                              onKeyDown={event => {
                                if (event.key === 'Escape')
                                  setPersonPickerDraft(null)
                              }}
                            />
                            {personPickerDraft.trim() &&
                              searchContacts(store, personPickerDraft, 5).map(
                                person => (
                                  <PersonNavRow
                                    key={`pick-${person.id}`}
                                    onClick={() => {
                                      setStore(
                                        current =>
                                          upsertContact(
                                            current,
                                            {
                                              email: person.id,
                                              org: selectedOrg.name,
                                            },
                                            'user',
                                          ).store,
                                      )
                                      setPersonPickerDraft(null)
                                    }}
                                  >
                                    <MiniAvatar>
                                      {person.name
                                        .trim()
                                        .charAt(0)
                                        .toUpperCase()}
                                    </MiniAvatar>
                                    <PersonNavName>
                                      {person.name}
                                    </PersonNavName>
                                    <PersonNavRole>
                                      {person.emails[0]}
                                    </PersonNavRole>
                                  </PersonNavRow>
                                ),
                              )}
                          </>
                        ) : (
                          <AddLine
                            role="button"
                            tabIndex={0}
                            onClick={() => setPersonPickerDraft('')}
                          >
                            + link a person
                          </AddLine>
                        )}
                      </Column>
                    </FieldRow>

                    <FieldRow $label={132}>
                      <FieldLabel>Email domains</FieldLabel>
                      <Column>
                        {(selectedOrg.domains ?? []).map(domain => (
                          <LinkLine key={domain}>
                            <DomainText>{domain}</DomainText>
                            <DomainMeta>
                              {domainMatchCount(domain) > 0
                                ? `${domainMatchCount(domain)} ${
                                    domainMatchCount(domain) === 1
                                      ? 'person'
                                      : 'people'
                                  } matched`
                                : 'no matches yet'}
                            </DomainMeta>
                            <LineX
                              role="button"
                              aria-label={`Remove domain ${domain}`}
                              onClick={() =>
                                editOrgList(
                                  'domains',
                                  (selectedOrg.domains ?? []).filter(
                                    item => item !== domain,
                                  ),
                                )
                              }
                            >
                              ×
                            </LineX>
                          </LinkLine>
                        ))}
                        <Inline
                          value=""
                          empty="+ add domain"
                          size={13.5}
                          onCommit={value => {
                            const domain = value
                              .trim()
                              .toLowerCase()
                              .replace(/^@/, '')
                            if (!domain) return
                            editOrgList('domains', [
                              ...(selectedOrg.domains ?? []),
                              domain,
                            ])
                          }}
                        />
                        {unlinkedMatches.length > 0 && (
                          <ReviewLine>
                            <ReviewLink
                              role="button"
                              onClick={() => setReviewOpen(open => !open)}
                            >
                              Review {unlinkedMatches.length} unlinked{' '}
                              {unlinkedMatches.length === 1
                                ? 'match'
                                : 'matches'}
                            </ReviewLink>
                            <WarnBadge>{unlinkedMatches.length}</WarnBadge>
                          </ReviewLine>
                        )}
                        {reviewOpen &&
                          unlinkedMatches.map(person => (
                            <PersonNavRow key={`rev-${person.id}`}>
                              <MiniAvatar>
                                {person.name.trim().charAt(0).toUpperCase()}
                              </MiniAvatar>
                              <PersonNavName>{person.name}</PersonNavName>
                              <PersonNavRole>
                                {person.org?.trim()
                                  ? `org says “${person.org}”`
                                  : 'no org set'}
                              </PersonNavRole>
                              <TabSpacer />
                              <ReviewLink
                                role="button"
                                onClick={() =>
                                  setStore(
                                    current =>
                                      upsertContact(
                                        current,
                                        {
                                          email: person.id,
                                          org: selectedOrg.name,
                                        },
                                        'user',
                                      ).store,
                                  )
                                }
                              >
                                Link here
                              </ReviewLink>
                            </PersonNavRow>
                          ))}
                      </Column>
                    </FieldRow>

                    <FieldRow $label={132}>
                      <FieldLabel>Status</FieldLabel>
                      <ValueLine>
                        <Inline
                          value={selectedOrg.status ?? ''}
                          empty="Relationship status, e.g. In Progress"
                          size={15}
                          onCommit={value => editOrgField('status', value)}
                        />
                      </ValueLine>
                    </FieldRow>

                    <FieldRow $label={132}>
                      <FieldLabel>Relationship owner</FieldLabel>
                      <ValueLine>
                        {ownerContact ? (
                          <>
                            <ValueLink
                              role="button"
                              onClick={() => openPerson(ownerContact.id, true)}
                            >
                              {selectedOrg.owner}
                            </ValueLink>
                            <OwnerMark>internal</OwnerMark>
                          </>
                        ) : (
                          <Inline
                            value={selectedOrg.owner ?? ''}
                            empty="Who owns this relationship?"
                            size={15}
                            onCommit={value => editOrgField('owner', value)}
                          />
                        )}
                      </ValueLine>
                    </FieldRow>

                    <FieldRow $label={132}>
                      <FieldLabel>Phone</FieldLabel>
                      <ListEditor
                        items={selectedOrg.phones ?? []}
                        empty="Add a number"
                        addLabel="+ add phone"
                        onChange={items => editOrgList('phones', items)}
                      />
                    </FieldRow>

                    <FieldRow $label={132}>
                      <FieldLabel>Also known as</FieldLabel>
                      <ListEditor
                        items={selectedOrg.aliases ?? []}
                        empty="Add an alternate name"
                        addLabel="+ add alias"
                        onChange={items => editOrgList('aliases', items)}
                      />
                    </FieldRow>

                    {renderLinksRow(selectedOrg.links ?? [], 132)}
                  </Rows>

                  <NotesSection>
                    <NotesHead>
                      <FieldLabel>Notes</FieldLabel>
                      <Rule />
                      {notesTools('org', selectedOrg.id, orgNotesEditorRef)}
                    </NotesHead>
                    <NotesBody
                      key={selectedOrg.id}
                      ref={orgNotesEditorRef}
                      data-placeholder="Notes about this organisation…"
                      {...notesEditorProps(
                        'org',
                        selectedOrg.id,
                        orgNotesEditorRef,
                      )}
                    />
                  </NotesSection>
                </Measure>
              </DetailScroll>
              <Footer>
                <FooterMeta>
                  {orgPeople.length}{' '}
                  {orgPeople.length === 1 ? 'person' : 'people'} · last
                  contact{' '}
                  {relativeSeenAgo(
                    orgRollups.lastSeen.get(selectedOrg.id),
                    now,
                  )}{' '}
                  · imported {fmtDate(selectedOrg.firstSeenAt)}
                </FooterMeta>
                <SourceChips>
                  {selectedOrg.sources.map(source => (
                    <SourceChip key={source.app}>{source.app}</SourceChip>
                  ))}
                </SourceChips>
                <TabSpacer />
                <DeleteLink
                  role="button"
                  $armed={deleteArmed}
                  onClick={() => {
                    if (!deleteArmed) {
                      setDeleteArmed(true)
                      return
                    }
                    setStore(
                      current => removeOrg(current, selectedOrg.id),
                      () => setSelectedOrgId(null),
                    )
                  }}
                >
                  {deleteArmed
                    ? `Really delete ${selectedOrg.name}? Click again`
                    : 'Delete org'}
                </DeleteLink>
              </Footer>
            </>
          ) : (
            <EmptyNote style={{ padding: '40px 48px' }}>
              Select an organisation.
            </EmptyNote>
          )
        ) : selected ? (
          <>
            <DetailScroll>
              <Measure>
                {navStack.length > 0 && (
                  <BackLink role="button" onClick={goBack}>
                    ← Back
                  </BackLink>
                )}
                <CrossAppDragHandle transferKind="contact" label="contact" style={{display:'flex',marginBottom:12}} getContent={()=>({kind:'contact',name:selected.name,emails:selected.emails,phones:selected.phones || [],links:(selected.links || []).map(link=>link.url)})} />
                <HeaderBlock>
                  <HeaderTop>
                    {selected.avatarUrl ? (
                      <AvatarImg
                        src={selected.avatarUrl}
                        alt=""
                        onClick={() => setPhotoMenuOpen(open => !open)}
                      />
                    ) : (
                      <AvatarFallback
                        onClick={() => setPhotoMenuOpen(open => !open)}
                      >
                        {selected.name.trim().charAt(0).toUpperCase() || '?'}
                      </AvatarFallback>
                    )}
                    <HeaderNameCol>
                      <Inline
                        value={selected.name}
                        empty="Name"
                        serif
                        size={32}
                        color="var(--pp-ink-deep)"
                        onCommit={value => editField('name', value)}
                      />
                      <SubLine>
                        <Inline
                          value={selected.title ?? ''}
                          empty="Add role"
                          size={13.5}
                          color="var(--pp-text-soft)"
                          onCommit={value => editField('title', value)}
                        />
                        <Dot>·</Dot>
                        {selectedContactOrg &&
                        orgKey(selected.org ?? '') !== '' ? (
                          <ValueLink
                            role="button"
                            $size={13.5}
                            title="Open the org record"
                            onClick={() => openOrg(selectedContactOrg.id, true)}
                          >
                            {selectedContactOrg.name}
                          </ValueLink>
                        ) : null}
                        <Inline
                          value={selectedContactOrg ? '' : selected.org ?? ''}
                          empty={
                            selectedContactOrg
                              ? 'change'
                              : 'Add organisation'
                          }
                          size={selectedContactOrg ? 11.5 : 13.5}
                          color="var(--pp-ink)"
                          onCommit={value => {
                            if (value.trim() || !selectedContactOrg)
                              editField('org', value)
                          }}
                        />
                      </SubLine>
                    </HeaderNameCol>
                    <HeaderAction role="button" onClick={() => setNetwork({ centerId: selected.id })} title="Who they share threads and meetings with">
                      Network
                    </HeaderAction>
                    <HeaderAction role="button" onClick={() => void requestPhotoResearch()}>
                      {selected.avatarUrl ? 'Find better photo' : 'Find photo'}
                    </HeaderAction>
                    <HeaderAction role="button" onClick={emailSelected}>
                      ✉ Email
                    </HeaderAction>
                  </HeaderTop>
                  {renderAvatarExtras(selected.avatarUrl)}
                  {photoResearchStatus ? (
                    <QuietAlert role="status">{photoResearchStatus}</QuietAlert>
                  ) : null}
                  {emailNote ? (
                    <QuietAlert role="status">{emailNote}</QuietAlert>
                  ) : null}
                  <ChipSet
                    items={selected.tags ?? []}
                    suggestions={allTags}
                    addLabel="+ tag"
                    variant="tag"
                    onChange={items => editList('tags', items)}
                  />
                </HeaderBlock>

                <Rows>
                  <FieldRow $label={116}>
                    <FieldLabel>Email</FieldLabel>
                    <Column>
                      {selected.emails.map((email, index) => (
                        <LinkLine key={email}>
                          <Inline
                            value={email}
                            empty=""
                            size={15}
                            onCommit={value => {
                              const next = [...selected.emails]
                              if (value.trim()) next[index] = value
                              else next.splice(index, 1)
                              setEmailsList(next)
                            }}
                          />
                          {index === 0 ? (
                            <PrimaryMark>primary</PrimaryMark>
                          ) : null}
                        </LinkLine>
                      ))}
                      <Inline
                        value=""
                        empty="+ add email"
                        size={13.5}
                        onCommit={value => {
                          if (!value.trim()) return
                          setEmailsList([...selected.emails, value])
                        }}
                      />
                    </Column>
                  </FieldRow>

                  <FieldRow $label={116}>
                    <FieldLabel>Phone</FieldLabel>
                    <ListEditor
                      items={selected.phones ?? []}
                      empty="Add a number"
                      addLabel="+ add phone"
                      onChange={items => editList('phones', items)}
                    />
                  </FieldRow>

                  <FieldRow $label={116}>
                    <FieldLabel>Status</FieldLabel>
                    <ValueLine>
                      <Inline
                        value={selected.status ?? ''}
                        empty="Relationship status, e.g. In Progress"
                        size={15}
                        onCommit={value => editField('status', value)}
                      />
                    </ValueLine>
                  </FieldRow>

                  <FieldRow $label={116}>
                    <FieldLabel>Channels</FieldLabel>
                    <ListEditor
                      items={selected.channels ?? []}
                      empty="How do they prefer to be reached?"
                      addLabel="+ add"
                      inline
                      onChange={items => editList('channels', items)}
                    />
                  </FieldRow>

                  <FieldRow $label={116}>
                    <FieldLabel>Topics</FieldLabel>
                    <ChipSet
                      items={selected.topics ?? []}
                      suggestions={allTopics}
                      addLabel="+ topic"
                      variant="topic"
                      onChange={items => editList('topics', items)}
                    />
                  </FieldRow>

                  <FieldRow $label={116}>
                    <FieldLabel>Lists</FieldLabel>
                    <ChipRow>
                      {listsForContact(store, selected).map(list => (
                        <TagChip key={list.id}>
                          {list.name}
                          <ChipX
                            role="button"
                            aria-label={`Remove from ${list.name}`}
                            onClick={() =>
                              toggleContactList(selected.id, list.id)
                            }
                          >
                            ×
                          </ChipX>
                        </TagChip>
                      ))}
                      {/* Only lists they are NOT on: the chips above are
                          how you take someone off one. */}
                      {lists
                        .filter(list => !contactInList(selected, list.id))
                        .map(list => (
                          <AddChip
                            key={list.id}
                            role="button"
                            tabIndex={0}
                            title={`Add to ${list.name}`}
                            onClick={() =>
                              toggleContactList(selected.id, list.id)
                            }
                          >
                            + {list.name}
                          </AddChip>
                        ))}
                      {lists.length === 0 ? (
                        <QuietAlert>
                          No lists yet — make one beside the People tab.
                        </QuietAlert>
                      ) : null}
                    </ChipRow>
                  </FieldRow>

                  {renderLinksRow(selected.links ?? [], 116)}
                </Rows>

                <RetainedDetails contact={selected} onEdit={edit => setStore(current => editRetainedDetail(current, selected.id, edit))} onOpenOrg={name => openOrg(name, true)} />

                <NotesSection>
                  <NotesHead>
                    <FieldLabel>Notes</FieldLabel>
                    <Rule />
                    {notesTools('contact', selected.id, notesEditorRef)}
                  </NotesHead>
                  <NotesBody
                    key={selected.id}
                    ref={notesEditorRef}
                    data-placeholder="Notes about this person…"
                    {...notesEditorProps(
                      'contact',
                      selected.id,
                      notesEditorRef,
                    )}
                  />
                </NotesSection>
              </Measure>
            </DetailScroll>
            <Footer>
              <FooterMeta>
                <Action onClick={() => merge.open(selected.id)}>Merge with another person</Action>
                Seen {selected.seenCount}× · first{' '}
                {fmtDate(selected.firstSeenAt)} · last{' '}
                {fmtDate(selected.lastSeenAt)}
              </FooterMeta>
              <SourceChips>
                {selected.sources.map(source => (
                  <SourceChip key={source.app}>{source.app}</SourceChip>
                ))}
              </SourceChips>
              <TabSpacer />
              <DeleteLink
                role="button"
                $armed={deleteArmed}
                onClick={() => {
                  if (!deleteArmed) {
                    setDeleteArmed(true)
                    return
                  }
                  setStore(
                    current => removeContact(current, selected.id),
                    () => setSelectedId(null),
                  )
                }}
              >
                {deleteArmed
                  ? `Really delete ${selected.name}? Click again`
                  : 'Delete contact'}
              </DeleteLink>
            </Footer>
          </>
        ) : (
          <EmptyNote style={{ padding: '40px 48px' }}>
            Select a person.
          </EmptyNote>
        )}
      </Detail>

      {merge.survivorId && <MergePerson store={store} workflow={merge} />}

      {avatarZoom &&
      (tab === 'orgs' ? selectedOrg?.avatarUrl : selected?.avatarUrl) ? (
        <Lightbox role="dialog" onClick={() => setAvatarZoom(false)}>
          <LightboxImg
            src={
              (tab === 'orgs'
                ? selectedOrg?.avatarUrl
                : selected?.avatarUrl) ?? ''
            }
            alt=""
          />
        </Lightbox>
      ) : null}
      <HiddenFileInput
        ref={avatarFileRef}
        type="file"
        accept="image/*"
        onChange={event => {
          onAvatarFile(event.currentTarget.files?.[0])
          event.currentTarget.value = ''
        }}
      />
      {board ? (
        <EventBoard
          store={store}
          scope={board}
          update={commit}
          hidden={!!network}
          onClose={() => setBoard(null)}
          onOpenProfile={contactId => { setTab('people'); setSelectedOrgId(null); setSelectedId(contactId) }}
          onOpenNetwork={(contactId, boardIds) => setNetwork({ centerId: contactId, scopeIds: boardIds, label: scopeTitle(store, board) })}
        />
      ) : null}
      {network ? (
        <NetworkView
          store={store}
          centerId={network.centerId}
          scopeIds={network.scopeIds}
          scopeLabel={network.label}
          onClose={() => setNetwork(null)}
          onOpenProfile={contactId => { setBoard(null); setTab('people'); setSelectedOrgId(null); setSelectedId(contactId) }}
        />
      ) : null}
    </Root>
  )
}

// ======================= design tokens / styles =======================

/** The platform faces: Source Serif 4 for prose, Archivo for the interface. */
const SERIF = 'var(--platform-typography-font-family-content)'
const SANS = 'var(--platform-typography-font-family)'

/**
 * Marks an element for the platform chrome stylesheet (theme/chromeCss in
 * @purescience/platform-ui): sidebars, rows, section labels, meta, fields,
 * toolbars and list rows get their measures, faces and theme colours from
 * the --pure-chrome-* tokens, so nothing here restates a width or a grey.
 * Typed loosely on purpose: styled-components' attrs rejects data-* literals.
 */
const chrome = (
  kind: string,
  extra: Record<string, string> = {},
): Record<string, string> => ({ 'data-chrome': kind, ...extra })

/**
 * PurePeople's palette as roles over the platform chrome tokens, so the
 * app is the same room as every other app and follows the suite theme
 * without a palette of its own. Only the link hue (plum) and the warning
 * hue stay app-local, relit for dark; the shell bridge stamps
 * data-platform-theme on <html> in every app frame.
 */
const PeopleTokens = createGlobalStyle`
  :root {
    --pp-paper: var(--pure-chrome-sidebar);
    --pp-paper-raised: var(--pure-chrome-surface);
    --pp-hover: var(--pure-chrome-hover);
    --pp-wash: var(--pure-chrome-well);
    --pp-wash-deep: var(--pure-chrome-line);
    --pp-wash-strong: var(--pure-chrome-line);
    --pp-chip: var(--pure-chrome-well);
    --pp-chip-text: var(--pure-chrome-soft);
    --pp-card: color-mix(in srgb, var(--pure-chrome-paper) 92%, transparent);
    --pp-panel: var(--glass-panel);
    --pp-panel-strong: var(--glass-panel-strong);
    --pp-popover: var(--glass-popover);
    --pp-glass-edge: var(--glass-edge);
    --pp-glass-edge-strong: var(--glass-edge-strong);
    --pp-glass-line: var(--glass-line);
    --pp-glass-blur: var(--glass-blur);
    --pp-glass-shadow: var(--glass-shadow);
    --pp-green-wash: var(--pure-chrome-selection);
    --pp-green-wash-deep: var(--pure-chrome-hover);
    --pp-line: var(--pure-chrome-line);
    --pp-line-soft: var(--pure-chrome-line);
    --pp-line-strong: var(--platform-colors-border-strong);
    --pp-faint: var(--platform-colors-text-disabled);
    --pp-muted-2: var(--pure-chrome-muted);
    --pp-icon: var(--pure-chrome-muted);
    --pp-muted: var(--pure-chrome-muted);
    --pp-text-soft: var(--pure-chrome-soft);
    --pp-text-strong: var(--platform-colors-text-secondary);
    --pp-text-notes: var(--platform-colors-text);
    --pp-ink: var(--platform-colors-text);
    --pp-ink-deep: var(--platform-colors-text);
    --pp-accent: var(--pure-chrome-accent);
    --pp-accent-text: var(--pure-chrome-accent);
    --pp-accent-solid: var(--pure-chrome-accent);
    --pp-accent-solid-hover: color-mix(
      in srgb,
      var(--pure-chrome-accent) 85%,
      var(--platform-colors-text)
    );
    --pp-on-solid: var(--pure-chrome-on-accent);
    --pp-plum: #8d4b63;
    --pp-plum-deep: #6d374a;
    --pp-warn: #c08a3e;
    --pp-shadow: rgba(40, 34, 30, 0.3);
    --pp-shadow-deep: rgba(0, 0, 0, 0.4);
    --pp-scrim: rgba(30, 28, 26, 0.55);
    color-scheme: light;
  }

  :root[data-platform-theme='dark'] {
    --pp-card: color-mix(in srgb, var(--pure-chrome-paper) 88%, transparent);
    --pp-plum: #c687a0;
    --pp-plum-deep: #d6a4b8;
    --pp-warn: #b98936;
    --pp-shadow: rgba(0, 0, 0, 0.45);
    --pp-shadow-deep: rgba(0, 0, 0, 0.6);
    --pp-scrim: rgba(8, 8, 10, 0.62);
    color-scheme: dark;
  }
`

const Root = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  gap: 12px;
  padding: 10px 12px 12px;
  overflow: hidden;
  background: transparent;
  color: var(--pp-ink);
  font-family: ${SANS};
  -webkit-font-smoothing: antialiased;

  a {
    color: var(--pp-plum);
    text-decoration: none;
  }
  a:hover {
    color: var(--pp-plum-deep);
    text-decoration: underline;
  }
  input::placeholder {
    color: var(--pp-muted-2);
  }
`

/** The people/orgs column: the platform sidebar. */
const Rail = styled.div.attrs(chrome('sidebar'))`
  && {
    flex-basis: clamp(320px, 24vw, 380px);
    width: clamp(320px, 24vw, 380px);
    overflow: hidden;
    background: var(--pp-panel-strong);
    border: 1px solid var(--pp-glass-edge);
    border-radius: 18px;
    box-shadow: var(--pp-glass-shadow);
  }

  @media (max-width: 960px) {
    && {
      flex-basis: var(--pure-chrome-sidebar-width);
      width: var(--pure-chrome-sidebar-width);
    }
  }
`

const RailTabs = styled.div`
  padding: 14px var(--pure-chrome-inset) 0;
  display: flex;
  gap: 18px;
  align-items: baseline;
  border-bottom: 1px solid var(--pure-chrome-line);
`

const RailTab = styled.div<{ $active: boolean }>`
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding-bottom: 9px;
  border-bottom: 2px solid
    ${({ $active }) => ($active ? 'var(--pp-accent)' : 'transparent')};
  cursor: pointer;
  transition: border-color 120ms ease;

  span:first-child {
    font-size: var(--pure-chrome-ui-size);
    font-weight: 600;
    color: ${({ $active }) => ($active ? 'var(--pp-ink-deep)' : 'var(--pp-icon)')};
  }

  &:hover {
    border-color: ${({ $active }) => ($active ? 'var(--pp-accent)' : 'var(--pp-line)')};
  }
`

const TabCount = styled.span.attrs(chrome('meta'))<{ $active: boolean }>`
  font-variant-numeric: tabular-nums;
`

const TabSpacer = styled.div`
  flex: 1;
`

const NewLink = styled.span`
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-accent);
  cursor: pointer;
  padding-bottom: 9px;

  &:hover {
    color: var(--pp-accent-text);
  }
`

const RailHead = styled.div`
  padding: 12px var(--pure-chrome-inset) 10px;
  display: flex;
  flex-direction: column;
  gap: 11px;
`

const SearchInput = styled.input.attrs(chrome('field'))`
  outline: none;
`

const SortRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const SortLabel = styled.span`
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-muted);
`

const SortChipWrap = styled.div`
  position: relative;
`

const SortChip = styled.div.attrs(chrome('toolbar-select'))`
  cursor: pointer;

  &:hover {
    background: var(--pure-chrome-hover);
  }
`

const SortMenu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 10;
  min-width: 140px;
  background: var(--pp-popover);
  border: 1px solid var(--pp-glass-edge-strong);
  border-radius: 10px;
  box-shadow: 0 8px 24px -12px var(--pp-shadow);
  backdrop-filter: var(--pp-glass-blur);
  -webkit-backdrop-filter: var(--pp-glass-blur);
  padding: 4px;
`

const SortMenuItem = styled.div<{ $active: boolean }>`
  padding: 5px 8px;
  font-size: var(--pure-chrome-ui-size);
  color: ${({ $active }) => ($active ? 'var(--pp-ink-deep)' : 'var(--pp-text-strong)')};
  font-weight: ${({ $active }) => ($active ? 600 : 400)};
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: var(--pp-paper);
  }
`

const QuietLink = styled.span`
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-muted);
  cursor: pointer;

  &:hover {
    color: var(--pp-accent);
  }
`

const RailList = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
`

/** One person or org in the rail: a platform list row, two lines tall. */
const RailRow = styled.div.attrs(chrome('list-row'))<{ $active?: boolean }>`
  cursor: pointer;
  transition: background 120ms ease;

  && {
    align-items: baseline;
    gap: 10px;
    padding: 7px var(--pure-chrome-inset);
    background: ${({ $active }) =>
      $active ? 'var(--pure-chrome-selection)' : 'transparent'};
  }

  &&:hover {
    background: var(--pure-chrome-hover);
  }
`

const RailRowText = styled.div`
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
`

const RailRowName = styled.div<{ $active?: boolean; $stale?: boolean }>`
  font-size: var(--pure-chrome-ui-size);
  font-weight: ${({ $active }) => ($active ? 500 : 400)};
  color: ${({ $stale }) => ($stale ? 'var(--pp-text-soft)' : 'var(--pp-ink)')};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const RailRowSub = styled.div<{ $stale?: boolean }>`
  font-size: var(--pure-chrome-ui-size);
  color: ${({ $stale }) => ($stale ? 'var(--pp-muted-2)' : 'var(--pp-muted)')};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const RailRowSeen = styled.div.attrs(chrome('meta'))<{ $stale?: boolean; $fixed?: boolean }>`
  flex: none;
  font-variant-numeric: tabular-nums;
  ${({ $stale }) => ($stale ? '&& { color: var(--pp-faint); }' : '')}
  ${({ $fixed }) => ($fixed ? 'width: 26px; text-align: right;' : '')}
`

const CountBadge = styled.span.attrs(chrome('meta'))`
  flex: none;
  background: var(--pp-wash);
  border-radius: 3px;
  padding: 1px 5px;
  font-variant-numeric: tabular-nums;
`

const TypeBadge = styled.span.attrs(chrome('meta'))`
  flex: none;
  background: var(--pp-wash);
  border-radius: 4px;
  padding: 1px 6px;
`

/** A section heading in the rail: the platform section label. */
const StaleHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 16px var(--pure-chrome-inset) 8px;

  span {
    font-family: var(--platform-typography-font-family-mono);
    font-size: var(--pure-chrome-label-size);
    font-weight: 500;
    letter-spacing: var(--pure-chrome-label-tracking);
    text-transform: uppercase;
    color: var(--pure-chrome-muted);
    white-space: nowrap;
  }
`

const Rule = styled.div`
  flex: 1;
  height: 1px;
  background: var(--pp-wash-deep);
`

const ImportPanel = styled.div`
  margin: 0 var(--pure-chrome-inset) 8px;
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--pure-chrome-ui-size);
  line-height: 1.5;
  color: var(--pp-text-strong);
  background: var(--pp-paper-raised);
  border: 1px solid var(--pp-wash-strong);
  border-radius: 6px;
`

const ImportActions = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
`

const ImportButton = styled.button`
  font-family: inherit;
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-on-solid);
  background: var(--pp-accent-solid);
  border: none;
  border-radius: 5px;
  padding: 4px 10px;
  cursor: pointer;

  &:hover {
    background: var(--pp-accent-solid-hover);
  }
`

const Detail = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--pp-panel);
  border: 1px solid var(--pp-glass-edge);
  border-radius: 18px;
  box-shadow: var(--pp-glass-shadow);
`

const DetailScroll = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 40px 48px 24px;
`

const Measure = styled.div<{ $wide?: boolean }>`
  max-width: ${({ $wide }) => ($wide ? '620px' : '600px')};
  display: flex;
  flex-direction: column;
  gap: 26px;
`

const BackLink = styled.span`
  align-self: flex-start;
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-muted);
  cursor: pointer;

  &:hover {
    color: var(--pp-accent);
  }
`

const HeaderBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const HeaderTop = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 15px;
`

const AvatarFallback = styled.div<{ $square?: boolean }>`
  width: 62px;
  height: 62px;
  flex: none;
  border-radius: ${({ $square }) => ($square ? '12px' : '50%')};
  background: var(--pp-green-wash);
  color: var(--pp-accent);
  font-family: ${SERIF};
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 120ms ease;

  &:hover {
    background: var(--pp-green-wash-deep);
  }
`

const AvatarImg = styled.img<{ $square?: boolean }>`
  width: 62px;
  height: 62px;
  flex: none;
  border-radius: ${({ $square }) => ($square ? '12px' : '50%')};
  object-fit: cover;
  cursor: pointer;
`

const HeaderNameCol = styled.div`
  padding-bottom: 3px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
`

const SubLine = styled.div`
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex-wrap: wrap;
  font-size: 13.5px;
  color: var(--pp-text-soft);
`

const Dot = styled.span`
  color: var(--pp-muted-2);
`

const HeaderAction = styled.span`
  align-self: flex-end;
  flex: none;
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-accent);
  cursor: pointer;
  padding-bottom: 6px;

  &:hover {
    color: var(--pp-accent-text);
  }
`

const InlineText = styled.div<{
  $serif?: boolean
  $size?: number
  $color?: string
  $empty?: boolean
}>`
  display: inline-block;
  font-family: ${({ $serif }) => ($serif ? SERIF : 'inherit')};
  font-size: ${({ $size }) => $size ?? 15}px;
  line-height: ${({ $serif }) => ($serif ? 1.1 : 'inherit')};
  color: ${({ $empty, $color }) =>
    $empty ? 'var(--pp-faint)' : $color ?? 'var(--pp-ink)'};
  border-bottom: 1px solid transparent;
  cursor: text;
  transition: border-color 120ms ease;
  overflow-wrap: anywhere;

  &:hover {
    border-color: var(--pp-line-strong);
  }
`

const InlineInput = styled.input<{ $serif?: boolean; $size?: number }>`
  font-family: ${({ $serif }) => ($serif ? SERIF : 'inherit')};
  font-size: ${({ $size }) => $size ?? 15}px;
  color: var(--pp-ink-deep);
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--pp-line-strong);
  outline: none;
  padding: 0;
  min-width: 80px;
  max-width: 420px;
`

const ChipRow = styled.div`
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  align-items: center;
`

const TagChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-accent);
  background: var(--pp-green-wash);
  border-radius: 999px;
  padding: 3px 9px;
`

const TopicChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-text-strong);
  background: var(--pp-paper);
  border-radius: 4px;
  padding: 2px 7px;
`

const ChipX = styled.span`
  cursor: pointer;
  color: var(--pp-muted);
  opacity: 0;
  transition: opacity 120ms ease;

  ${TagChip}:hover &,
  ${TopicChip}:hover & {
    opacity: 1;
  }

  &:hover {
    color: var(--pp-plum);
  }
`

const ListBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 10px var(--pure-chrome-inset) 0;
`

const ListChip = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  max-width: 100%;
  padding: 3px 9px;
  border: 1px solid ${({ $active }) => ($active ? 'var(--pp-accent)' : 'var(--pp-line)')};
  border-radius: 999px;
  background: ${({ $active }) => ($active ? 'var(--pp-green-wash)' : 'transparent')};
  color: ${({ $active }) => ($active ? 'var(--pp-accent-text)' : 'var(--pp-text-strong)')};
  font: inherit;
  font-size: var(--pure-chrome-ui-size);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    border-color: var(--pp-accent);
  }
`

const ListCount = styled.span.attrs(chrome('meta'))`
  font-variant-numeric: tabular-nums;
`

const ListToolRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px var(--pure-chrome-inset) 0;
`

const ListHint = styled.span.attrs(chrome('meta'))``

const AddChip = styled.span`
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-muted);
  border: 1px dashed var(--pp-line);
  border-radius: 999px;
  padding: 3px 9px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;

  &:hover {
    color: var(--pp-accent);
    border-color: var(--pp-accent);
  }
`

const ChipInput = styled.input`
  font-family: inherit;
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-ink);
  background: var(--pp-card);
  border: 1px solid var(--pp-line-strong);
  border-radius: 5px;
  padding: 3px 7px;
  outline: none;
`

const Rows = styled.div`
  display: flex;
  flex-direction: column;
`

const FieldRow = styled.div<{ $label: number }>`
  display: grid;
  grid-template-columns: ${({ $label }) => $label}px 1fr;
  gap: 12px;
  padding: 11px 10px;
  margin: 0 -10px;
  border-top: 1px solid var(--pp-wash-deep);
  border-radius: 6px;
  transition: background 120ms ease;

  &:last-child {
    border-bottom: 1px solid var(--pp-wash-deep);
  }

  &:hover {
    background: var(--pp-paper-raised);
  }
`

const FieldLabel = styled.div`
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-muted);
  padding-top: 3px;
`

const Column = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
`

const ColumnOrRow = styled.div<{ $inline?: boolean }>`
  display: flex;
  flex-direction: ${({ $inline }) => ($inline ? 'row' : 'column')};
  gap: ${({ $inline }) => ($inline ? '10px' : '3px')};
  align-items: ${({ $inline }) => ($inline ? 'baseline' : 'stretch')};
  flex-wrap: wrap;
  min-width: 0;
`

const ValueLine = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
`

const ValueLink = styled.span<{ $size?: number }>`
  font-size: ${({ $size }) => $size ?? 15}px;
  color: var(--pp-plum);
  cursor: pointer;

  &:hover {
    color: var(--pp-plum-deep);
    text-decoration: underline;
  }
`

const OwnerMark = styled.span.attrs(chrome('meta'))``

const PrimaryMark = styled.span.attrs(chrome('meta'))``

const LinkLine = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;

  a {
    font-size: 14.5px;
  }
`

const LinkLabel = styled.span`
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-muted);
  min-width: 88px;
  flex: none;
`

const LineX = styled.span`
  cursor: pointer;
  color: var(--pp-faint);
  font-size: 13px;
  opacity: 0;
  transition: opacity 120ms ease;

  ${LinkLine}:hover & {
    opacity: 1;
  }

  &:hover {
    color: var(--pp-plum);
  }
`

const AddLine = styled.span`
  font-size: 13.5px;
  color: var(--pp-faint);
  cursor: pointer;
  padding-top: 2px;

  &:hover {
    color: var(--pp-accent);
  }
`

const LinkAddPair = styled.div`
  display: flex;
  gap: 6px;
  align-items: center;
`

const DomainText = styled.span`
  font-size: 14.5px;
  color: var(--pp-ink);
`

const DomainMeta = styled.span.attrs(chrome('meta'))``

const ReviewLine = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  padding-top: 2px;
`

const ReviewLink = styled.span`
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-accent);
  cursor: pointer;

  &:hover {
    color: var(--pp-accent-text);
  }
`

const WarnBadge = styled.span.attrs(chrome('meta'))`
  background: var(--pp-warn);
  border-radius: 999px;
  padding: 1px 6px;
  font-variant-numeric: tabular-nums;

  && {
    color: var(--pp-on-solid);
  }
`

const PersonNavRow = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 4px 6px;
  margin: 0 -6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease;

  &:hover {
    background: var(--pp-wash);
  }
`

const MiniAvatar = styled.div`
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 50%;
  background: var(--pp-chip);
  color: var(--pp-chip-text);
  font-size: 10.5px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
`

const PersonNavName = styled.span`
  font-size: 14.5px;
  color: var(--pp-ink);
`

const PersonNavRole = styled.span`
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-muted);
`

const NavChevron = styled.span`
  color: var(--pp-muted-2);
  font-size: 14px;
`

const PhotoMenu = styled.div`
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  background: var(--pp-popover);
  border: 1px solid var(--pp-glass-edge-strong);
  border-radius: 10px;
  box-shadow: 0 8px 24px -12px var(--pp-shadow);
  backdrop-filter: var(--pp-glass-blur);
  -webkit-backdrop-filter: var(--pp-glass-blur);
  padding: 4px;
  z-index: 10;
`

const PhotoMenuItem = styled.div`
  padding: 5px 10px;
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-text-strong);
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background: var(--pp-paper);
  }
`

const NotesSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 9px;

  .notes-tools {
    opacity: 0;
    transition: opacity 120ms ease;
  }

  &:hover .notes-tools,
  &:focus-within .notes-tools {
    opacity: 0.55;
  }
`

const NotesHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

const NotesTools = styled.div`
  display: flex;
  gap: 2px;
`

const NotesTool = styled.span`
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-text-soft);
  width: 20px;
  text-align: center;
  cursor: pointer;
`

/** The notes editor: prose that is written, on the platform reading measure. */
const NotesBody = styled.div.attrs(chrome('reading'))`
  text-wrap: pretty;
  min-height: 120px;
  outline: none;
  cursor: text;

  &:empty::before {
    content: attr(data-placeholder);
    color: var(--pp-faint);
  }

  p {
    margin: 0 0 0.5em;
  }
`

const Footer = styled.div`
  flex: none;
  border-top: 1px solid var(--pp-wash-deep);
  padding: 13px 48px;
  display: flex;
  align-items: center;
  gap: 16px;
`

const FooterMeta = styled.div.attrs(chrome('meta'))``

const SourceChips = styled.div`
  display: flex;
  gap: 5px;
`

const SourceChip = styled.span.attrs(chrome('meta'))`
  background: var(--pp-wash);
  border-radius: 4px;
  padding: 2px 6px;
`

const DeleteLink = styled.span<{ $armed: boolean }>`
  font-size: var(--pure-chrome-ui-size);
  color: ${({ $armed }) => ($armed ? 'var(--pp-plum)' : 'var(--pp-muted)')};
  cursor: pointer;

  &:hover {
    color: var(--pp-plum);
  }
`

const EmptyNote = styled.p`
  margin: 8px var(--pure-chrome-inset);
  font-size: 13px;
  color: var(--pp-muted);
  line-height: 1.5;
`

const QuietAlert = styled.p`
  margin: 0;
  font-size: var(--pure-chrome-ui-size);
  color: var(--pp-text-soft);
`

const HiddenFileInput = styled.input`
  display: none;
`

const Lightbox = styled.div`
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  background: var(--pp-scrim);
  cursor: zoom-out;
`

const LightboxImg = styled.img`
  max-width: min(88vw, 720px);
  max-height: 82vh;
  border-radius: 10px;
  box-shadow: 0 18px 60px var(--pp-shadow-deep);
`
