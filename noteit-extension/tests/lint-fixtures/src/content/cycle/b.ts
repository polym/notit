// expect: error noteit/no-import-cycle
import { a } from './a'

export const b = (): number => (typeof a === 'function' ? 1 : 0)
