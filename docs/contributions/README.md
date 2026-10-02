# purepeople contribution roadmap

[View roadmap issues](https://github.com/puredesktop/purepeople/issues?q=is%3Aissue%20label%3Aroadmap)

Build something you can see and try in the app. The first five items are **good first contributions**: bounded changes with a concrete demonstration. Choose a feature below, fix a bug, or propose your own improvement.

## Scope

Keep a contact book with people, organisations, lists and relationship context; preserve explicit edits over automatic feed updates.

Size describes scope, not a promised completion time: **Small** = one focused interface change; **Medium** = coordinated interface/state work; **Large** = a feature across several flows, storage or export paths. All items are proposals, not claims that existing features are absent. Check the current code and extend what is there. Maintainers review code and tests before merging. Attribution is your choice.

## Good first contributions

1. **[Copy a phone number.](https://github.com/puredesktop/purepeople/issues/1)** Provide a copy control for each displayed phone number without changing the stored international format.
   <!-- contribution: {"id": "phone-number-copy-action", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/phone-number-copy-action.md"} -->
   [Small · Good first contribution · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/phone-number-copy-action.md)

2. **[Copy an email address.](https://github.com/puredesktop/purepeople/issues/2)** Copy the full selected email address with a brief confirmation, including when the visible address is truncated.
   <!-- contribution: {"id": "address-copy-action", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/address-copy-action.md"} -->
   [Small · Good first contribution · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/address-copy-action.md)

3. **[Tell same-name contacts apart.](https://github.com/puredesktop/purepeople/issues/3)** Include organisation or primary email beside identical display names in pickers and search results.
   <!-- contribution: {"id": "same-name-contact-context", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/same-name-contact-context.md"} -->
   [Small · Good first contribution · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/same-name-contact-context.md)

4. **[Recover from an empty contact list.](https://github.com/puredesktop/purepeople/issues/4)** Distinguish an empty saved list from a filtered list with no matches, and point to the existing add-person action.
   <!-- contribution: {"id": "empty-list-guidance", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/empty-list-guidance.md"} -->
   [Small · Good first contribution · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/empty-list-guidance.md)

5. **[Read long organisation names.](https://github.com/puredesktop/purepeople/issues/5)** Improve wrapping and full-name tooltips in organisation lists and person profiles so similar names remain distinguishable.
   <!-- contribution: {"id": "long-organisation-names", "size": "small", "goodFirstIssue": true, "guide": "docs/contributions/long-organisation-names.md"} -->
   [Small · Good first contribution · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/long-organisation-names.md)

## More improvements

6. **[Review exactly what merging contacts will keep.](https://github.com/puredesktop/purepeople/issues/6)** Show which values will be retained or combined in the existing merge review so users can check conflicting names and addresses.
   <!-- contribution: {"id": "duplicate-merge-field-summary", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/duplicate-merge-field-summary.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/duplicate-merge-field-summary.md)

7. **[Recognise details you edited yourself.](https://github.com/puredesktop/purepeople/issues/7)** Identify manually curated fields in record details and explain that automatic feeds fill missing information rather than replace those edits.
   <!-- contribution: {"id": "explicit-edit-indicator", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/explicit-edit-indicator.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/explicit-edit-indicator.md)

8. **[See where a contact detail came from.](https://github.com/puredesktop/purepeople/issues/8)** Present the source of imported or encountered contact details in plain language using existing provenance rather than exposing internal identifiers.
   <!-- contribution: {"id": "source-label-readability", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/source-label-readability.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/source-label-readability.md)

9. **[Preview CSV columns before importing contacts.](https://github.com/puredesktop/purepeople/issues/9)** Show mapped field names and a few sample values before CSV import, highlighting unmapped columns without silently discarding them.
   <!-- contribution: {"id": "csv-column-preview", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/csv-column-preview.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/csv-column-preview.md)

10. **[Find skipped contacts after import.](https://github.com/puredesktop/purepeople/issues/10)** Report accepted and skipped row counts with row-specific reasons after import, keeping the original file unchanged.
   <!-- contribution: {"id": "csv-skipped-row-report", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/csv-skipped-row-report.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/csv-skipped-row-report.md)

11. **[Avoid duplicate email chips.](https://github.com/puredesktop/purepeople/issues/11)** Explain when an entered email address is already present on the same contact, retaining the existing address instead of creating a duplicate chip.
   <!-- contribution: {"id": "duplicate-email-entry-feedback", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/duplicate-email-entry-feedback.md"} -->
   [Small · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/duplicate-email-entry-feedback.md)

12. **[See why a contact matched your search.](https://github.com/puredesktop/purepeople/issues/12)** Show which field matched a contact query, such as name, organisation or email, without widening the result row excessively.
   <!-- contribution: {"id": "search-result-field-hint", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/search-result-field-hint.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/search-result-field-hint.md)

13. **[Avoid duplicate contact tags.](https://github.com/puredesktop/purepeople/issues/13)** Trim tag whitespace and suppress exact duplicate tags on a record while retaining the existing tag vocabulary.
   <!-- contribution: {"id": "tag-entry-consistency", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/tag-entry-consistency.md"} -->
   [Small · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/tag-entry-consistency.md)

14. **[Know which list membership changed.](https://github.com/puredesktop/purepeople/issues/14)** After adding or removing a contact from a list, confirm the affected list by name and keep the selected profile stable.
   <!-- contribution: {"id": "list-membership-feedback", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/list-membership-feedback.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/list-membership-feedback.md)

15. **[Correct an invalid profile link.](https://github.com/puredesktop/purepeople/issues/15)** Show a clear message for malformed website or profile URLs before committing them, keeping the draft available to fix.
   <!-- contribution: {"id": "contact-link-validation", "size": "small", "goodFirstIssue": false, "guide": "docs/contributions/contact-link-validation.md"} -->
   [Small · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/contact-link-validation.md)

16. **[Recover from a broken contact photo.](https://github.com/puredesktop/purepeople/issues/16)** When a contact photo fails to load, show initials and a recoverable error in photo editing rather than a broken-image icon.
   <!-- contribution: {"id": "photo-load-fallback", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/photo-load-fallback.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/photo-load-fallback.md)

17. **[See when a relationship was last evidenced.](https://github.com/puredesktop/purepeople/issues/17)** Include exact dates beside available encounter evidence so users can judge how recent a displayed relationship is.
   <!-- contribution: {"id": "relationship-evidence-dates", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/relationship-evidence-dates.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/relationship-evidence-dates.md)

18. **[Keep the selected person visible in a network.](https://github.com/puredesktop/purepeople/issues/18)** Keep the selected person's name and organisation visible in the relationship panel when the graph contains many similar nodes.
   <!-- contribution: {"id": "network-selection-visibility", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/network-selection-visibility.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/network-selection-visibility.md)

19. **[Keep notes when saving fails.](https://github.com/puredesktop/purepeople/issues/19)** Make saving and failed-save states visible while editing person or organisation notes without clearing the editor.
   <!-- contribution: {"id": "notes-unsaved-feedback", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/notes-unsaved-feedback.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/notes-unsaved-feedback.md)

20. **[Move between contacts with the keyboard.](https://github.com/puredesktop/purepeople/issues/20)** Ensure record-list selection, profile actions and return-to-list behavior work predictably from the keyboard.
   <!-- contribution: {"id": "keyboard-profile-navigation", "size": "medium", "goodFirstIssue": false, "guide": "docs/contributions/keyboard-profile-navigation.md"} -->
   [Medium · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/keyboard-profile-navigation.md)

21. **[Review contact completeness without changing records.](https://github.com/puredesktop/purepeople/issues/21)** Add a read-only view for missing email, phone or organisation, with filters and links to edit profiles. Users choose which gaps matter; do not infer or invent contact details.
   <!-- contribution: {"id": "review-contact-completeness-without-changing-records", "size": "large", "goodFirstIssue": false, "guide": "docs/contributions/review-contact-completeness-without-changing-records.md"} -->
   [Large · Implementation brief](https://github.com/puredesktop/purepeople/blob/main/docs/contributions/review-contact-completeness-without-changing-records.md)

## References

- [App guide](https://github.com/puredesktop/purepeople/blob/main/docs/app-guide.md)
- [Development guide](https://github.com/puredesktop/purepeople/blob/main/docs/development.md)
- [Contributing](https://github.com/puredesktop/purepeople/blob/main/CONTRIBUTING.md)
