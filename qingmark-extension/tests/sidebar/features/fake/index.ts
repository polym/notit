// Fake second side panel module (Story 3.3 module boundary test). Lives only in the test tree: it
// proves a new module plugs into the shell without touching src/features/highlight.
import type { SidebarModule } from '../../../../src/ui/sidebar/shell/index.ts'
import { FakeIcon, FakeView } from './FakeView.tsx'

export const fakeModule: SidebarModule = {
  id: 'fake',
  label: 'Fake',
  icon: FakeIcon,
  View: FakeView,
}
