// expect: error boundaries/dependencies
// features/highlight must not import another feature.
import { demo } from '../../demo/index.ts'
export const other = demo
