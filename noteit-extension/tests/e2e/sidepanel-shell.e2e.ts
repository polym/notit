// Story 3.3: the side panel is a module container. With only the highlight module injected, the
// module tab row still shows the single "highlight" tab, and the layout follows DESIGN.md option A:
// header -> module tab row -> content.
import { test, expect } from './fixtures/extension.ts'
import { resetLocalData } from '../helpers/local-db.ts'
import { strings } from '../../src/ui/strings.ts'

test('a single module still shows its tab, in header -> tabs -> content order', async ({
  serviceWorker,
  openSidePanel,
  externalRequests,
}) => {
  await resetLocalData(serviceWorker)
  const panel = await openSidePanel()

  const tablist = panel.getByRole('tablist', { name: strings.moduleTabs })
  await expect(tablist).toBeVisible()
  const tabs = tablist.getByRole('tab')
  await expect(tabs).toHaveCount(1)
  await expect(tabs.first()).toHaveText(strings.moduleHighlight)
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')

  // Option A order: the shell's direct children are header, module tabs, content.
  const order = await panel
    .getByTestId('sidebar-shell')
    .evaluate((shell) => [...shell.children].map((e) => e.getAttribute('data-testid')))
  expect(order).toEqual(['sidebar-header', 'module-tabs', 'module-content'])

  // Visual order matches DOM order.
  const top = async (id: string) => (await panel.getByTestId(id).boundingBox())!.y
  expect(await top('sidebar-header')).toBeLessThan(await top('module-tabs'))
  expect(await top('module-tabs')).toBeLessThan(await top('module-content'))

  // The highlight module View (legacy list, signed in) renders inside the content area.
  const content = panel.getByRole('tabpanel', { name: strings.moduleHighlight })
  await expect(content.getByRole('button', { name: strings.viewCurrentPage })).toBeVisible()

  expect(externalRequests).toEqual([])
})
