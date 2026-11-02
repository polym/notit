// expect: none
// Feature background code may import core/db/write.
import { write } from '../../../core/db/write.ts'
export const value = write
