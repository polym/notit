// expect: error boundaries/dependencies
// Entries may only reach a feature through features/<x>/index.ts.
import { internal } from '../../features/demo/internal.ts'
export const value = internal
