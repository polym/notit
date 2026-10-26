// Side panel module of the highlight feature (Story 3.3, FR25). Stories 3.5 and 3.7 replaced the
// current page and all-sites lists; Story 3.10 moved sync status and the account area into the shell.
import type { SidebarModule } from '../../../ui/sidebar/shell/index.ts'
import { strings } from '../../../ui/strings.ts'
import { HighlightIcon } from './HighlightIcon.tsx'
import { HighlightView } from './HighlightView.tsx'

export const highlightModule: SidebarModule = {
  id: 'highlight',
  label: strings.moduleHighlight,
  icon: HighlightIcon,
  View: HighlightView,
}
