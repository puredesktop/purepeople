/**
 * What another app asked PurePeople to open: `contact/<id>` or `list/<id>`, as PureOutreach links back to the record a
 * person or list came from. The shell delivers it as `purescience://<app>/<id>`. Anything else is not a target.
 */
export type ResourceTarget = { kind: 'contact' | 'list'; id: string }

export function resourceTarget(path: string | null | undefined): ResourceTarget | null {
  const match = path?.match(/^(?:purescience:\/\/[^/]+\/)?(contact|list)\/(.+)$/)
  if (!match) return null
  return { kind: match[1] as ResourceTarget['kind'], id: decodeURIComponent(match[2] as string) }
}
