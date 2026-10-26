// expect: none
// The rule only applies to anchoring/ and inpage/.
export function quote(range: Range): string {
  return range.toString()
}
