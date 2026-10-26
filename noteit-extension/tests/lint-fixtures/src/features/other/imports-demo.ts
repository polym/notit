// expect: error boundaries/dependencies
// Features must not import each other.
import { demo } from '../demo/index.ts'
export const value = demo
