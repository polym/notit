// expect: none
// Legacy directories may import a feature's public index.ts (message protocol) while migrating.
import { demo } from '../features/demo/index.ts'
export const value = demo
