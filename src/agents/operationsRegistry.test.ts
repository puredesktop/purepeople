import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { emptyPeopleStore, mergeFeedEntry, upsertContact } from '../lib/contactsModel'
import { saveCustomer } from '../lib/customers'
import { setPrep } from '../lib/eventBoard'
import { upsertOrg } from '../lib/orgsModel'
import { addToList } from '../lib/peopleLists'
import type { PeopleStore } from '../types'
import { PUREPEOPLE_ATOMIC_TOOL_SCHEMAS } from './atomicToolSchemas'
import {
  EXPOSED_TOOL_NAMES,
  PUREPEOPLE_AGENT_TOOL_NAMES,
  PUREPEOPLE_ALL_ATOMIC_TOOL_NAMES,
  PUREPEOPLE_CORE_TOOL_NAMES,
  PUREPEOPLE_EXTENDED_TOOL_NAMES,
  PUREPEOPLE_FUNCTION_NAMES,
  PUREPEOPLE_META_TOOL_NAMES,
} from './catalog'
import { AgentPeopleToolError, type PeopleAgentToolContext } from './handlers'
import {
  PUREPEOPLE_OPERATIONS_REGISTRY,
  buildPurePeopleHandlers,
} from './operationsRegistry'

const NOW = '2026-10-15T10:00:00.000Z'

const invoke = (shortName: string, args: Record<string, unknown> = {}) => ({
  toolCallId: `tc_${shortName}`,
  shortName,
  arguments: args,
})

const RELEASE_VERBS = new Set([
  'send',
  'sends',
  'sending',
  'merge',
  'merges',
  'merging',
  'publish',
  'publishes',
  'publishing',
  'deposit',
  'deposits',
  'depositing',
  'deploy',
  'deploys',
  'deploying',
  'post',
  'posts',
  'posting',
])

const NOT_RELEASES = new Set(['mergeContacts'])

function makeContext(initial: PeopleStore): {
  ctx: PeopleAgentToolContext
  getStore: () => PeopleStore
  getSetStoreCalls: () => number
} {
  let current = initial
  let setStoreCalls = 0
  const ctx: PeopleAgentToolContext = {
    get store() {
      return current
    },
    async setStore(updater) {
      setStoreCalls++
      current = updater(current)
      return current
    },
  }
  return {
    ctx,
    getStore: () => current,
    getSetStoreCalls: () => setStoreCalls,
  }
}

function makeRichStore(): PeopleStore {
  let store = emptyPeopleStore(NOW)
  // Contacts with varying acquaintance levels, duplicate signals, and unlinked domains
  store = mergeFeedEntry(store, {
    id: 'f1',
    sourceApp: 'calendar',
    seenAt: '2026-10-10T10:00:00.000Z',
    context: 'Quarterly partnership sync',
    contact: {
      email: 'mira@press.example',
      name: 'Mira Patel',
      org: 'Example Press',
      title: 'Editorial Director',
    },
  })
  store = upsertContact(
    store,
    {
      email: 'mira@press.example',
      phones: ['+1 415-555-0199'],
      topics: ['open-science', 'workflows'],
      tags: ['editorial'],
      links: [{ label: 'LinkedIn', url: 'https://linkedin.com/in/mirapatel' }],
    },
    'user',
    '2026-10-10T11:00:00.000Z',
  ).store

  store = mergeFeedEntry(store, {
    id: 'f2',
    sourceApp: 'mail',
    seenAt: '2026-10-12T09:00:00.000Z',
    context: 'Re: Frankfurt booth',
    contact: {
      email: 'priya@press.example',
      name: 'Priya Singh',
      // Deliberately blank org so domain match is flagged as unlinked!
    },
  })

  // Probable duplicate of Mira Patel (same phone + same LinkedIn + same domain/name)
  store = upsertContact(
    store,
    {
      email: 'm.patel@press.example',
      name: 'Mira Patel',
      phones: ['(415) 555-0199'],
    },
    'user',
    '2026-01-01T09:00:00.000Z',
  ).store

  // New person on event board (never met/emailed, connected to Priya via encounter)
  store = upsertContact(
    store,
    {
      email: 'jonas@books.example',
      name: 'Jonas Weber',
      org: 'Indie Books Guild',
      title: 'Publisher',
      topics: ['open-science'],
    },
    'user',
    '2026-10-01T09:00:00.000Z',
  ).store

  // Stale contact with unmodeled org
  store = upsertContact(
    store,
    {
      email: 'elena@books.example',
      name: 'Elena Costa',
      org: 'Indie Books Guild',
    },
    'user',
    '2025-01-01T09:00:00.000Z',
  ).store

  // Organisation with domain
  store = upsertOrg(
    store,
    {
      name: 'Example Press',
      industry: 'Publishing',
      owner: 'Alex',
      domains: ['press.example'],
      aliases: ['EP'],
    },
    'user',
    NOW,
  ).store

  // Lists
  store = addToList(store, 'Frankfurt Book Fair 2026', [
    'mira@press.example',
    'priya@press.example',
    'jonas@books.example',
  ])
  store = addToList(store, 'VIP Partners', ['mira@press.example'])

  // Event prep on Frankfurt board
  const frankfurtId = store.lists!.find(l => l.name === 'Frankfurt Book Fair 2026')!.id
  store = setPrep(store, 'jonas@books.example', frankfurtId, {
    meet: true,
    note: 'Ask about Q1 pilot',
  }, NOW)

  // Customer profiles across due buckets (relative to 2026-10-15)
  store = saveCustomer(
    store,
    'mira@press.example',
    {
      status: 'Customer',
      notes: 'Annual renewal active',
      nextAction: 'Send renewal summary',
      dueDate: '2026-10-10', // Overdue
    },
    'create',
    NOW,
  )
  store = saveCustomer(
    store,
    'priya@press.example',
    {
      status: 'Lead',
      nextAction: 'Confirm booth pass',
      dueDate: '2026-10-15', // Due today
    },
    'create',
    NOW,
  )
  store = saveCustomer(
    store,
    'jonas@books.example',
    {
      status: 'Lead',
      nextAction: 'Follow up after fair', // No due date
    },
    'create',
    NOW,
  )

  // Shared encounters: Mira <-> Priya <-> Jonas
  store = {
    ...store,
    encounters: [
      {
        id: 'enc-1',
        kind: 'meeting',
        sourceApp: 'calendar',
        subject: 'Editorial roadmap',
        at: '2026-10-10T10:00:00.000Z',
        emails: ['mira@press.example', 'priya@press.example'],
      },
      {
        id: 'enc-2',
        kind: 'thread',
        sourceApp: 'mail',
        subject: 'Re: Frankfurt panel',
        at: '2026-10-12T09:00:00.000Z',
        emails: ['priya@press.example', 'jonas@books.example'],
      },
    ],
  }

  return store
}

describe('PurePeople Operations Registry invariants', () => {
  it('exposes the exact 3-tier layout and syncs 1:1 with plugin.json and catalog.ts', () => {
    const manifest = JSON.parse(readFileSync('plugin.json', 'utf8')) as {
      app: {
        agents: {
          tools: Array<{
            name: string
            description: string
            risk: string
            requiresApproval: boolean
            inputSchema: Record<string, unknown>
          }>
        }
      }
    }

    const summary = PUREPEOPLE_OPERATIONS_REGISTRY.auditSummary()
    expect(summary).toEqual({
      appSlug: 'people',
      functions: 5,
      coreTools: 4,
      extendedTools: 17,
      metaTools: 3,
      totalExposed: 12,
      totalAtomicTools: 21,
      totalRegistered: 26,
      schemaReductionPercent: 43,
    })

    expect(PUREPEOPLE_OPERATIONS_REGISTRY.exposedToolNames).toEqual([
      ...EXPOSED_TOOL_NAMES,
    ])
    expect([...PUREPEOPLE_AGENT_TOOL_NAMES]).toEqual([...EXPOSED_TOOL_NAMES])
    expect(
      PUREPEOPLE_OPERATIONS_REGISTRY.functions.map(f => f.name),
    ).toEqual([...PUREPEOPLE_FUNCTION_NAMES])
    expect(
      PUREPEOPLE_OPERATIONS_REGISTRY.coreTools.map(t => t.name),
    ).toEqual([...PUREPEOPLE_CORE_TOOL_NAMES])
    expect(PUREPEOPLE_OPERATIONS_REGISTRY.extendedToolNames).toEqual([
      ...PUREPEOPLE_EXTENDED_TOOL_NAMES,
    ])
    expect([...PUREPEOPLE_ALL_ATOMIC_TOOL_NAMES].sort()).toEqual(
      PUREPEOPLE_ATOMIC_TOOL_SCHEMAS.map(t => t.name).sort(),
    )
    expect(manifest.app.agents.tools).toEqual(
      PUREPEOPLE_OPERATIONS_REGISTRY.manifestTools,
    )
    expect(PUREPEOPLE_META_TOOL_NAMES).toEqual([
      'discoverAppTools',
      'callExtendedReadTool',
      'callExtendedTool',
    ])
  })

  it('satisfies manifest rules: descriptions >= 80 chars, explicit booleans, no disallowed release verbs', () => {
    for (const tool of PUREPEOPLE_OPERATIONS_REGISTRY.manifestTools) {
      const normalized = tool.description.trim().replace(/\s+/g, ' ')
      expect(
        normalized.length,
        `${tool.name} description too short (${normalized.length})`,
      ).toBeGreaterThanOrEqual(80)
      expect(typeof tool.requiresApproval).toBe('boolean')

      const nameFirst =
        tool.name
          .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
          .split(/[^A-Za-z]+/)
          .find(Boolean)
          ?.toLowerCase() ?? ''
      const descFirst =
        normalized
          .split(/[^A-Za-z]+/)
          .find(Boolean)
          ?.toLowerCase() ?? ''
      if (tool.risk !== 'release' && !NOT_RELEASES.has(tool.name)) {
        expect(
          RELEASE_VERBS.has(nameFirst),
          `${tool.name} starts with release verb`,
        ).toBe(false)
        expect(
          RELEASE_VERBS.has(descFirst),
          `${tool.name} description starts with release verb`,
        ).toBe(false)
      }
    }

    // All fn_* names and descriptions must never start with a release verb
    for (const fn of PUREPEOPLE_OPERATIONS_REGISTRY.functions) {
      expect(fn.name.startsWith('fn_')).toBe(true)
      const afterPrefix = fn.name
        .slice(3)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/[^A-Za-z]+/)
        .find(Boolean)
        ?.toLowerCase() ?? ''
      expect(RELEASE_VERBS.has(afterPrefix)).toBe(false)
    }

    // All 21 atomic schemas also maintain >= 80 char descriptions
    for (const atomic of PUREPEOPLE_ATOMIC_TOOL_SCHEMAS) {
      const normalized = atomic.description.trim().replace(/\s+/g, ' ')
      expect(
        normalized.length,
        `atomic ${atomic.name} description too short (${normalized.length})`,
      ).toBeGreaterThanOrEqual(80)
      expect(typeof atomic.requiresApproval).toBe('boolean')
    }
  })

  it('builds one handler per exposed tool and none for extended tools directly', () => {
    const { ctx } = makeContext(emptyPeopleStore(NOW))
    const handlers = buildPurePeopleHandlers(() => ctx)
    expect(Object.keys(handlers).sort()).toEqual([...EXPOSED_TOOL_NAMES].sort())
    for (const ext of PUREPEOPLE_EXTENDED_TOOL_NAMES) {
      expect(handlers[ext]).toBeUndefined()
    }
  })
})

describe('Universal escape-hatch meta-tools', () => {
  it('discoverAppTools searches extended tools by query, category, exact names, and includeFunctions', async () => {
    const { ctx } = makeContext(makeRichStore())
    const handlers = buildPurePeopleHandlers(() => ctx)

    const byQuery = JSON.parse(
      (
        await handlers.discoverAppTools!(
          invoke('discoverAppTools', { query: 'photo portrait' }),
        )
      ).content,
    )
    expect(byQuery.appSlug).toBe('people')
    expect(
      byQuery.operations.some(
        (o: { name: string }) => o.name === 'prepareProfilePhotoResearch',
      ),
    ).toBe(true)

    const byCategory = JSON.parse(
      (
        await handlers.discoverAppTools!(
          invoke('discoverAppTools', { category: 'customers' }),
        )
      ).content,
    )
    expect(
      byCategory.operations.map((o: { name: string }) => o.name).sort(),
    ).toEqual(['createCustomer', 'listCustomers', 'updateCustomer'])

    const byNames = JSON.parse(
      (
        await handlers.discoverAppTools!(
          invoke('discoverAppTools', {
            names: ['deleteList', 'listOrgs', 'notARealTool'],
          }),
        )
      ).content,
    )
    expect(byNames.mode).toBe('describe')
    expect(byNames.operations[0]).toMatchObject({
      name: 'deleteList',
      found: true,
      exposure: 'extended',
      invokeVia: 'callExtendedTool',
      requiresConfirmDestructive: true,
    })
    expect(byNames.operations[1]).toMatchObject({
      name: 'listOrgs',
      found: true,
      exposure: 'extended',
      invokeVia: 'callExtendedReadTool',
    })
    expect(byNames.operations[2]).toMatchObject({
      name: 'notARealTool',
      found: false,
    })

    const withFunctions = JSON.parse(
      (
        await handlers.discoverAppTools!(
          invoke('discoverAppTools', {
            query: 'hygiene duplicate',
            includeFunctions: true,
          }),
        )
      ).content,
    )
    expect(
      withFunctions.operations.some(
        (o: { name: string; invokeVia: string }) =>
          o.name === 'fn_duplicateAndHygieneAudit' && o.invokeVia === 'direct',
      ),
    ).toBe(true)
  })

  it('callExtendedReadTool routes read-only extended tools and refuses mutating, direct, and unknown tools', async () => {
    const { ctx } = makeContext(makeRichStore())
    const handlers = buildPurePeopleHandlers(() => ctx)

    const orgs = JSON.parse(
      (
        await handlers.callExtendedReadTool!(
          invoke('callExtendedReadTool', {
            tool: 'listOrgs',
            arguments: { query: 'Press' },
          }),
        )
      ).content,
    )
    expect(orgs.returned).toBe(1)
    expect(orgs.orgs[0]).toMatchObject({
      name: 'Example Press',
      peopleCount: 3,
    })

    const photoBrief = JSON.parse(
      (
        await handlers.callExtendedReadTool!(
          invoke('callExtendedReadTool', {
            tool: 'prepareProfilePhotoResearch',
            arguments: { contact: 'mira@press.example', mode: 'light' },
          }),
        )
      ).content,
    )
    expect(photoBrief.mode).toBe('light')
    expect(photoBrief.contact.name).toBe('Mira Patel')

    await expect(
      handlers.callExtendedReadTool!(
        invoke('callExtendedReadTool', {
          tool: 'upsertOrg',
          arguments: { name: 'NewOrg' },
        }),
      ),
    ).rejects.toThrow(/cannot run through callExtendedReadTool/)

    await expect(
      handlers.callExtendedReadTool!(
        invoke('callExtendedReadTool', { tool: 'listContacts' }),
      ),
    ).rejects.toThrow(/already directly exposed/)

    await expect(
      handlers.callExtendedReadTool!(
        invoke('callExtendedReadTool', { tool: 'nonExistentTool' }),
      ),
    ).rejects.toThrow(/Unknown extended tool/)
  })

  it('callExtendedTool routes mutating extended tools, enforces confirmDestructive, calls hooks, and refuses read/direct/unknown', async () => {
    const { ctx, getStore } = makeContext(makeRichStore())
    const beforeInvoke = vi.fn()
    const recordOperation = vi.fn()
    const handlers = buildPurePeopleHandlers(() => ctx, {
      beforeInvoke,
      recordOperation,
    })

    const created = JSON.parse(
      (
        await handlers.callExtendedTool!(
          invoke('callExtendedTool', {
            tool: 'createList',
            arguments: { name: 'Speakers 2026' },
          }),
        )
      ).content,
    )
    expect(created.created).toBe(true)
    expect(beforeInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'createList',
        opClass: 'tool',
        risk: 'write',
        viaExtended: true,
      }),
    )
    expect(recordOperation).toHaveBeenCalledWith(
      ctx,
      'extended.createList',
      expect.stringContaining('createList'),
    )

    // Destructive extended tool MUST refuse without confirmDestructive: true
    await expect(
      handlers.callExtendedTool!(
        invoke('callExtendedTool', {
          tool: 'deleteList',
          arguments: { list: 'Speakers 2026', name: 'Speakers 2026' },
        }),
      ),
    ).rejects.toThrow(/confirmDestructive: true/)

    // Destructive extended tool succeeds with confirmDestructive: true
    const deleted = JSON.parse(
      (
        await handlers.callExtendedTool!(
          invoke('callExtendedTool', {
            tool: 'deleteList',
            arguments: { list: 'Speakers 2026', name: 'Speakers 2026' },
            confirmDestructive: true,
          }),
        )
      ).content,
    )
    expect(deleted.deleted).toBe('Speakers 2026')
    expect(
      getStore().lists?.some(l => l.name === 'Speakers 2026'),
    ).toBe(false)

    // Refuses read-only extended tool
    await expect(
      handlers.callExtendedTool!(
        invoke('callExtendedTool', { tool: 'listLists' }),
      ),
    ).rejects.toThrow(/read-only/)

    // Refuses directly exposed tool
    await expect(
      handlers.callExtendedTool!(
        invoke('callExtendedTool', {
          tool: 'mergeContacts',
          arguments: { survivorId: 'a', absorbedId: 'b' },
        }),
      ),
    ).rejects.toThrow(/already directly exposed/)

    // Refuses unknown tool
    await expect(
      handlers.callExtendedTool!(
        invoke('callExtendedTool', { tool: 'unknownTool' }),
      ),
    ).rejects.toThrow(/Unknown extended tool/)
  })
})

describe('Composite App Functions (fn_*)', () => {
  it('fn_directoryBriefing summarizes directory totals, lists, customer pipeline, top orgs, and hygiene signals in 1 call', async () => {
    const { ctx } = makeContext(makeRichStore())
    const handlers = buildPurePeopleHandlers(() => ctx)

    const env = JSON.parse(
      (
        await handlers.fn_directoryBriefing!(
          invoke('fn_directoryBriefing', { today: '2026-10-15' }),
        )
      ).content,
    )
    expect(env).toMatchObject({
      ok: true,
      opClass: 'function',
      function: 'fn_directoryBriefing',
    })
    expect(env.data.totals).toMatchObject({
      contacts: 5,
      orgs: 1,
      lists: 2,
      encounters: 2,
      trackedCustomers: 3,
    })
    expect(env.data.customerPipeline.byStatus).toEqual({
      Lead: 2,
      Customer: 1,
      Inactive: 0,
    })
    expect(env.data.customerPipeline.byDue).toEqual({
      overdue: 1,
      dueToday: 1,
      upcoming: 0,
      noDueDate: 1,
    })
    expect(env.data.customerPipeline.urgentFollowUps).toHaveLength(2)
    expect(env.data.hygieneSignals.potentialDuplicateClusters).toBe(1)
    expect(env.data.hygieneSignals.unlinkedDomainMatches).toBe(2)
    expect(env.data.topOrgs[0]).toMatchObject({
      name: 'Example Press',
      peopleCount: 3,
    })

    // Scoped to a list
    const scoped = JSON.parse(
      (
        await handlers.fn_directoryBriefing!(
          invoke('fn_directoryBriefing', {
            list: 'VIP Partners',
            today: '2026-10-15',
          }),
        )
      ).content,
    )
    expect(scoped.data.totals.scopedContacts).toBe(1)
    expect(scoped.data.customerPipeline.total).toBe(1)

    // Refuses invalid date
    await expect(
      handlers.fn_directoryBriefing!(
        invoke('fn_directoryBriefing', { today: '2026-02-30' }),
      ),
    ).rejects.toThrow(AgentPeopleToolError)
  })

  it('fn_personRelationshipDossier compiles contact, org/colleagues, customer, network, event preps, and optional photo plan', async () => {
    const { ctx } = makeContext(makeRichStore())
    const handlers = buildPurePeopleHandlers(() => ctx)

    const env = JSON.parse(
      (
        await handlers.fn_personRelationshipDossier!(
          invoke('fn_personRelationshipDossier', {
            idOrEmail: 'mira@press.example',
            today: '2026-10-15',
            includePhotoPlan: 'light',
          }),
        )
      ).content,
    )
    expect(env.ok).toBe(true)
    expect(env.data.contact.name).toBe('Mira Patel')
    expect(env.data.acquaintance).toMatchObject({ level: 'met', label: 'Met' })
    expect(env.data.lists.map((l: { name: string }) => l.name)).toEqual(
      expect.arrayContaining(['Frankfurt Book Fair 2026', 'VIP Partners']),
    )
    expect(env.data.organisation).toMatchObject({
      name: 'Example Press',
      colleagueCount: 2,
    })
    expect(env.data.customer).toMatchObject({
      status: 'Customer',
      dueBucket: 'overdue',
    })
    expect(env.data.network.directCount).toBe(1)
    expect(env.data.network.secondHopCount).toBe(1)
    const jonasConn = env.data.network.connections.find(
      (c: { id: string }) => c.id === 'jonas@books.example',
    )
    expect(jonasConn).toMatchObject({
      steps: 2,
      via: 'Priya Singh',
      path: ['Mira Patel', 'Priya Singh', 'Jonas Weber'],
    })
    expect(env.data.photoResearchPlan).toMatchObject({
      mode: 'light',
      contact: { id: 'mira@press.example' },
    })

    // Ambiguous exact full name (two contacts named "Mira Patel") refuses safely
    await expect(
      handlers.fn_personRelationshipDossier!(
        invoke('fn_personRelationshipDossier', { idOrEmail: 'Mira Patel' }),
      ),
    ).rejects.toThrow(/Multiple contacts are named/)
  })

  it('fn_orgAndEventBriefing works in both org mode (with unlinked domains & bridges) and event mode (with warm intros)', async () => {
    const { ctx } = makeContext(makeRichStore())
    const handlers = buildPurePeopleHandlers(() => ctx)

    // Org mode
    const orgBrief = JSON.parse(
      (
        await handlers.fn_orgAndEventBriefing!(
          invoke('fn_orgAndEventBriefing', {
            org: 'EP', // alias match
            today: '2026-10-15',
          }),
        )
      ).content,
    )
    expect(orgBrief.data.mode).toBe('org')
    expect(orgBrief.data.organisation.name).toBe('Example Press')
    expect(orgBrief.data.peopleCount).toBe(3)
    expect(orgBrief.data.customerSummary).toMatchObject({
      tracked: 2,
      Customer: 1,
      Lead: 1,
      overdue: 1,
      dueToday: 1,
    })
    expect(orgBrief.data.unlinkedDomainMatches.map((m: { contactId: string }) => m.contactId)).toEqual(
      expect.arrayContaining(['priya@press.example', 'm.patel@press.example']),
    )
    expect(orgBrief.data.externalBridges).toEqual([
      expect.objectContaining({
        id: 'jonas@books.example',
        name: 'Jonas Weber',
        connectedToMembers: ['Priya Singh'],
      }),
    ])

    // Event mode
    const eventBrief = JSON.parse(
      (
        await handlers.fn_orgAndEventBriefing!(
          invoke('fn_orgAndEventBriefing', {
            list: 'Frankfurt Book Fair 2026',
            today: '2026-10-15',
          }),
        )
      ).content,
    )
    expect(eventBrief.data.mode).toBe('event')
    expect(eventBrief.data.count).toBe(3)
    expect(eventBrief.data.toMeet).toEqual(['Jonas Weber'])
    expect(eventBrief.data.countsByAcquaintance).toEqual({
      met: 1,
      emailed: 1,
      new: 1,
    })
    expect(eventBrief.data.warmIntroPaths).toEqual([
      expect.objectContaining({
        targetId: 'jonas@books.example',
        viaId: 'priya@press.example',
        viaName: 'Priya Singh',
        viaOnBoard: true,
      }),
    ])

    // Refuses 0 or >1 scope args
    await expect(
      handlers.fn_orgAndEventBriefing!(invoke('fn_orgAndEventBriefing', {})),
    ).rejects.toThrow(/Supply exactly one/)
    await expect(
      handlers.fn_orgAndEventBriefing!(
        invoke('fn_orgAndEventBriefing', { org: 'EP', list: 'VIP Partners' }),
      ),
    ).rejects.toThrow(/Supply exactly one/)
  })

  it('fn_duplicateAndHygieneAudit detects duplicate clusters, unlinked org domains, unmodeled orgs, and customer follow-up hygiene', async () => {
    const { ctx, getSetStoreCalls } = makeContext(makeRichStore())
    const handlers = buildPurePeopleHandlers(() => ctx)

    const env = JSON.parse(
      (
        await handlers.fn_duplicateAndHygieneAudit!(
          invoke('fn_duplicateAndHygieneAudit', { today: '2026-10-15' }),
        )
      ).content,
    )
    expect(env.ok).toBe(true)
    expect(getSetStoreCalls()).toBe(0)
    expect(env.data.counts.duplicateClusters).toBe(1)
    expect(env.data.duplicateClusters[0]).toMatchObject({
      suggestedSurvivorId: 'mira@press.example',
      candidateAbsorbedIds: ['m.patel@press.example'],
    })
    expect(env.data.duplicateClusters[0].reasons).toEqual(
      expect.arrayContaining(['same-normalized-name', 'shared-phone']),
    )
    expect(env.data.unmodeledOrgs).toEqual([
      { label: 'Indie Books Guild', count: 2 },
    ])
    expect(env.data.customerHygiene.overdue).toHaveLength(1)
    expect(env.data.customerHygiene.dueToday).toHaveLength(1)
    expect(env.data.customerHygiene.actionWithoutDueDate).toEqual([
      expect.objectContaining({
        id: 'jonas@books.example',
        nextAction: 'Follow up after fair',
      }),
    ])

    // Uncapped counts are preserved even when maxItems truncates customer hygiene sections
    const extraOverdueStore = saveCustomer(
      makeRichStore(),
      'elena@books.example',
      { status: 'Lead', dueDate: '2026-10-01', nextAction: 'Ping Elena' },
      'create',
      NOW,
    )
    const cappedHarness = makeContext(extraOverdueStore)
    const cappedHandlers = buildPurePeopleHandlers(() => cappedHarness.ctx)
    const capped = JSON.parse(
      (
        await cappedHandlers.fn_duplicateAndHygieneAudit!(
          invoke('fn_duplicateAndHygieneAudit', {
            today: '2026-10-15',
            maxItems: 1,
          }),
        )
      ).content,
    )
    expect(capped.data.counts.overdueCustomers).toBe(2)
    expect(capped.data.customerHygiene.overdue).toHaveLength(1)
  })

  it('fn_batchCurateDirectory supports dryRun, commits atomically in 1 setStore call, and aborts cleanly on validation error', async () => {
    const harness = makeContext(makeRichStore())
    const recordOperation = vi.fn()
    const handlers = buildPurePeopleHandlers(() => harness.ctx, {
      recordOperation,
    })

    const payload = {
      orgs: [
        {
          name: 'Indie Books Guild',
          industry: 'Publishing',
          domains: ['books.example'],
        },
      ],
      contacts: [
        {
          email: 'sam@books.example',
          name: 'Sam Lee',
          org: 'Indie Books Guild',
          title: 'Operations Lead',
          lists: ['Frankfurt Book Fair 2026'],
        },
        {
          email: 'priya@press.example',
          org: 'Example Press',
          title: 'Events Manager',
        },
      ],
      listAdditions: [
        {
          list: 'Q4 Outreach',
          emails: ['sam@books.example', 'ghost@nowhere.example'],
        },
      ],
      customerUpdates: [
        {
          contactIdOrEmail: 'sam@books.example',
          status: 'Lead',
          nextAction: 'Schedule intro call',
          dueDate: '2026-10-20',
        },
        {
          contactIdOrEmail: 'mira@press.example',
          status: 'Customer',
          dueDate: '2026-11-01',
        },
      ],
      eventPreps: [
        {
          list: 'Frankfurt Book Fair 2026',
          contact: 'sam@books.example',
          meet: true,
          note: 'Discuss distribution',
        },
      ],
    }

    // Dry-run validates everything with zero mutations
    const dry = JSON.parse(
      (
        await handlers.fn_batchCurateDirectory!(
          invoke('fn_batchCurateDirectory', { ...payload, dryRun: true }),
        )
      ).content,
    )
    expect(dry.data).toMatchObject({
      dryRun: true,
      orgsSaved: [{ id: 'indie books guild', name: 'Indie Books Guild' }],
      contactsSaved: expect.arrayContaining([
        expect.objectContaining({ id: 'sam@books.example', name: 'Sam Lee' }),
      ]),
      customersSaved: expect.arrayContaining([
        expect.objectContaining({
          contactId: 'sam@books.example',
          mode: 'create',
          status: 'Lead',
        }),
        expect.objectContaining({
          contactId: 'mira@press.example',
          mode: 'update',
          status: 'Customer',
          dueDate: '2026-11-01',
        }),
      ]),
      eventPrepsSaved: [
        expect.objectContaining({
          contactId: 'sam@books.example',
          board: 'Frankfurt Book Fair 2026',
        }),
      ],
    })
    expect(harness.getSetStoreCalls()).toBe(0)
    expect(recordOperation).not.toHaveBeenCalled()
    expect(
      harness.getStore().contacts.some(c => c.id === 'sam@books.example'),
    ).toBe(false)

    // Real commit runs in exactly 1 setStore call
    const real = JSON.parse(
      (
        await handlers.fn_batchCurateDirectory!(
          invoke('fn_batchCurateDirectory', payload),
        )
      ).content,
    )
    expect(real.data.dryRun).toBe(false)
    expect(real.data.listsUpdated[0]).toMatchObject({
      list: 'Q4 Outreach',
      added: ['Sam Lee'],
      notFound: ['ghost@nowhere.example'],
      holds: 1,
    })
    expect(harness.getSetStoreCalls()).toBe(1)
    expect(recordOperation).toHaveBeenCalledTimes(1)
    expect(
      harness.getStore().orgs?.some(o => o.name === 'Indie Books Guild'),
    ).toBe(true)
    expect(
      harness.getStore().contacts.find(c => c.id === 'sam@books.example')
        ?.customer,
    ).toMatchObject({
      status: 'Lead',
      dueDate: '2026-10-20',
    })

    // Invalid batch entry aborts entire batch with zero partial writes
    const snapshotBefore = JSON.stringify(harness.getStore())
    await expect(
      handlers.fn_batchCurateDirectory!(
        invoke('fn_batchCurateDirectory', {
          orgs: [{ name: 'Should Not Persist' }],
          customerUpdates: [
            {
              contactIdOrEmail: 'sam@books.example',
              dueDate: '2026-02-30', // invalid calendar date
            },
          ],
        }),
      ),
    ).rejects.toThrow(AgentPeopleToolError)
    expect(JSON.stringify(harness.getStore())).toBe(snapshotBefore)

    // Invalid customerUpdates mode is rejected cleanly without mutating the store
    await expect(
      handlers.fn_batchCurateDirectory!(
        invoke('fn_batchCurateDirectory', {
          customerUpdates: [
            {
              contactIdOrEmail: 'sam@books.example',
              mode: 'delete',
            },
          ],
        }),
      ),
    ).rejects.toThrow(/Invalid customerUpdates mode/)
    expect(JSON.stringify(harness.getStore())).toBe(snapshotBefore)
  })

  it('preserves direct atomic core tools (listContacts, getContact, upsertContact, mergeContacts)', async () => {
    const { ctx, getStore } = makeContext(makeRichStore())
    const handlers = buildPurePeopleHandlers(() => ctx)

    const listed = JSON.parse(
      (
        await handlers.listContacts!(
          invoke('listContacts', { query: 'Mira' }),
        )
      ).content,
    )
    expect(listed.returned).toBe(2)

    const merged = JSON.parse(
      (
        await handlers.mergeContacts!(
          invoke('mergeContacts', {
            survivorId: 'mira@press.example',
            absorbedId: 'm.patel@press.example',
          }),
        )
      ).content,
    )
    expect(merged.absorbedId).toBe('m.patel@press.example')
    expect(merged.saved.emails).toEqual(
      expect.arrayContaining(['mira@press.example', 'm.patel@press.example']),
    )
    expect(getStore().contacts).toHaveLength(4)

    const full = JSON.parse(
      (
        await handlers.getContact!(
          invoke('getContact', { idOrEmail: 'm.patel@press.example' }),
        )
      ).content,
    )
    expect(full.id).toBe('mira@press.example')
  })
})
