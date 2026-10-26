// expect: error boundaries/dependencies
// core must not import features.
import { demo } from '../../features/demo/index.ts'
export const value = demo
