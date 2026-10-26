# Customer tracking — req-0003

Customers is a reachable view in the contact rail. Profiles are optional nested
`customer` values in the existing `contacts` collection, persisted by the same
`PeopleUpdate`/`usePeopleData` path as contact edits. No identity or database
collection is added. The existing contact creation flow remains the entry point
for new people. The imported free-text `status` stays separate: this extension
uses explicit Lead, Customer and Inactive values only after enrolment.

## Verification and delivered head

Delivery now has a strict entry point:

```sh
npm run verify -- --expected-head <exact-delivered-head-SHA>
```

It rejects an uncommitted tree or a different HEAD before running checks. On a
clean tree it runs typecheck, acceptance tests, the complete suite and the build,
then saves `dist/customer-verification.json` (an ignored build artifact). The
report includes `verifiedHeadSha`, the committed tree SHA, changed files,
commands, exit codes, and a source digest checked before and after verification.
`verifiedHeadSha` is set only when every check passes on an unchanged, clean
commit. PureDev should attach this report to the PR for the exact head judged.
No additional commit is needed to save that report.

Authoring verification uses `npm run verify:working-tree`, which also runs all
checks and records a source digest, but explicitly leaves `verifiedHeadSha` null
for uncommitted changes. It is not delivery verification. The authoring checkout
currently has base HEAD `65b809f149a2457bff29aa03d95fd3db9a60470c`; the feature
is still uncommitted because this task prohibits the agent from committing.
PureDev must create the delivery commit before strict verification can pass.

All checks below passed on the final implementation working tree:

| Command | Result |
| --- | --- |
| `git diff --check` | Exit 0 |
| `npm run typecheck` | Exit 0 |
| `npm run test -- src/lib/customers.test.ts src/hooks/usePeopleData.test.tsx src/components/customers/CustomerView.test.tsx` | Exit 0; 28 tests in 3 files |
| `npm run test` | Exit 0; 126 tests in 19 files |
| `npm run build` | Exit 0; production bundle generated |

The build reports large chunks in shared platform dependencies. Failure-path
tests deliberately log rejected writes; these are expected and the assertions
pass. `puredesktop:check` is mentioned in the existing development guide but is
not a script in this repository. No browser, desktop, app window or screenshots
were used. PureDev supplies visual review photographs separately.

Dependencies were supplied from the compatible local suite: TypeScript 5.9.3,
Vitest 3.2.7, Vite 7.3.6, React SWC plugin 3.11.0, SWC core 1.15.40 and styled
components plugin 12.12.1. The TypeScript and Vite configuration now work without
parent suite config/scripts; package imports still use the real shared SDK.
The dev port remains manifest-derived and honours `PURESCIENCE_APP_DEV_PORT`.
No dependency declaration or lockfile changed; package scripts now expose
strict delivery verification and separate working-tree verification.

## Acceptance coverage

- Pure domain tests create a Lead, edit every relationship field, transition to
  Customer and Inactive, and round-trip through serialization. Search and all
  status/date filters assert exact IDs, including undated contacts and updates.
- The persistence-hook acceptance test loads the saved legacy fixture, performs
  the existing contact edit/save operation, remounts, then saves and reloads
  each customer status through the actual app-data adapter with a cloned mock
  bridge. It verifies the stable ID, original fields and all relationship data.
- Invalid status, malformed calendar dates, duplicate enrolment and missing
  contact IDs are refused; persistence tests verify saved rows remain identical
  after rejection.
- UI tests invoke the handlers actually registered by PeopleShell and check the
  manifest/tool names, create/update/list responses, current editor values and
  shared filtered records. A second test enters and saves notes, next action and
  due date through the editor, changes all statuses, and searches the results.

## Review corrections

Review found and fixed three interactions with the existing contact book:
merges now inherit an absorbed profile when needed and retain complete conflicting
profiles; customer forms save only fields the user edited, preserving intervening
agent/queued updates; and returning from Customers re-seeds the regular notes
editor after its DOM node was replaced. Regression tests cover these paths and
confirm a failed relationship save keeps the entered draft for retry. The legacy
fixture test also explicitly checks that existing data survives an ordinary edit.

## Changed files

- `src/types.ts`: optional customer profile and retained conflicting profiles.
- `src/lib/contactConsolidation.ts`: preserve profiles through explicit and alias merges.
- `src/components/people/RetainedDetails.tsx`: show retained customer profiles.
- `src/components/people/RetainedCustomerProfiles.tsx`: readable preserved profile values.
- `src/lib/customers.ts`: shared validation, updates and filtered listing.
- `src/lib/customers.test.ts`: domain acceptance tests.
- `src/lib/fixtures/legacy-contact.json`: synthetic compatibility fixture.
- `src/hooks/usePeopleData.test.tsx`: row persistence/reload acceptance test.
- `src/agents/customerTools.ts`: create/update/list tool handlers.
- `src/agents/handlers.ts`: tool registration names.
- `src/components/PeopleShell.tsx`: reachable view and registered handlers.
- `src/components/customers/CustomerView.tsx`: customer list, picker and editor.
- `src/components/customers/CustomerView.test.tsx`: registered-agent and UI tests.
- `plugin.json`: three agent operation schemas.
- `README.md`, `agents.md`: user and drawer documentation.
- `tsconfig.json`, `vite.config.js`: independent repository checks/build with SDK packages.
- `scripts/verify-customers.mjs`: strict verification bound to a clean, unchanged HEAD.
- `package.json`: delivery and working-tree verification commands.
- `docs/customer-verification.md`: this review/handoff record.
