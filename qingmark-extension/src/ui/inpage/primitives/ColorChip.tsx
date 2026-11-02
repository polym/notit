/** @jsxImportSource preact */
// color-chip (DESIGN.md "Components"): a 30px pill with a 14px dot and the color's name, tinted with
// the color itself, so the meaning of each color is readable without hovering. The current color gets
// an inset ring in the color and a stronger tint.
import type { ColorName } from '../../../core/model/index.ts'
import { colorLabel, solidColorVar } from '../../palette.ts'

export interface ColorChipProps {
  color: ColorName
  selected?: boolean
  onSelect: (color: ColorName) => void
}

export function ColorChip({ color, selected = false, onSelect }: ColorChipProps) {
  const label = colorLabel(color)
  return (
    <button
      type="button"
      class="nt-chip"
      data-color={color}
      aria-label={label}
      aria-pressed={selected}
      style={{ '--nt-chip': solidColorVar(color) }}
      onClick={() => onSelect(color)}
    >
      <span class="nt-chip-dot" aria-hidden="true" />
      {label}
    </button>
  )
}
