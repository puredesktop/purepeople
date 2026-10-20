import { describe, expect, it } from 'vitest'
import { contactAgentRefs, listAgentRefs, orgAgentRefs, searchBoardAgentRefs } from './agentRefs'

const refs = (props: { 'data-agent-ref': string }) => props['data-agent-ref'].split(' ')

describe('agent activity refs', () => {
  it('names a person by id and every address, as the tools take them', () => {
    const props = contactAgentRefs({ id: 'ana@example.org', name: 'Ana Ruiz', emails: ['ana@example.org', 'Ana.R@Work.example'] })
    expect(props['data-agent-label']).toBe('Ana Ruiz')
    expect(refs(props)).toEqual(expect.arrayContaining([
      'ana@example.org', 'Ana.R@Work.example', 'ana.r@work.example',
      'idOrEmail:ana@example.org', 'contact:ana.r@work.example', 'email:ana@example.org', 'emails:ana.r@work.example',
      'survivorId:ana@example.org', 'absorbedId:ana@example.org', 'id:ana@example.org',
    ]))
  })

  it('names an org by id, name and aliases, and leaves out values with spaces', () => {
    const props = orgAgentRefs({ id: 'plaid', name: 'Plaid', aliases: ['Plaid Inc'] })
    expect(refs(props)).toEqual(expect.arrayContaining(['plaid', 'Plaid', 'idOrName:Plaid', 'name:plaid', 'org:Plaid', 'id:plaid']))
    expect(props['data-agent-ref']).not.toMatch(/Inc/)
  })

  it('names a list by id and name, and a search board by its query', () => {
    expect(refs(listAgentRefs({ id: 'list_investors_1', name: 'Investors' }))).toEqual(expect.arrayContaining(['list_investors_1', 'Investors', 'list:list_investors_1', 'list:investors', 'name:Investors']))
    expect(refs(searchBoardAgentRefs('EBL2026', '“EBL2026”'))).toEqual(['EBL2026', 'query:EBL2026'])
  })
})
