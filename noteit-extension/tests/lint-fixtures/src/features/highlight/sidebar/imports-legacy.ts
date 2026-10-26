// expect: error boundaries/dependencies
// Features never reach legacy directories (the Story 3.3 sidepanel exception was removed in Story 3.10).
import { value } from '../../../content/legacy-any.ts'
export const legacy = value
