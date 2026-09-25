/**
 * Sanitizer for the rich-text notes editor. Notes are user-authored, but
 * pasted content can carry anything — a strict allowlist walker keeps only
 * basic formatting: paragraphs, line breaks, bold/italic/underline, lists,
 * and http(s) links. Everything else is unwrapped (content kept) or, for
 * script-bearing containers, removed with its content.
 */

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ul',
  'ol',
  'li',
  'a',
  'div',
])

const REMOVE_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
  'title',
  'textarea',
  'xmp',
  'plaintext',
])

function isAllowedHref(value: string): boolean {
  const compact = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0020]/g, '')
    .toLowerCase()
  return compact.startsWith('https:') || compact.startsWith('http:')
}

function sanitizeNode(node: Node): void {
  if (node.nodeType === node.TEXT_NODE) return
  if (node.nodeType !== node.ELEMENT_NODE) {
    node.parentNode?.removeChild(node)
    return
  }
  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (REMOVE_WITH_CONTENT.has(tag)) {
    element.remove()
    return
  }
  if (!ALLOWED_TAGS.has(tag)) {
    for (const child of [...element.childNodes]) sanitizeNode(child)
    const parent = element.parentNode
    if (!parent) return
    while (element.firstChild) parent.insertBefore(element.firstChild, element)
    element.remove()
    return
  }
  for (const attr of [...element.attributes]) {
    const name = attr.name.toLowerCase()
    if (tag === 'a' && name === 'href' && isAllowedHref(attr.value)) continue
    element.removeAttribute(attr.name)
  }
  if (tag === 'a' && element.hasAttribute('href')) {
    element.setAttribute('target', '_blank')
    element.setAttribute('rel', 'noopener noreferrer')
  }
  for (const child of [...element.childNodes]) sanitizeNode(child)
}

export function sanitizeNotesHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  for (const child of [...doc.body.childNodes]) sanitizeNode(child)
  return doc.body.innerHTML
}

/** Plain-text mirror of rich notes, for search and agent tools. */
export function notesTextFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  for (const element of doc.body.querySelectorAll('br')) element.replaceWith(doc.createTextNode('\n'))
  for (const element of doc.body.querySelectorAll('p, div, li')) element.append(doc.createTextNode('\n'))
  return (doc.body.textContent ?? '').replace(/ /g, ' ').trim()
}
