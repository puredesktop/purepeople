# PurePeople code-first review — 2026-09-10

Baseline: freshly fetched remote `origin/main`, `44ca423f2326570f62a7787e8712747e28f22d43`. Fetched again on the user's latest-code clarification; no newer upstream commits existed. Review scope was the 14 production TypeScript/TSX source files, including the full PeopleShell event/render flow and styles, plus entry/build configuration and relevant existing tests. Generated bundles, dependencies and .project-data history were not audited.

## Fixed

1. Editing through a stable contact id after replacing the original email created a second record and could restore the removed address. Resolve stable ids before email matching and do not re-add an id as an address.
2. Explicit duplicate consolidation discarded the absorbed contact's curated list memberships. Preserve the union.
3. Feeds with a new primary email and an already-known alias created duplicate people. Match known aliases before creating a record. A new feed record cannot reuse an occupied stable id.
4. CSV files with an Emails column but no singular Email column were classified as organisations. Recognize the multi-address field and select its first address.
5. Truncated quoted CSV silently became partial records. Reject an unclosed quoted field.
6. Different list names with the same normalized slug, created within one millisecond, got the same id. Use UUID identity.
7. Rich notes flattened paragraph/line boundaries into joined words in agent-readable/exported text. Preserve line breaks.
8. UI write failures only appeared in the console. Show the actual failure as an alert and clear it after a confirmed successful edit.

## Focused verification only

All eight new regression checks failed before their respective fixes and passed afterward:

`npm test -- --run src/lib/codeReview.test.ts src/components/PeopleShell.review.test.tsx`

The mounted component check injects a rejected contact deletion and verifies that the error reaches the UI. `npm run typecheck` passes. No full test suite or new end-to-end mission run was performed.

## Remaining work to consider

- Move list-tool preconditions into the queued updater: several handlers resolve lists/contacts against an earlier snapshot, so concurrent tool calls can return stale descriptions of results.
- Persist a retryable notes outbox across navigation/reload, rather than relying on an in-memory debounce and the user retrying after a write error. The new alert makes failure visible; it is not an automatic retry system.
- Sort the entire matched collection before applying the 500-row rail limit. Currently the UI re-sorts a subset already limited by interaction ranking.
- Give non-button navigation/chip controls complete keyboard semantics and test narrow-window overflow. This pass did not redesign the layout.
- The mail-compose storage handoff uses a read/modify/write file; atomic cross-app intent delivery requires coordination with Mail/platform ownership. No mail was sent in this review.

No shell implementation changes. Existing contact field-locking, stable ids and public bridge ownership remain in place.
