// expect: error noteit/no-raw-text-offset
export function quoteLength(range: Range): number {
  return range.toString().length
}
