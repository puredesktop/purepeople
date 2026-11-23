import {
  createAppOperationsRegistry,
  defineAppTool,
  type AppAtomicToolDefinition,
  type BuildHandlersOptions,
} from '@purescience/platform-ui/bridge/appFunctions'
import type {
  AgentToolHandler,
  AgentToolHandlerResult,
} from '@purescience/platform-ui/bridge/react/usePlatformAgentTools'
import { PUREPEOPLE_ATOMIC_TOOL_SCHEMAS } from './atomicToolSchemas'
import { listCustomersHandler, saveCustomerHandler } from './customerTools'
import {
  getEventBoardHandler,
  getPersonNetworkHandler,
  setEventPrepHandler,
} from './eventTools'
import { PUREPEOPLE_FUNCTIONS } from './functions'
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
  mergeContactsHandler,
  prepareProfilePhotoResearchHandler,
  removeFromListHandler,
  renameListHandler,
  upsertContactHandler,
  upsertOrgHandler,
  workListInOutreachHandler,
  type PeopleAgentToolContext,
} from './handlers'

type AtomicRunner = (
  ctx: PeopleAgentToolContext,
  args: Record<string, unknown>,
) => AgentToolHandlerResult | Promise<AgentToolHandlerResult>

const ATOMIC_RUNNERS: Record<string, AtomicRunner> = {
  listContacts: (ctx, args) => listContactsHandler(ctx, args),
  getContact: (ctx, args) => getContactHandler(ctx, args),
  prepareProfilePhotoResearch: (ctx, args) =>
    prepareProfilePhotoResearchHandler(ctx, args),
  upsertContact: (ctx, args) => upsertContactHandler(ctx, args),
  mergeContacts: (ctx, args) => mergeContactsHandler(ctx, args),
  listOrgs: (ctx, args) => listOrgsHandler(ctx, args),
  getOrg: (ctx, args) => getOrgHandler(ctx, args),
  upsertOrg: (ctx, args) => upsertOrgHandler(ctx, args),
  listLists: ctx => listListsHandler(ctx),
  createList: (ctx, args) => createListHandler(ctx, args),
  renameList: (ctx, args) => renameListHandler(ctx, args),
  workListInOutreach: (ctx, args) => workListInOutreachHandler(ctx, args),
  deleteList: (ctx, args) => deleteListHandler(ctx, args),
  addToList: (ctx, args) => addToListHandler(ctx, args),
  removeFromList: (ctx, args) => removeFromListHandler(ctx, args),
  getEventBoard: (ctx, args) => getEventBoardHandler(ctx, args),
  setEventPrep: (ctx, args) => setEventPrepHandler(ctx, args),
  getPersonNetwork: (ctx, args) => getPersonNetworkHandler(ctx, args),
  createCustomer: (ctx, args) => saveCustomerHandler(ctx, args, 'create'),
  updateCustomer: (ctx, args) => saveCustomerHandler(ctx, args, 'update'),
  listCustomers: (ctx, args) => listCustomersHandler(ctx, args),
}

const atomicTools: AppAtomicToolDefinition<PeopleAgentToolContext>[] =
  PUREPEOPLE_ATOMIC_TOOL_SCHEMAS.map(schema =>
    defineAppTool<PeopleAgentToolContext>({
      ...schema,
      run: async (ctx, args) => {
        const runner = ATOMIC_RUNNERS[schema.name]
        if (!runner) {
          throw new AgentPeopleToolError(
            `Missing atomic tool handler for "${schema.name}".`,
          )
        }
        return runner(ctx, args)
      },
    }),
  )

/**
 * PurePeople's unified Operations Registry built on `@purescience/platform-ui/bridge/appFunctions`:
 *   - 5 composite `function` workflows (`fn_*`, always exposed)
 *   - 4 core atomic tools (~19% of 21, always exposed)
 *   - 3 universal escape-hatch meta-tools (always exposed)
 *   - 17 extended specialist atomic tools (hidden by default, 100% reachable on demand)
 */
export const PUREPEOPLE_OPERATIONS_REGISTRY =
  createAppOperationsRegistry<PeopleAgentToolContext>({
    appSlug: 'people',
    appName: 'PurePeople',
    functions: PUREPEOPLE_FUNCTIONS,
    tools: atomicTools,
  })

export function buildPurePeopleHandlers(
  getCtx: () => PeopleAgentToolContext,
  options: BuildHandlersOptions<PeopleAgentToolContext> = {},
): Record<string, AgentToolHandler> {
  return PUREPEOPLE_OPERATIONS_REGISTRY.buildHandlers(getCtx, {
    createError: message => new AgentPeopleToolError(message),
    ...options,
  })
}
