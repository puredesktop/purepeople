import { styled } from 'styled-components'

export const Action = styled.button`
  font: inherit;
  color: var(--pp-ink);
  background: var(--pp-paper-raised);
  border: 1px solid var(--pp-wash-strong);
  border-radius: 5px;
  padding: 6px 10px;
  cursor: pointer;
  &:disabled { opacity: .55; cursor: default; }
  &:focus-visible { outline: 2px solid var(--pp-accent-solid); }
`
export const Stack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
`
export const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`
export const Field = styled.input`
  font: inherit;
  color: var(--pp-ink);
  background: var(--pp-paper-raised);
  border: 1px solid var(--pp-wash-strong);
  border-radius: 5px;
  padding: 8px;
  min-width: 0;
  flex: 1;
`
