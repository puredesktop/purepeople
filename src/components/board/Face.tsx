import { styled } from 'styled-components'
import type { ContactRecord } from '../../types'

/** A steady hue per person, so a wall of faces is easy to tell apart. */
export function hueOf(text: string): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return Math.abs(hash) % 360
}
export const initialsOf = (name: string) => name.trim().split(/\s+/).filter(Boolean).map(word => word[0]!.toUpperCase()).slice(0, 2).join('') || '?'

/** The person's photo, or their initials on a soft tint of their own. */
export function Face({ contact, size, ring }: { contact: Pick<ContactRecord, 'name' | 'avatarUrl'>; size: number; ring?: boolean }): React.ReactElement {
  const hue = hueOf(contact.name)
  return contact.avatarUrl
    ? <Img src={contact.avatarUrl} alt="" $size={size} $ring={!!ring} draggable={false} />
    : <Initials aria-hidden="true" $size={size} $hue={hue} $ring={!!ring}>{initialsOf(contact.name)}</Initials>
}

const ringCss = 'box-shadow: 0 0 0 3px var(--pp-card), 0 0 0 5px var(--pp-accent);'
const Img = styled.img<{ $size: number; $ring: boolean }>`
  width: ${({ $size }) => $size}px; height: ${({ $size }) => $size}px; flex: none; border-radius: 50%; object-fit: cover;
  ${({ $ring }) => ($ring ? ringCss : '')}
`
const Initials = styled.span<{ $size: number; $hue: number; $ring: boolean }>`
  width: ${({ $size }) => $size}px; height: ${({ $size }) => $size}px; flex: none; border-radius: 50%;
  display: inline-grid; place-items: center; font-family: var(--platform-typography-font-family-content); font-size: ${({ $size }) => Math.round($size * ($size < 34 ? 0.34 : 0.38))}px; letter-spacing: ${({ $size }) => ($size < 34 ? "-0.02em" : "0")};
  background: oklch(0.93 0.035 ${({ $hue }) => $hue}); color: oklch(0.42 0.09 ${({ $hue }) => $hue});
  ${({ $ring }) => ($ring ? ringCss : '')}
`
