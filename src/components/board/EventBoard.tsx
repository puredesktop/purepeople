import { useEffect, useMemo, useRef, useState } from 'react'
import { styled } from 'styled-components'
import { acquaintance, boardPeople, briefingText, prepFor, scopeKey, scopeTitle, setPrep, type BoardScope } from '../../lib/eventBoard'
import { allTies, tieLabel, tiesFor } from '../../lib/network'
import { askDrawer, copyText, requestMailCompose } from '../../lib/peopleBridge'
import type { ContactRecord, PeopleStore, PeopleUpdate } from '../../types'
import { Face } from './Face'

type Filter = 'all' | 'meet' | 'new' | 'known' | 'met'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everyone' }, { id: 'meet', label: 'Want to meet' }, { id: 'new', label: 'New to you' },
  { id: 'known', label: 'Know already' }, { id: 'met', label: 'Met here' },
]
const APP_LABEL: Record<string, string> = { mail: 'Mail', calendar: 'Calendar', user: 'You', agent: 'Assistant', csv: 'Import', people: 'People' }
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const shortDate = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '' }

/**
 * An event board: everyone on a list or in a search, laid out to prepare
 * for meeting them. Faces or a list; star who to meet; a drawer with how
 * you know each person, who they are connected to, and a note for this
 * event. Stars and notes belong to this board only.
 */
export function EventBoard({ store, scope, update, hidden = false, onClose, onOpenProfile, onOpenNetwork }: {
  store: PeopleStore
  scope: BoardScope
  update: PeopleUpdate
  /** Kept mounted but out of sight while a network opened from it is showing, so Back returns to the same filter and selection. */
  hidden?: boolean
  onClose: () => void
  onOpenProfile: (contactId: string) => void
  onOpenNetwork: (contactId: string, boardIds: string[]) => void
}): React.ReactElement {
  const key = scopeKey(scope)
  const everyone = useMemo(() => boardPeople(store, scope), [store, scope])
  const [view, setView] = useState<'faces' | 'list'>('faces')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const ties = useMemo(() => allTies(store), [store])
  const boardIds = useMemo(() => new Set(everyone.map(p => p.id)), [everyone])

  const needle = query.trim().toLowerCase()
  const matches = (p: ContactRecord) => !needle || [p.name, p.org ?? '', p.title ?? '', ...(p.topics ?? []), ...(p.tags ?? []), ...p.emails].some(v => v.toLowerCase().includes(needle))
  const inFilter = (p: ContactRecord, f: Filter) => {
    const prep = prepFor(p, key), level = acquaintance(p).level
    return f === 'all' || (f === 'meet' ? !!prep?.meet : f === 'new' ? level === 'new' : f === 'known' ? level !== 'new' : !!prep?.metAt)
  }
  // Who to meet first, then people you know, then by how often you have been in touch.
  const rank = (p: ContactRecord) => (prepFor(p, key)?.meet ? 0 : 1) * 10 + (acquaintance(p).level === 'new' ? 1 : 0)
  const shown = everyone.filter(p => matches(p) && inFilter(p, filter)).sort((a, b) => rank(a) - rank(b) || b.seenCount - a.seenCount || a.name.localeCompare(b.name))
  const selected = everyone.find(p => p.id === selectedId) ?? shown[0] ?? everyone[0] ?? null
  const toMeet = everyone.filter(p => prepFor(p, key)?.meet)
  const metHere = everyone.filter(p => prepFor(p, key)?.metAt)

  useEffect(() => {
    if (hidden) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !(event.target as HTMLElement | null)?.closest?.('textarea, input')) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, hidden])
  useEffect(() => { if (!status) return; const t = setTimeout(() => setStatus(null), 4200); return () => clearTimeout(t) }, [status])

  const save = (contactId: string, patch: Parameters<typeof setPrep>[3]) => { void update(current => setPrep(current, contactId, key, patch)).catch(error => setStatus(error instanceof Error ? error.message : String(error))) }
  const toggleMeet = (p: ContactRecord) => save(p.id, { meet: !prepFor(p, key)?.meet })
  const title = scopeTitle(store, scope)
  const brief = async () => {
    const names = (toMeet.length ? toMeet : everyone.slice(0, 12)).map(p => p.name).join(', ')
    const handed = await askDrawer(`In PurePeople, I am preparing for ${title}. Read the event board with getEventBoard (${scope.kind === 'list' ? `list "${title}"` : `search ${title}`}) and brief me on ${toMeet.length ? 'the people I want to meet' : 'who I should meet'}: ${names}. For each, say how I know them, who they are connected to on the board (getPersonNetwork), and one thing worth raising, only from what PurePeople and my mail record. Suggest others on the board worth meeting and say why.`)
    setStatus(handed ? 'Handed to the assistant in the drawer.' : 'Open the assistant drawer to ask for a briefing.')
  }
  const copyBriefing = async () => setStatus(await copyText(briefingText(store, scope)) ? 'Briefing copied: paste it into a note or an email to yourself.' : 'Could not copy the briefing.')

  return (
    <Scrim hidden={hidden} onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <Sheet role="dialog" aria-label={`${title} board`}>
        <Main>
          <Head>
            <div style={{ minWidth: 0 }}>
              <Kicker><span className="dot" />{scope.kind === 'list' ? 'List' : 'Search'} · {everyone.length} {everyone.length === 1 ? 'person' : 'people'}</Kicker>
              <Title>{title}</Title>
              <Sub>{toMeet.length ? `${toMeet.length} to meet` : 'Star the people you want to meet'}{metHere.length ? ` · ${metHere.length} met here` : ''}</Sub>
            </div>
            <span className="sp" />
            <Search><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input aria-label="Filter these people" placeholder="Filter by name, org, topic" value={query} onChange={event => setQuery(event.target.value)} />
            </Search>
            <Segmented role="group" aria-label="View">
              <button type="button" aria-pressed={view === 'faces'} onClick={() => setView('faces')}>Faces</button>
              <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>List</button>
            </Segmented>
            <IconButton type="button" aria-label="Close board" onClick={onClose}>×</IconButton>
          </Head>
          <Chips>
            {FILTERS.map(f => { const count = everyone.filter(p => inFilter(p, f.id)).length; return <Chip key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} disabled={!count && f.id !== 'all'}>{f.label} <span>{count}</span></Chip> })}
            <span className="sp" />
            <Muted>Starred first, then people you know</Muted>
          </Chips>
          <Body>
            {!everyone.length ? <Empty>No one here yet. Add people to the list, or try another search.</Empty>
              : !shown.length ? <Empty>No one matches. Clear the filter to see everyone.</Empty>
              : view === 'faces' ? (
                <Grid>
                  {shown.map(p => {
                    const prep = prepFor(p, key), known = acquaintance(p)
                    return (
                      <Card key={p.id} $selected={selected?.id === p.id}>
                        <Star on={!!prep?.meet} name={p.name} onClick={() => toggleMeet(p)} />
                        <button type="button" className="open" onClick={() => setSelectedId(p.id)} aria-label={`Open ${p.name}`}>
                          <Face contact={p} size={72} />
                          <span className="name">{p.name}</span>
                          {p.title ? <span className="role">{p.title}</span> : null}
                          {p.org ? <span className="org">{p.org}</span> : null}
                          {p.emails[0] ? <span className="email">{p.emails[0]}</span> : null}
                          <Badge $level={prep?.metAt ? 'here' : known.level}>{prep?.metAt ? 'Met here' : known.label}</Badge>
                        </button>
                      </Card>
                    )
                  })}
                </Grid>
              ) : (
                <Rows>
                  {shown.map(p => {
                    const prep = prepFor(p, key), known = acquaintance(p)
                    return (
                      <Row key={p.id} $selected={selected?.id === p.id}>
                        <button type="button" className="open" onClick={() => setSelectedId(p.id)} aria-label={`Open ${p.name}`}>
                          <Face contact={p} size={38} />
                          <span className="who"><span className="name">{p.name}</span><span className="role">{[p.title, p.org].filter(Boolean).join(' · ')}</span></span>
                          <span className="email">{p.emails[0] ?? ''}</span>
                          <span className="badge"><Badge $level={prep?.metAt ? 'here' : known.level}>{prep?.metAt ? 'Met here' : known.label}</Badge></span>
                        </button>
                        <Star on={!!prep?.meet} name={p.name} onClick={() => toggleMeet(p)} inline />
                      </Row>
                    )
                  })}
                </Rows>
              )}
          </Body>
          <Tray>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--pp-plum)" stroke="var(--pp-plum)" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
            <span className="meet"><b>{toMeet.length} to meet</b>{toMeet.length ? <Muted> · {toMeet.map(p => p.name.split(' ')[0]).join(', ')}</Muted> : null}</span>
            <span className="sp" />
            {status ? <Muted role="status">{status}</Muted> : null}
            <Button type="button" onClick={() => void brief()}>Ask the assistant to brief me</Button>
            <Button type="button" onClick={() => void copyBriefing()}>Copy briefing</Button>
            <Button type="button" $primary disabled={!toMeet.length} onClick={() => setFilter('meet')}>Show who to meet</Button>
          </Tray>
        </Main>
        {selected ? (
          <PersonDrawer key={selected.id} person={selected} store={store} boardKey={key} boardIds={boardIds} ties={ties}
            onStar={() => toggleMeet(selected)} onSave={patch => save(selected.id, patch)}
            onProfile={() => { onClose(); onOpenProfile(selected.id) }} onNetwork={() => onOpenNetwork(selected.id, [...boardIds])}
            onEmail={() => void requestMailCompose([{ name: selected.name, email: selected.emails[0] ?? '' }]).then(() => setStatus(`Opening a draft to ${selected.name} in Mail…`)).catch(() => setStatus('Could not reach Mail.'))} />
        ) : null}
      </Sheet>
    </Scrim>
  )
}

function PersonDrawer({ person: p, store, boardKey, boardIds, ties, onStar, onSave, onProfile, onNetwork, onEmail }: {
  person: ContactRecord; store: PeopleStore; boardKey: string; boardIds: Set<string>; ties: ReturnType<typeof allTies>
  onStar: () => void; onSave: (patch: { note?: string; metAt?: string }) => void; onProfile: () => void; onNetwork: () => void; onEmail: () => void
}): React.ReactElement {
  const prep = prepFor(p, boardKey)
  const [note, setNote] = useState(prep?.note ?? '')
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setNote(prep?.note ?? '') }, [prep?.note])
  const connections = tiesFor(store, p.id, ties)
  const here = connections.filter(t => boardIds.has(t.contactId))
  const nameOf = (id: string) => store.contacts.find(c => c.id === id)
  return (
    <Drawer aria-label={`${p.name} details`}>
      <DrawerHead>
        <Face contact={p} size={60} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="name">{p.name}</div>
          {p.title ? <div className="role">{p.title}</div> : null}
          {p.org ? <div className="org">{p.org}</div> : null}
        </div>
        <Star on={!!prep?.meet} name={p.name} onClick={onStar} inline large />
      </DrawerHead>
      <DrawerBody>
        <Section>
          {p.emails.map(email => <a key={email} href={`mailto:${email}`} onClick={event => { event.preventDefault(); onEmail() }}>{email}</a>)}
          {p.phones?.map(phone => <span key={phone}>{phone}</span>)}
          {p.links?.length ? <div className="pills">{p.links.map(link => <a key={link.url} className="pill" href={link.url} target="_blank" rel="noreferrer">{link.label || new URL(link.url, 'https://x').hostname}</a>)}</div> : null}
        </Section>
        <Section>
          <Label>How you know them</Label>
          {p.sources.slice(0, 4).map((source, i) => (
            <div key={i} className="seen"><span className="when">{shortDate(source.at)}</span><span className="app">{APP_LABEL[source.app] ?? source.app}</span><span className="what">{source.context || (source.app === 'csv' ? 'Imported' : 'Seen')}</span></div>
          ))}
          <Muted>{acquaintance(p).label} · seen {p.seenCount} time{p.seenCount === 1 ? '' : 's'}</Muted>
        </Section>
        {p.topics?.length || p.tags?.length ? (
          <Section>
            <Label>Topics and tags</Label>
            <div className="pills">{[...(p.topics ?? []), ...(p.tags ?? [])].map(t => <span key={t} className="pill quiet">{t}</span>)}</div>
          </Section>
        ) : null}
        <Section>
          <div className="labelRow"><Label>Connections</Label><Muted>{here.length} here · {connections.length} in all</Muted></div>
          {connections.length ? <>
            <div className="stack">{(here.length ? here : connections).slice(0, 6).map(t => { const c = nameOf(t.contactId); return c ? <span key={t.contactId} title={`${c.name}: ${tieLabel(t)}`} className="stacked"><Face contact={c} size={28} /></span> : null })}
              <span className="names">{(here.length ? here : connections).slice(0, 4).map(t => nameOf(t.contactId)?.name.split(' ')[0]).filter(Boolean).join(', ')}{(here.length || connections.length) > 4 ? '…' : ''}</span></div>
            <Button type="button" $soft onClick={onNetwork}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><circle cx="4" cy="6" r="2" /><circle cx="20" cy="6" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="18" r="2" /><path d="M6 7l4 3M18 7l-4 3M7 18l3-4M17 17l-3-3" /></svg>
              View network
            </Button>
          </> : <Muted>No shared threads recorded yet. Connections come from the threads and meetings Mail and Calendar see.</Muted>}
        </Section>
        <Section>
          <Label as="label" htmlFor="board-note">Note for this event</Label>
          <textarea id="board-note" rows={3} value={note} placeholder="What to ask, what to bring…" onFocus={() => { editing.current = true }}
            onChange={event => setNote(event.target.value)} onBlur={() => { editing.current = false; if (note !== (prep?.note ?? '')) onSave({ note }) }} />
          <label className="met"><input type="checkbox" checked={!!prep?.metAt} onChange={event => onSave({ metAt: event.target.checked ? today() : '' })} />Met here{prep?.metAt ? ` · ${shortDate(prep.metAt)}` : ''}</label>
        </Section>
      </DrawerBody>
      <DrawerFoot>
        <Button type="button" onClick={onEmail} disabled={!p.emails[0]}>Email</Button>
        <Button type="button" onClick={onProfile}>Open full profile</Button>
      </DrawerFoot>
    </Drawer>
  )
}

function Star({ on, name, onClick, inline, large }: { on: boolean; name: string; onClick: () => void; inline?: boolean; large?: boolean }): React.ReactElement {
  return (
    <StarButton type="button" aria-pressed={on} aria-label={on ? `Remove ${name} from people to meet` : `Add ${name} to people to meet`} title={on ? 'Want to meet' : 'Star to meet'} onClick={onClick} $on={on} $inline={!!inline} $large={!!large}>
      <svg width={large ? 17 : 15} height={large ? 17 : 15} viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
    </StarButton>
  )
}

/*
 * The board is glass like the rest of the suite: the desk stays visible
 * behind a light frost, the board and its drawer are two frosted panels
 * (the same pair as the app's rail and detail), and the people on them are
 * near-solid cards so names stay crisp. Every value is a platform token, so
 * dark mode and the solid appearance follow the suite.
 */
const Scrim = styled.div`
  position: fixed; inset: 0; z-index: 60; display: flex; gap: 12px;
  padding: 18px 18px 78px; /* the bottom clears the shell dock, which floats over the app */
  background: color-mix(in srgb, var(--pp-panel) 45%, transparent);
  backdrop-filter: blur(18px) saturate(120%); -webkit-backdrop-filter: blur(18px) saturate(120%);
  &[hidden] { display: none; }
`
const Sheet = styled.section`
  flex: 1; min-width: 0; display: flex; gap: 12px;
  font-family: var(--platform-typography-font-family); color: var(--pp-ink);
  button { font: inherit; color: inherit; cursor: pointer; }
  button:disabled { cursor: default; opacity: .5; }
  .sp { flex: 1; }
`
const glassPanel = `
  min-height: 0; overflow: hidden; border-radius: 18px;
  background: var(--pp-panel-strong); border: 1px solid var(--pp-glass-edge);
  box-shadow: var(--pp-glass-shadow);
  backdrop-filter: var(--pp-glass-blur); -webkit-backdrop-filter: var(--pp-glass-blur);
`
const Main = styled.div` flex: 1; min-width: 0; display: flex; flex-direction: column; ${glassPanel} `
const Head = styled.div`
  display: flex; align-items: flex-start; gap: 12px; padding: 18px 22px 12px; border-bottom: 1px solid var(--pp-glass-line);
`
const Kicker = styled.div`
  display: flex; align-items: center; gap: 8px; font-family: var(--platform-typography-font-family-mono, ui-monospace, monospace);
  font-size: var(--pure-chrome-label-size, 10.5px); letter-spacing: var(--pure-chrome-label-tracking, .14em); text-transform: uppercase; color: var(--pp-muted);
  .dot { width: 8px; height: 8px; border-radius: 3px; background: var(--pp-accent); }
`
const Title = styled.div` margin-top: 4px; font-size: 21px; font-weight: 600; letter-spacing: -0.01em; `
const Sub = styled.div` margin-top: 2px; font-size: 13px; color: var(--pp-text-soft); `
const Search = styled.label`
  display: flex; align-items: center; gap: 8px; width: 240px; height: 34px; padding: 0 12px; border-radius: 10px;
  background: var(--pp-wash); border: 1px solid var(--pp-glass-line); color: var(--pp-muted);
  input { border: 0; outline: 0; background: none; font: inherit; font-size: 13px; color: var(--pp-ink); flex: 1; min-width: 0; }
  input::placeholder { color: var(--pp-muted-2); }
  &:focus-within { border-color: var(--pp-accent); background: var(--pp-card); }
`
const Segmented = styled.div`
  display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--pp-wash);
  button { height: 28px; padding: 0 12px; border-radius: 999px; border: 0; background: none; font-size: 13px; color: var(--pp-muted); }
  button[aria-pressed='true'] { background: var(--pp-card); color: var(--pp-ink); font-weight: 600; box-shadow: 0 1px 2px rgba(16, 22, 40, .10); }
`
const IconButton = styled.button`
  width: 34px; height: 34px; border-radius: 10px; border: 1px solid var(--pp-glass-line); background: var(--pp-wash); font-size: 18px; line-height: 1; color: var(--pp-text-soft);
  &:hover { background: var(--pp-hover); color: var(--pp-ink); }
`
const Chips = styled.div` display: flex; align-items: center; gap: 6px; padding: 10px 22px 4px; flex-wrap: wrap; `
const Chip = styled.button`
  height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--pp-line); background: transparent; font-size: 12.5px; color: var(--pp-text-strong);
  span { font-family: var(--platform-typography-font-family-mono, monospace); font-size: 11px; opacity: .65; margin-left: 2px; }
  &:hover:not(:disabled) { background: var(--pp-hover); }
  &[aria-pressed='true'] { border-color: var(--pp-accent); background: var(--pp-green-wash); color: var(--pp-accent-text); font-weight: 600; }
`
const Muted = styled.span` font-size: 12.5px; color: var(--pp-muted); `
const Body = styled.div` flex: 1; min-height: 0; overflow: auto; padding: 12px 22px 16px; `
const Empty = styled.div` padding: 60px 20px; text-align: center; color: var(--pp-muted); font-size: 14px; `
const Grid = styled.div` display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 12px; `
const Card = styled.article<{ $selected: boolean }>`
  position: relative; border-radius: 16px; background: var(--pp-card);
  border: 1px solid ${({ $selected }) => ($selected ? 'var(--pp-accent)' : 'var(--pp-glass-edge)')};
  box-shadow: ${({ $selected }) => ($selected ? '0 0 0 3px var(--pp-green-wash), 0 8px 22px rgba(16, 22, 40, .08)' : '0 1px 2px rgba(16, 22, 40, .05), 0 8px 22px rgba(16, 22, 40, .05)')};
  transition: box-shadow .15s ease, border-color .15s ease, transform .15s ease;
  &:hover { transform: translateY(-1px); }
  .open { width: 100%; border: 0; background: none; padding: 18px 12px 14px; display: flex; flex-direction: column; align-items: center; gap: 5px; text-align: center; border-radius: 16px; }
  .name { margin-top: 6px; font-size: 14.5px; font-weight: 600; }
  .role { font-size: 12.5px; line-height: 1.35; color: var(--pp-text-strong); }
  .org { font-size: 12px; color: var(--pp-muted); }
  .email { max-width: 100%; font-size: 11.5px; color: var(--pp-plum); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (prefers-reduced-motion: reduce) { transition: none; &:hover { transform: none; } }
`
const Rows = styled.div` border-radius: 16px; overflow: hidden; background: var(--pp-card); border: 1px solid var(--pp-glass-edge); box-shadow: 0 8px 22px rgba(16, 22, 40, .05); `
const Row = styled.div<{ $selected: boolean }>`
  display: flex; align-items: center; gap: 8px; padding: 0 12px 0 0; border-bottom: 1px solid var(--pp-glass-line);
  &:last-child { border-bottom: 0; }
  background: ${({ $selected }) => ($selected ? 'var(--pp-green-wash)' : 'transparent')};
  &:hover { background: ${({ $selected }) => ($selected ? 'var(--pp-green-wash)' : 'var(--pp-hover)')}; }
  .open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 14px; border: 0; background: none; padding: 9px 14px; text-align: left; }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .role { font-size: 12.5px; color: var(--pp-text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .email { flex: 0 0 240px; font-size: 12.5px; color: var(--pp-plum); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { flex: 0 0 110px; }
  @media (max-width: 1100px) { .email { display: none; } }
`
const Badge = styled.span<{ $level: 'met' | 'emailed' | 'new' | 'here' }>`
  display: inline-block; margin-top: 2px; padding: 2px 8px; border-radius: 999px; font-size: 11px;
  background: ${({ $level }) => ($level === 'new' ? 'var(--pure-info-muted, rgba(79, 88, 168, .12))' : $level === 'here' ? 'var(--pp-green-wash)' : 'var(--pure-success-muted, rgba(63, 122, 69, .13))')};
  color: ${({ $level }) => ($level === 'new' ? 'var(--pure-info-text, #3d4590)' : $level === 'here' ? 'var(--pp-accent-text)' : 'var(--pure-success-text, #2f6135)')};
`
const StarButton = styled.button<{ $on: boolean; $inline: boolean; $large: boolean }>`
  ${({ $inline }) => ($inline ? '' : 'position: absolute; top: 10px; right: 10px; z-index: 1;')}
  width: ${({ $large }) => ($large ? 38 : 32)}px; height: ${({ $large }) => ($large ? 38 : 32)}px; flex: none; border-radius: 999px; display: grid; place-items: center;
  border: 1px solid ${({ $on }) => ($on ? 'color-mix(in srgb, var(--pp-accent) 40%, transparent)' : 'var(--pp-glass-line)')};
  background: ${({ $on }) => ($on ? 'var(--pp-green-wash)' : 'var(--pp-wash)')};
  color: ${({ $on }) => ($on ? 'var(--pp-accent)' : 'var(--pp-muted)')};
  &:hover { color: var(--pp-accent); }
`
const Tray = styled.div`
  display: flex; align-items: center; gap: 10px; padding: 11px 22px; border-top: 1px solid var(--pp-glass-line); flex-wrap: wrap;
  background: color-mix(in srgb, var(--pp-card) 40%, transparent);
  .meet { font-size: 13.5px; }
`
const Button = styled.button<{ $primary?: boolean; $soft?: boolean }>`
  display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 34px; padding: 0 14px; border-radius: 10px; font-size: 13px;
  border: 1px solid ${({ $primary, $soft }) => ($primary ? 'transparent' : $soft ? 'color-mix(in srgb, var(--pp-accent) 32%, transparent)' : 'var(--pp-glass-edge)')};
  background: ${({ $primary, $soft }) => ($primary ? 'var(--pp-accent-solid)' : $soft ? 'var(--pp-green-wash)' : 'var(--pp-card)')};
  color: ${({ $primary, $soft }) => ($primary ? 'var(--pp-on-solid)' : $soft ? 'var(--pp-accent-text)' : 'var(--pp-ink)')} !important;
  font-weight: ${({ $primary, $soft }) => ($primary || $soft ? 600 : 400)};
  box-shadow: ${({ $primary }) => ($primary ? '0 6px 16px color-mix(in srgb, var(--pp-accent) 28%, transparent)' : '0 1px 2px rgba(16, 22, 40, .05)')};
  &:hover:not(:disabled) { background: ${({ $primary, $soft }) => ($primary ? 'var(--pp-accent-solid-hover)' : $soft ? 'var(--pp-green-wash-deep)' : 'var(--pp-hover)')}; }
`
const Drawer = styled.aside`
  flex: 0 0 380px; display: flex; flex-direction: column; ${glassPanel}
  @media (max-width: 1100px) { flex-basis: 330px; }
`
const DrawerHead = styled.div`
  display: flex; align-items: center; gap: 14px; padding: 20px 20px 14px; border-bottom: 1px solid var(--pp-glass-line);
  .name { font-size: 17px; font-weight: 600; } .role { font-size: 13px; } .org { font-size: 12.5px; color: var(--pp-muted); }
`
const DrawerBody = styled.div` flex: 1; min-height: 0; overflow: auto; padding: 12px 20px; display: flex; flex-direction: column; gap: 14px; `
const Section = styled.div`
  display: flex; flex-direction: column; gap: 6px; font-size: 13px;
  .pills { display: flex; gap: 6px; flex-wrap: wrap; }
  .pill { padding: 3px 9px; border-radius: 999px; background: var(--pp-chip); font-size: 12px; color: var(--pp-chip-text); }
  .pill.quiet { background: none; border: 1px solid var(--pp-line); }
  .seen { display: flex; gap: 10px; font-size: 12.5px; } .seen .when { flex: 0 0 60px; color: var(--pp-muted); } .seen .app { flex: 0 0 64px; color: var(--pp-text-soft); } .seen .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .labelRow { display: flex; align-items: center; justify-content: space-between; }
  .stack { display: flex; align-items: center; } .stacked { margin-right: -4px; border-radius: 50%; box-shadow: 0 0 0 2px var(--pp-card); display: inline-flex; }
  .names { margin-left: 16px; font-size: 12.5px; color: var(--pp-text-soft); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  textarea { font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--pp-glass-line); background: var(--pp-wash); color: var(--pp-ink); resize: vertical; min-height: 64px; }
  textarea::placeholder { color: var(--pp-muted-2); }
  textarea:focus { outline: none; border-color: var(--pp-accent); background: var(--pp-card); }
  .met { display: flex; align-items: center; gap: 8px; font-size: 13px; } .met input { width: 16px; height: 16px; accent-color: var(--pp-accent); }
`
const Label = styled.span`
  font-family: var(--platform-typography-font-family-mono, ui-monospace, monospace); font-size: var(--pure-chrome-label-size, 10.5px); letter-spacing: var(--pure-chrome-label-tracking, .12em); text-transform: uppercase; color: var(--pp-muted);
`
const DrawerFoot = styled.div` display: flex; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--pp-glass-line); background: color-mix(in srgb, var(--pp-card) 40%, transparent); ${Button} { flex: 1; } `
