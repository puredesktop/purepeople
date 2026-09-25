import { useEffect, useRef, useState } from 'react'
import { AppFrame } from '@purescience/platform-bridge/components/AppFrame'
import { EmptyState } from '@purescience/platform-ui/components/common/feedback/EmptyState'
import { usePlatformBridge } from '@purescience/platform-ui/bridge/react/usePlatformBridge'
import { PeopleShell } from './components/PeopleShell'
import {
  isStandaloneDevMode,
  readStandaloneStore,
  writeStandaloneStore,
} from './lib/peopleBridge'
import { usePeopleData } from './hooks/usePeopleData'
import type { PeopleStore, PeopleUpdate } from './types'

export function App(): React.ReactElement {
  const { error: bridgeError, meta } = usePlatformBridge()
  const standalone = isStandaloneDevMode()
  if (bridgeError && !standalone) {
    return (
      <AppFrame>
        <EmptyState
          tone="error"
          title="Bridge unavailable"
          message={bridgeError.message}
        />
      </AppFrame>
    )
  }
  return (
    <AppFrame>
      {standalone ? <StandalonePeople /> : meta ? <ConnectedPeople appId={meta.appSlug} /> : (
        <EmptyState tone="neutral" title="PurePeople" message="Loading people..." />
      )}
    </AppFrame>
  )
}

function ConnectedPeople({ appId }: { appId: string }): React.ReactElement {
  const { store, update, loading, error } = usePeopleData(appId)
  return <PeopleContent store={loading ? null : store} update={update} error={error} />
}

function StandalonePeople(): React.ReactElement {
  const [store, setStore] = useState<PeopleStore | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const current = useRef(store)
  useEffect(() => {
    try {
      current.current = readStandaloneStore()
      setStore(current.current)
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)))
    }
  }, [])
  const update: PeopleUpdate = async updater => {
    if (!current.current) throw new Error('People is not loaded')
    const next = updater(current.current)
    writeStandaloneStore(next)
    current.current = next
    setStore(next)
    return next
  }
  return <PeopleContent store={store} update={update} error={error} />
}

function PeopleContent({ store, update, error }: {
  store: PeopleStore | null
  update: PeopleUpdate
  error: Error | null
}): React.ReactElement {
  if (error) {
    return (
      <EmptyState
        tone="error"
        title="PurePeople boot failed"
        message={error.message}
      />
    )
  }
  if (!store) {
    return (
      <EmptyState
        tone="neutral"
        title="PurePeople"
        message="Loading people..."
      />
    )
  }
  return <PeopleShell store={store} update={update} />
}
