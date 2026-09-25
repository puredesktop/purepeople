import { useRef, useState } from 'react'
import { mergeContacts } from '../lib/contactConsolidation'
import type { ContactRecord, PeopleUpdate } from '../types'

export function useContactMerge(update: PeopleUpdate, prepare: () => Promise<void>, onMerged: (contact: ContactRecord, absorbedId: string) => void) {
  const [survivorId, setSurvivorId] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = useRef(false)
  const run = async (operation: () => Promise<void>) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    try { await operation() } catch (error) {
      console.error('[purepeople] merge failed:', error)
      setError(error instanceof Error ? error.message : String(error))
    } finally { locked.current = false; setBusy(false) }
  }
  return {
    survivorId, targetId, query, busy, error, setQuery,
    choose: (id: string) => { setTargetId(id); setError(null) },
    open: (id: string) => {
      setSurvivorId(id); setTargetId(null); setQuery('')
      void run(prepare)
    },
    cancel: () => { if (!locked.current) { setSurvivorId(null); setError(null) } },
    retryPreparation: () => { void run(prepare) },
    confirm: () => {
      if (!survivorId || !targetId) return
      void run(async () => {
        await prepare()
        const contact = await mergeContacts(update, survivorId, targetId)
        onMerged(contact, targetId)
        setSurvivorId(null)
      })
    },
  }
}
export type ContactMergeWorkflow = ReturnType<typeof useContactMerge>
