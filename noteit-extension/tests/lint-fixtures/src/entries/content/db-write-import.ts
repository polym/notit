// expect: error no-restricted-imports
// Content entry code must send commands instead of importing core/db/write.
import { write } from '../../core/db/write.ts'
export const value = write
