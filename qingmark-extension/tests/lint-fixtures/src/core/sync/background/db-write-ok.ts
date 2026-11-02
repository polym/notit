// expect: none
// Background code under src/core/**/background may import core/db/write.
import { write } from '../../db/write.ts'
export const value = write
