// expect: error qingmark/no-import-cycle
import { b } from './b'

export const a = (): number => b() + 1
