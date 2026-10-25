// Side panel all-sites helpers (Story 3.7): switch to the view and expand one page group. The most
// recent group starts expanded, so a group is clicked only when it is collapsed.
import type { Locator, Page } from '@playwright/test'
import { expect } from './extension.ts'
import { strings } from '../../../src/ui/strings.ts'

/** Switches the panel to the all-sites view and returns the view. */
export async function openAllSites(panel: Page): Promise<Locator> {
  await panel.getByRole('button', { name: strings.viewAllSites }).click()
  const view = panel.getByTestId('all-sites-view')
  await expect(view).toBeVisible()
  return view
}

/** The page group whose header shows `title`. */
export function pageGroup(view: Locator, title: string): Locator {
  return view.getByTestId('page-group').filter({ has: view.page().getByTestId('page-group-title').getByText(title, { exact: true }) })
}

/** Expands the page group titled `title` if it is collapsed; returns the group. */
export async function expandGroup(view: Locator, title: string): Promise<Locator> {
  const group = pageGroup(view, title).first()
  const header = group.getByTestId('page-group-header')
  await expect(header).toBeVisible()
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  return group
}
