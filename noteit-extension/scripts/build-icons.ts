// Renders the ginkgo icon sources in icons-src/ to the PNGs in public/icons/ (committed output).
// 16px uses its own pixel-grid drawing; 32 and 48px use the 32-grid drawing; 128px is the store
// version. Usage: node scripts/build-icons.ts (re-run after editing an SVG in icons-src/).
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const ICON_STATES = ['off', 'on'] as const
const TOOLBAR_SIZES = [16, 32, 48] as const

interface Job {
  source: string
  size: number
  output: string
}

const jobs: Job[] = [
  ...ICON_STATES.flatMap((state) =>
    TOOLBAR_SIZES.map((size) => ({
      source: size === 16 ? `leaf-${state}-16.svg` : `leaf-${state}.svg`,
      size,
      output: `leaf-${state}-${size}.png`,
    })),
  ),
  { source: 'leaf-store.svg', size: 128, output: 'leaf-128.png' },
]

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const job of jobs) {
    const svg = readFileSync(resolve('icons-src', job.source), 'utf8')
    await page.setViewportSize({ width: job.size, height: job.size })
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${job.size}px;height:${job.size}px}</style>${svg}`,
    )
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: job.size, height: job.size } })
    writeFileSync(resolve('public/icons', job.output), png)
    console.log(`build-icons: ${job.source} -> public/icons/${job.output}`)
  }
} finally {
  await browser.close()
}
