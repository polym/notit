// Manifest localization snapshot (Story 3.2): user-visible manifest fields use __MSG_*__ keys that
// exist in public/_locales/zh_CN/messages.json, and the context menu titles in messages.json match
// the ones registered at runtime from ui/strings.ts.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifestConfig from '../manifest.config.ts'
import { strings } from '../src/ui/strings.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const messages = JSON.parse(
  readFileSync(resolve(root, 'public/_locales/zh_CN/messages.json'), 'utf8'),
) as Record<string, { message: string }>

/** The manifest fields this test reads (scripts/ is compiled without chrome types). */
interface Manifest {
  default_locale?: string
  name?: string
  description?: string
  action?: { default_title?: string }
  commands?: Record<string, { description?: string }>
}
const manifest = (typeof manifestConfig === 'function'
  ? await (manifestConfig as (env: unknown) => Manifest | Promise<Manifest>)({ command: 'build', mode: 'production' })
  : manifestConfig) as Manifest

const MSG = /^__MSG_(\w+)__$/

function messageKey(value: string | undefined): string {
  const match = MSG.exec(value ?? '')
  expect(match, `not a __MSG_*__ reference: ${value}`).not.toBeNull()
  return match![1]
}

describe('manifest i18n', () => {
  it('defaults to zh_CN', () => {
    expect(manifest.default_locale).toBe('zh_CN')
  })

  const fields: [string, string | undefined][] = [
    ['name', manifest.name],
    ['description', manifest.description],
    ['action.default_title', manifest.action?.default_title],
    ...Object.entries(manifest.commands ?? {}).map(
      ([id, command]) => [`commands.${id}.description`, command.description] as [string, string | undefined],
    ),
  ]

  it.each(fields)('%s uses a __MSG_*__ key present in zh_CN', (_field, value) => {
    const key = messageKey(value)
    expect(messages[key]?.message.trim().length ?? 0).toBeGreaterThan(0)
  })

  it('declares at least one command description', () => {
    expect(Object.keys(manifest.commands ?? {}).length).toBeGreaterThan(0)
  })

  it('the context menu title in zh_CN matches the runtime title', () => {
    expect(messages.menuHighlightSelection?.message).toBe(strings.menuHighlightSelection)
    expect(messages.menuToggleSite).toBeUndefined()
  })

  it('every message has a non-empty value without exclamation marks', () => {
    for (const [key, entry] of Object.entries(messages)) {
      expect(entry.message.trim().length, key).toBeGreaterThan(0)
      expect(entry.message, key).not.toMatch(/[!\uFF01]/)
    }
  })
})
