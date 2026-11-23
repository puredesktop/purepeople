/**
 * Exposed PurePeople operations (must stay in sync 1:1 with `plugin.json` -> `app.agents.tools[].name`).
 *
 * 3-tier exposure (built on `@purescience/platform-ui/bridge/appFunctions`):
 *   1. 5 composite `function` workflows (`fn_*`) — replace 3–15 atomic round-trips each
 *   2. 4 core atomic tools (~19% of 21) — indispensable direct contact read/write/consolidation verbs
 *   3. 3 universal escape-hatch meta-tools (`discoverAppTools`, `callExtendedReadTool`, `callExtendedTool`)
 *      providing full on-demand access to the remaining 17 specialist atomic tools.
 */
export const PUREPEOPLE_FUNCTION_NAMES = [
  'fn_directoryBriefing',
  'fn_personRelationshipDossier',
  'fn_orgAndEventBriefing',
  'fn_duplicateAndHygieneAudit',
  'fn_batchCurateDirectory',
] as const

export const PUREPEOPLE_CORE_TOOL_NAMES = [
  'listContacts',
  'getContact',
  'upsertContact',
  'mergeContacts',
] as const

export const PUREPEOPLE_META_TOOL_NAMES = [
  'discoverAppTools',
  'callExtendedReadTool',
  'callExtendedTool',
] as const

export const EXPOSED_TOOL_NAMES = [
  ...PUREPEOPLE_FUNCTION_NAMES,
  ...PUREPEOPLE_CORE_TOOL_NAMES,
  ...PUREPEOPLE_META_TOOL_NAMES,
] as const

/** Keep in sync with `plugin.json` -> `app.agents.tools[].name`. */
export const PUREPEOPLE_AGENT_TOOL_NAMES = EXPOSED_TOOL_NAMES

export const PUREPEOPLE_EXTENDED_TOOL_NAMES = [
  'prepareProfilePhotoResearch',
  'listOrgs',
  'getOrg',
  'upsertOrg',
  'listLists',
  'createList',
  'renameList',
  'workListInOutreach',
  'deleteList',
  'addToList',
  'removeFromList',
  'getEventBoard',
  'setEventPrep',
  'getPersonNetwork',
  'createCustomer',
  'updateCustomer',
  'listCustomers',
] as const

export const PUREPEOPLE_ALL_ATOMIC_TOOL_NAMES = [
  ...PUREPEOPLE_CORE_TOOL_NAMES,
  ...PUREPEOPLE_EXTENDED_TOOL_NAMES,
] as const

export const PUREPEOPLE_AGENT_LOG_LABEL = 'purepeople'
