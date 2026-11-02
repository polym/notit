import { describe, expect, it } from 'vitest'
import { legacyColorToName, legacyHexForName } from './legacy.ts'

describe('legacyColorToName', () => {
  // architecture.md Q50 table.
  it.each([
    ['#ffeb3b', 'yellow'],
    ['#a5d6a7', 'green'],
    ['#90caf9', 'blue'],
    ['#ef9a9a', 'orange'],
    ['#e1bee7', 'yellow'],
  ])('maps legacy hex %s to %s', (input, expected) => {
    expect(legacyColorToName(input)).toBe(expected)
  })

  it.each([
    ['#FFEB3B', 'yellow'],
    ['#A5D6A7', 'green'],
    ['#90CaF9', 'blue'],
    ['#EF9A9A', 'orange'],
    ['#E1BEE7', 'yellow'],
    ['  #90caf9  ', 'blue'],
  ])('is case-insensitive and trims: %s -> %s', (input, expected) => {
    expect(legacyColorToName(input)).toBe(expected)
  })

  it.each([
    // Exact legacy values in rgb() form.
    ['rgb(255, 235, 59)', 'yellow'],
    ['rgb(165, 214, 167)', 'green'],
    ['rgb(144, 202, 249)', 'blue'],
    ['rgb(239, 154, 154)', 'orange'],
    ['rgb(225, 190, 231)', 'yellow'],
    // Drifted values: nearest legacy value by RGB Euclidean distance.
    ['rgb(250, 230, 70)', 'yellow'],
    ['rgb(160, 210, 160)', 'green'],
    ['rgb(140, 200, 255)', 'blue'],
    ['rgb(240, 150, 150)', 'orange'],
    ['rgb(220, 185, 235)', 'yellow'],
    ['rgb(0, 0, 255)', 'blue'],
    ['rgb(255, 0, 0)', 'orange'],
    ['rgb(0, 255, 0)', 'green'],
    // Formatting variants.
    ['RGB(239,154,154)', 'orange'],
    ['rgb( 144 ,202, 249 )', 'blue'],
    ['rgba(165, 214, 167, 0.5)', 'green'],
  ])('maps %s to nearest legacy color %s', (input, expected) => {
    expect(legacyColorToName(input)).toBe(expected)
  })

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['null', null],
    ['undefined', undefined],
    ['unknown hex', '#123456'],
    ['short hex', '#fe3'],
    ['color keyword', 'red'],
    ['out-of-range rgb', 'rgb(300, 0, 0)'],
    ['malformed rgb', 'rgb(1, 2)'],
    ['negative rgb', 'rgb(-1, 0, 0)'],
  ])('returns yellow for %s', (_label, input) => {
    expect(legacyColorToName(input)).toBe('yellow')
  })
})

describe('legacyHexForName', () => {
  it.each([
    ['yellow', '#ffeb3b'],
    ['green', '#a5d6a7'],
    ['blue', '#90caf9'],
    ['orange', '#ef9a9a'],
  ] as const)('paints %s as %s and round-trips through legacyColorToName', (name, hex) => {
    expect(legacyHexForName(name)).toBe(hex)
    expect(legacyColorToName(legacyHexForName(name))).toBe(name)
  })
})
