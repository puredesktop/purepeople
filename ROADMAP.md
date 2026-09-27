# purepeople roadmap

## Scope

Keep a contact book with people, organisations, lists and relationship context; preserve explicit edits over automatic feed updates.

These are proposed, incremental improvements, not a release schedule or a list of missing core features. Keep each change small and preserve existing file formats, user data and app workflows.

## Improvements

1. **Duplicate merge field summary.** Show which values will be retained or combined in the existing merge review so users can check conflicting names and addresses.

2. **Explicit edit indicator.** Identify manually curated fields in record details and explain that automatic feeds fill missing information rather than replace those edits.

3. **Source label readability.** Present the source of imported or encountered contact details in plain language using existing provenance rather than exposing internal identifiers.

4. **CSV column preview.** Show mapped field names and a few sample values before CSV import, highlighting unmapped columns without silently discarding them.

5. **CSV skipped-row report.** Report accepted and skipped row counts with row-specific reasons after import, keeping the original file unchanged.

6. **Duplicate email entry feedback.** Explain when an entered email address is already present on the same contact, retaining the existing address instead of creating a duplicate chip.

7. **Phone number copy action.** Provide a copy control for each displayed phone number without changing the stored international format.

8. **Address copy action.** Copy the full selected email address with a brief confirmation, including when the visible address is truncated.

9. **Long organisation names.** Improve wrapping and full-name tooltips in organisation lists and person profiles so similar names remain distinguishable.

10. **Same-name contact context.** Include organisation or primary email beside identical display names in pickers and search results.

11. **Search result field hint.** Show which field matched a contact query, such as name, organisation or email, without widening the result row excessively.

12. **Tag entry consistency.** Trim tag whitespace and suppress exact duplicate tags on a record while retaining the existing tag vocabulary.

13. **List membership feedback.** After adding or removing a contact from a list, confirm the affected list by name and keep the selected profile stable.

14. **Empty list guidance.** Distinguish an empty saved list from a filtered list with no matches, and point to the existing add-person action.

15. **Contact link validation.** Show a clear message for malformed website or profile URLs before committing them, keeping the draft available to fix.

16. **Photo load fallback.** When a contact photo fails to load, show initials and a recoverable error in photo editing rather than a broken-image icon.

17. **Relationship evidence dates.** Include exact dates beside available encounter evidence so users can judge how recent a displayed relationship is.

18. **Network selection visibility.** Keep the selected person's name and organisation visible in the relationship panel when the graph contains many similar nodes.

19. **Notes unsaved feedback.** Make saving and failed-save states visible while editing person or organisation notes without clearing the editor.

20. **Keyboard profile navigation.** Ensure record-list selection, profile actions and return-to-list behavior work predictably from the keyboard.

## References

- [App guide](docs/app-guide.md)
- [Development guide](docs/development.md)
- [Current implementation](src/components/PeopleShell.tsx)
