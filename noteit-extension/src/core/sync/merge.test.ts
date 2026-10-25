import { describe, expect, it } from 'vitest'
import lww from '../../../tests/fixtures/lww-cases.json'
import { mergeAction, wins } from './merge.ts'

describe('core/sync/merge wins (shared LWW cases)', () => {
  it.each(lww.cases)('$name', ({ stored, incoming, winner }) => {
    expect(wins(incoming, stored)).toBe(winner === 'incoming')
    // The rule is antisymmetric except on exact ties, where neither side wins.
    const tie = incoming.editedAt === stored.editedAt && incoming.deviceId === stored.deviceId
    expect(wins(stored, incoming)).toBe(!tie && winner === 'stored')
  })
})

describe('core/sync/merge mergeAction', () => {
  const local = { editedAt: 100, deviceId: 'device-a' }
  it('absent locally -> insert', () => expect(mergeAction(local, undefined)).toBe('insert'))
  it('remote newer -> overwrite', () => expect(mergeAction({ editedAt: 101, deviceId: 'device-a' }, local)).toBe('overwrite'))
  it('remote older -> keep', () => expect(mergeAction({ editedAt: 99, deviceId: 'device-z' }, local)).toBe('keep'))
  it('equal -> keep', () => expect(mergeAction({ ...local }, local)).toBe('keep'))
})
