// expect: error boundaries/dependencies
// The side panel shell receives modules through SidebarModule and must not import any feature.
import { demo } from '../../../features/demo/index.ts'
export const shellValue = demo
