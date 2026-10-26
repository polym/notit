// expect: none
// Entries may import a feature through its public index.ts.
import { demo } from '../../features/demo/index.ts'
export const entry = demo
