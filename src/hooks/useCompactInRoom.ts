import { useAdjacentApp } from '@purescience/platform-ui/bridge/react/useAdjacentApp'

/**
 * True only while this copy is held inside a page (a room, the Personal agent's page). Everything compact hangs off
 * this one answer. Beside an app in split view, or after the room's Full app, it is the whole app.
 */
export function useCompactInRoom(): boolean {
  return useAdjacentApp()?.heldInRoom === true
}
