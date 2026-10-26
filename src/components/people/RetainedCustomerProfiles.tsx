import type { ContactRecord } from '../../types'
import { Stack } from '../common/RecordControls'

/** Whole profiles stay paired so a merge cannot mix one person's notes and action. */
export function RetainedCustomerProfiles({ contact }: { contact: ContactRecord }) {
  const profiles = contact.alternatives?.customer ?? []
  if (!profiles.length) return null
  return <details><summary>Retained customer profiles</summary><Stack>
    {profiles.map((profile, index) => <Stack key={index}>
      <strong>{profile.status}</strong>
      <span style={{ whiteSpace: 'pre-wrap' }}>{profile.notes || 'No relationship notes'}</span>
      <span>{profile.nextAction || 'No next action'}</span>
      <span>{profile.dueDate || 'No due date'}</span>
    </Stack>)}
  </Stack></details>
}
