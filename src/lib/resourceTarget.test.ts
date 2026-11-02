import { describe, expect, it } from 'vitest'
import { resourceTarget } from './resourceTarget'

describe('what another app asked PurePeople to open', () => {
  it('reads a person or a list, plain or as the shell delivers it', () => {
    expect(resourceTarget('contact/c-1')).toEqual({ kind: 'contact', id: 'c-1' })
    expect(resourceTarget('purescience://people/list/list_a')).toEqual({ kind: 'list', id: 'list_a' })
    expect(resourceTarget('purescience://people/contact/a%40b.example')).toEqual({ kind: 'contact', id: 'a@b.example' })
  })
  it('ignores anything else', () => {
    expect(resourceTarget('/Users/me/file.csv')).toBeNull()
    expect(resourceTarget('compose/1')).toBeNull()
    expect(resourceTarget(null)).toBeNull()
  })
})
