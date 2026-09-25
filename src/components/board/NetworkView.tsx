import { useEffect, useMemo, useRef, useState } from 'react'
import { styled } from 'styled-components'
import { networkAround, pathTo, tieLabel, tieWeight } from '../../lib/network'
import { requestMailCompose } from '../../lib/peopleBridge'
import type { PeopleStore } from '../../types'
import { Face } from './Face'

// Room kept clear around the drawing: half a node's width at the sides, the
// name and org labels under the lowest node, and the legend.
const PAD = { x: 78, top: 44, bottom: 96 } as const
const shortDate = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '' }

/**
 * A person's network, drawn from the threads and meetings they share with
 * others: direct ties in the first ring, the people those know in the
 * second. Thicker lines mean more shared threads. Choosing someone shows the
 * path to them and what connects each step, so an introduction can be asked
 * for by the person who knows them.
 */
export function NetworkView({ store, centerId: initialCenter, scopeIds, scopeLabel, onClose, onOpenProfile }: {
  store: PeopleStore
  centerId: string
  /** The people on the board it was opened from, if any. */
  scopeIds?: string[]
  scopeLabel?: string
  onClose: () => void
  onOpenProfile: (contactId: string) => void
}): React.ReactElement {
  const [centerId, setCenterId] = useState(initialCenter)
  const [selectedId, setSelectedId] = useState(initialCenter)
  const [onlyBoard, setOnlyBoard] = useState(false)
  const [depth, setDepth] = useState<1 | 2>(2)
  const [status, setStatus] = useState<string | null>(null)
  const scope = useMemo(() => (onlyBoard && scopeIds ? new Set([...scopeIds, centerId]) : undefined), [onlyBoard, scopeIds, centerId])
  const network = useMemo(() => { try { return networkAround(store, centerId, { depth, scope }) } catch { return null } }, [store, centerId, depth, scope])
  const board = useMemo(() => new Set(scopeIds ?? []), [scopeIds])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => { if (network && !network.nodes.some(n => n.contact.id === selectedId)) setSelectedId(centerId) }, [network, selectedId, centerId])
  const canvasRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 1000, h: 720 })
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const measure = () => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) setBox({ w: r.width, h: r.height }) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { if (!status) return; const t = setTimeout(() => setStatus(null), 4200); return () => clearTimeout(t) }, [status])

  if (!network) return <Scrim><Sheet><Empty>That person is no longer in PurePeople. <button type="button" onClick={onClose}>Close</button></Empty></Sheet></Scrim>
  const center = network.nodes[0]!.contact
  // Rings are ellipses fitted to the pane, so a wide window spreads people
  // sideways instead of shrinking everyone into a circle in the middle.
  const cx = box.w / 2, cy = PAD.top + (box.h - PAD.top - PAD.bottom) / 2
  const outerY = Math.max(60, (box.h - PAD.top - PAD.bottom) / 2)
  const outerX = Math.max(80, Math.min(box.w / 2 - PAD.x, outerY * 1.7))
  const scale = depth === 2 ? 0.6 : 0.85
  const radii = { 0: { x: 0, y: 0 }, 1: { x: outerX * scale, y: outerY * scale }, 2: { x: outerX, y: outerY } } as const
  const pos = new Map(network.nodes.map(n => { const a = n.angle * Math.PI / 180, r = radii[n.ring]; return [n.contact.id, { x: cx + Math.cos(a) * r.x, y: cy + Math.sin(a) * r.y }] }))
  const selectedNode = network.nodes.find(n => n.contact.id === selectedId) ?? network.nodes[0]!
  const sel = selectedNode.contact
  const path = pathTo(network, sel.id)
  const nameOf = (id: string) => network.nodes.find(n => n.contact.id === id)?.contact
  const first = (id: string) => nameOf(id)?.name.split(' ')[0] ?? ''
  const selTies = network.edges.filter(e => e.a === sel.id || e.b === sel.id).map(e => ({ other: e.a === sel.id ? e.b : e.a, tie: e.tie })).sort((x, y) => tieWeight(y.tie) - tieWeight(x.tie))
  const introducer = path.length > 2 ? path[path.length - 2]! : null
  const maxWeight = Math.max(1, ...network.edges.map(e => tieWeight(e.tie)))
  const onPath = new Set(path.slice(1).map((id, i) => [path[i], id].sort().join('|')))
  const askIntro = () => {
    const by = nameOf(introducer!)!
    void requestMailCompose([{ name: by.name, email: by.emails[0] ?? '' }]).then(() => setStatus(`Opening a draft to ${by.name} in Mail: ask for an introduction to ${sel.name}.`)).catch(() => setStatus('Could not reach Mail.'))
  }
  const ring1 = network.nodes.filter(n => n.ring === 1).length
  return (
    <Scrim onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <Sheet role="dialog" aria-label={`${center.name}'s network`}>
        <Main>
          <Head>
            <button type="button" className="back" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>{scopeLabel ?? 'Back'}
            </button>
            <span className="rule" />
            <div style={{ minWidth: 0 }}><div className="title">{center.name}’s network</div><div className="sub">From the email threads and meetings they share with others{network.hidden ? ` · ${network.hidden} more not drawn` : ''}</div></div>
            <span className="sp" />
            {scopeIds ? <Segmented role="group" aria-label="Who to show"><button type="button" aria-pressed={onlyBoard} onClick={() => setOnlyBoard(true)}>{scopeLabel ? 'On this board' : 'Board'}</button><button type="button" aria-pressed={!onlyBoard} onClick={() => setOnlyBoard(false)}>All contacts</button></Segmented> : null}
            <Segmented role="group" aria-label="How far"><button type="button" aria-pressed={depth === 1} onClick={() => setDepth(1)}>Direct</button><button type="button" aria-pressed={depth === 2} onClick={() => setDepth(2)}>Two steps</button></Segmented>
          </Head>
          <Canvas ref={canvasRef}>
            {ring1 === 0 ? <Empty>No shared threads or meetings recorded for {center.name.split(' ')[0]} yet. Connections appear as Mail and Calendar see who is on the same threads and meetings.</Empty> : null}
            <svg className="drawing" viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true">
              <ellipse cx={cx} cy={cy} rx={radii[1].x} ry={radii[1].y} className="ring" />
              {depth === 2 ? <ellipse cx={cx} cy={cy} rx={radii[2].x} ry={radii[2].y} className="ring" /> : null}
              {network.edges.map(e => {
                const a = pos.get(e.a)!, b = pos.get(e.b)!, hot = e.a === sel.id || e.b === sel.id || onPath.has([e.a, e.b].sort().join('|'))
                return <line key={`${e.a}|${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={hot ? 'edge hot' : 'edge'} strokeWidth={1.2 + (tieWeight(e.tie) / maxWeight) * 6} />
              })}
            </svg>
            {network.nodes.map(n => {
              const p = pos.get(n.contact.id)!, size = n.ring === 0 ? 70 : n.ring === 1 ? 48 : 38
              const faded = !!scopeIds && !onlyBoard && !board.has(n.contact.id) && n.ring !== 0
              return (
                <Node key={n.contact.id} type="button" aria-pressed={n.contact.id === sel.id} aria-label={`${n.contact.name}${n.contact.org ? `, ${n.contact.org}` : ''}`}
                  style={{ left: p.x, top: p.y - size / 2 }} $faded={faded}
                  onClick={() => setSelectedId(n.contact.id)} onDoubleClick={() => { setCenterId(n.contact.id); setSelectedId(n.contact.id) }}>
                  <Face contact={n.contact} size={size} ring={n.contact.id === sel.id} />
                  <span className={n.contact.id === sel.id ? 'name on' : 'name'}>{n.contact.name.split(' ')[0]}</span>
                  {n.contact.org && (n.ring === 0 || n.contact.id === sel.id || (n.ring === 1 && ring1 <= 7)) ? <span className="org">{n.contact.org}</span> : null}
                </Node>
              )
            })}
            <Legend>
              {scopeIds ? <><span><i className="solid" />On the board</span><span><i className="faded" />Other contacts</span></> : null}
              <span><svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg>more shared threads</span>
              <span>Double-click someone to centre on them</span>
            </Legend>
          </Canvas>
        </Main>
        <Side aria-label="Connection details">
          <SideHead>
            <Face contact={sel} size={54} />
            <div style={{ minWidth: 0 }}>
              <div className="name">{sel.name}</div>
              {sel.title ? <div className="role">{sel.title}</div> : null}
              <div className="org">{[sel.org, scopeIds ? (board.has(sel.id) ? 'on the board' : 'not on the board') : ''].filter(Boolean).join(' · ')}</div>
            </div>
          </SideHead>
          <SideBody>
            {path.length > 1 ? (
              <div className="block">
                <Label>Path from {first(centerId)}</Label>
                <div className="path">{path.map((id, i) => <span key={id} className="stepWrap"><span className={id === sel.id ? 'step on' : 'step'}>{first(id)}</span>{i < path.length - 1 ? <span className="arrow">→</span> : null}</span>)}</div>
              </div>
            ) : null}
            <div className="block">
              <Label>{sel.id === centerId ? 'Strongest ties' : 'What connects them'}</Label>
              {selTies.length ? selTies.slice(0, 6).map(({ other, tie }) => {
                const o = nameOf(other)!
                return (
                  <button key={other} type="button" className="tie" onClick={() => setSelectedId(other)}>
                    <Face contact={o} size={28} />
                    <span className="text"><b>{o.name}</b><span>{tieLabel(tie)}{tie.recent[0]?.subject ? ` · ${tie.recent[0].subject}` : ''}</span><span className="when">{shortDate(tie.lastAt)}</span></span>
                  </button>
                )
              }) : <Muted>No shared threads with the people drawn here.</Muted>}
            </div>
            <Advice>
              {sel.id === centerId
                ? `${center.name.split(' ')[0]} shares threads with ${ring1} ${ring1 === 1 ? 'person' : 'people'} here${depth === 2 ? `, and reaches ${network.nodes.filter(n => n.ring === 2).length} more through them` : ''}.`
                : introducer
                  ? `${first(introducer)} shares threads with ${sel.name.split(' ')[0]}: ask ${first(introducer)} for an introduction.`
                  : `${sel.name.split(' ')[0]} shares threads with ${center.name.split(' ')[0]}: mention it when you meet.`}
            </Advice>
          </SideBody>
          <SideFoot>
            {status ? <Muted role="status">{status}</Muted> : null}
            {introducer ? <Button type="button" $primary onClick={askIntro}>Ask {first(introducer)} for an intro</Button> : null}
            <div className="row">
              <Button type="button" disabled={sel.id === centerId} onClick={() => { setCenterId(sel.id) }}>Centre on {sel.name.split(' ')[0]}</Button>
              <Button type="button" onClick={() => { onClose(); onOpenProfile(sel.id) }}>Open profile</Button>
            </div>
          </SideFoot>
        </Side>
      </Sheet>
    </Scrim>
  )
}

/* Glass like the board: the desk behind a light frost, the drawing on one
   frosted panel, the details on another, near-solid labels and cards. */
const Scrim = styled.div`
  position: fixed; inset: 0; z-index: 70; display: flex;
  padding: 18px 18px 78px; /* the bottom clears the shell dock, which floats over the app */
  background: color-mix(in srgb, var(--pp-panel) 45%, transparent);
  backdrop-filter: blur(18px) saturate(120%); -webkit-backdrop-filter: blur(18px) saturate(120%);
`
const Sheet = styled.section`
  flex: 1; min-width: 0; display: flex; gap: 12px;
  font-family: var(--platform-typography-font-family); color: var(--pp-ink);
  button { font: inherit; color: inherit; cursor: pointer; } button:disabled { cursor: default; opacity: .5; }
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
  display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--pp-glass-line); flex-wrap: wrap;
  .back { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; font-size: 13px; padding: 4px 8px; border-radius: 8px; color: var(--pp-text-soft); }
  .back:hover { background: var(--pp-hover); color: var(--pp-ink); }
  .rule { width: 1px; height: 22px; background: var(--pp-glass-line); }
  .title { font-size: 17px; font-weight: 600; } .sub { font-size: 12.5px; color: var(--pp-muted); }
`
const Segmented = styled.div`
  display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--pp-wash);
  button { height: 28px; padding: 0 12px; border-radius: 999px; border: 0; background: none; font-size: 12.5px; color: var(--pp-muted); }
  button[aria-pressed='true'] { background: var(--pp-card); color: var(--pp-ink); font-weight: 600; box-shadow: 0 1px 2px rgba(16, 22, 40, .10); }
`
const Canvas = styled.div`
  position: relative; flex: 1; min-height: 0; overflow: hidden;
  svg.drawing { position: absolute; inset: 0; width: 100%; height: 100%; }
  .ring { fill: none; stroke: var(--pp-glass-edge-strong); stroke-opacity: .5; stroke-dasharray: 3 6; }
  .edge { stroke: color-mix(in srgb, var(--pp-muted) 42%, transparent); stroke-linecap: round; }
  .edge.hot { stroke: var(--pp-accent); }
`
const Node = styled.button<{ $faded: boolean }>`
  position: absolute; width: 124px; margin-left: -62px; border: 0; background: none; padding: 0; display: flex; flex-direction: column; align-items: center; gap: 3px;
  opacity: ${({ $faded }) => ($faded ? 0.55 : 1)};
  .name { font-size: 12px; font-weight: 600; line-height: 1.2; padding: 2px 7px; border-radius: 7px; background: var(--pp-card); box-shadow: 0 1px 2px rgba(16, 22, 40, .08); }
  .name.on { background: var(--pp-accent-solid); color: var(--pp-on-solid); }
  .org { max-width: 120px; font-size: 10.5px; line-height: 1.2; color: var(--pp-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &:focus-visible { outline: 2px solid var(--pp-accent); outline-offset: 4px; border-radius: 12px; }
`
const Legend = styled.div`
  position: absolute; left: 16px; bottom: 14px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; padding: 7px 12px; border-radius: 12px;
  background: var(--pp-card); border: 1px solid var(--pp-glass-edge); box-shadow: 0 6px 18px rgba(16, 22, 40, .06);
  font-size: 12px; color: var(--pp-text-soft);
  span { display: inline-flex; align-items: center; gap: 6px; }
  i { width: 12px; height: 12px; border-radius: 50%; display: inline-block; } i.solid { background: var(--pp-accent); } i.faded { background: var(--pp-accent); opacity: .45; }
`
const Empty = styled.div` position: absolute; inset: 0; display: grid; place-items: center; padding: 40px; text-align: center; color: var(--pp-muted); font-size: 14px; z-index: 1; `
const Side = styled.aside` flex: 0 0 360px; display: flex; flex-direction: column; ${glassPanel} `
const SideHead = styled.div`
  display: flex; gap: 12px; align-items: center; padding: 18px 20px 14px; border-bottom: 1px solid var(--pp-glass-line);
  .name { font-size: 17px; font-weight: 600; } .role { font-size: 13px; } .org { font-size: 12.5px; color: var(--pp-muted); }
`
const SideBody = styled.div`
  flex: 1; min-height: 0; overflow: auto; padding: 14px 20px; display: flex; flex-direction: column; gap: 14px;
  .block { display: flex; flex-direction: column; gap: 6px; }
  .path { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; }
  .stepWrap { display: inline-flex; align-items: center; gap: 6px; }
  .step { padding: 3px 9px; border-radius: 999px; background: var(--pp-chip); color: var(--pp-chip-text); } .step.on { background: var(--pp-accent-solid); color: var(--pp-on-solid); }
  .arrow { color: var(--pp-muted); }
  .tie { display: flex; gap: 10px; align-items: flex-start; padding: 9px 11px; border-radius: 12px; border: 1px solid var(--pp-glass-edge); background: var(--pp-card); text-align: left; box-shadow: 0 1px 2px rgba(16, 22, 40, .05); }
  .tie:hover { background: var(--pp-hover); }
  .text { display: flex; flex-direction: column; gap: 1px; min-width: 0; font-size: 12.5px; } .text b { font-size: 13px; } .text .when { color: var(--pp-muted); font-size: 11.5px; }
`
const Label = styled.span` font-family: var(--platform-typography-font-family-mono, ui-monospace, monospace); font-size: var(--pure-chrome-label-size, 10.5px); letter-spacing: var(--pure-chrome-label-tracking, .12em); text-transform: uppercase; color: var(--pp-muted); `
const Muted = styled.span` font-size: 12.5px; color: var(--pp-muted); `
const Advice = styled.div` padding: 12px 14px; border-radius: 12px; background: var(--pp-green-wash); color: var(--pp-ink); font-size: 13px; line-height: 1.45; `
const SideFoot = styled.div` display: flex; flex-direction: column; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--pp-glass-line); background: color-mix(in srgb, var(--pp-card) 40%, transparent); .row { display: flex; gap: 8px; } .row > * { flex: 1; } `
const Button = styled.button<{ $primary?: boolean }>`
  height: 36px; padding: 0 14px; border-radius: 10px; font-size: 13px;
  border: 1px solid ${({ $primary }) => ($primary ? 'transparent' : 'var(--pp-glass-edge)')};
  background: ${({ $primary }) => ($primary ? 'var(--pp-accent-solid)' : 'var(--pp-card)')};
  color: ${({ $primary }) => ($primary ? 'var(--pp-on-solid)' : 'var(--pp-ink)')} !important; font-weight: ${({ $primary }) => ($primary ? 600 : 400)};
  box-shadow: ${({ $primary }) => ($primary ? '0 6px 16px color-mix(in srgb, var(--pp-accent) 28%, transparent)' : '0 1px 2px rgba(16, 22, 40, .05)')};
  &:hover:not(:disabled) { background: ${({ $primary }) => ($primary ? 'var(--pp-accent-solid-hover)' : 'var(--pp-hover)')}; }
`
