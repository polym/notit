// expect: error no-restricted-imports
// Non-background core modules must not import core/db/write via a relative specifier either.
import { write } from '../db/write.ts'
export const value = write
