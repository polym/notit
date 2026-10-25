// ESLint 9 flat config.
// Architecture rules (architecture.md "Enforcement Guidelines" and "Architectural Boundaries"):
// - New layout (src/core, src/features, src/ui, src/entries): violations are errors.
// - Legacy layout (src/background, src/content, src/shared): same rules as warnings
//   until each directory is migrated. Warning counts are tracked in lint-baseline.json and may only
//   decrease (see scripts/lint-baseline.ts).
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import boundaries from 'eslint-plugin-boundaries'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import { builtinRules } from 'eslint/use-at-your-own-risk'
import { existsSync, globSync, readFileSync, statSync } from 'node:fs'
import { dirname, matchesGlob, relative, resolve as resolvePath, sep } from 'node:path'

// Directory globs. The leading "**/" lets the same rules apply to tests/lint-fixtures/src/**.
const LEGACY_DIRS = ['**/src/background/**', '**/src/content/**', '**/src/shared/**']
const SRC_FILES = ['**/src/**/*.{ts,tsx}']

// Package import restrictions: each package may only be imported from the listed directories.
// In legacy directories the closest future equivalent is allowed so that the warning count
// reflects real migration work rather than noise.
const IMPORT_ZONES = [
  {
    name: 'react',
    patterns: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    allowed: ['**/src/ui/sidebar/**', '**/src/features/*/sidebar/**', '**/src/entries/sidepanel/**'],
    message: 'react / react-dom may only be imported in ui/sidebar, features/*/sidebar and entries/sidepanel.',
  },
  {
    name: 'preact',
    patterns: ['preact', 'preact/*'],
    allowed: ['**/src/ui/inpage/**', '**/src/features/*/inpage/**', '**/src/entries/content/**', '**/src/content/**'],
    message: 'preact may only be imported in ui/inpage, features/*/inpage and entries/content.',
  },
  {
    name: 'supabase',
    patterns: ['@supabase/supabase-js', '@supabase/*'],
    allowed: ['**/src/core/auth/**', '**/src/core/sync/**'],
    message: '@supabase/supabase-js may only be imported in core/auth and core/sync.',
  },
  {
    name: 'dexie',
    patterns: ['dexie', 'dexie/*'],
    allowed: ['**/src/core/db/**'],
    message: 'dexie may only be imported in core/db.',
  },
  {
    name: 'db-write',
    // Matches the raw specifier, so "core/" is optional: siblings in src/core reach it as '../db/write'.
    regex: '(^|/)(core/)?db/write(\\.ts)?$',
    allowed: ['**/src/core/**/background/**', '**/src/features/*/background/**', '**/src/core/db/**'],
    message: 'core/db/write may only be imported from background code (service worker is the single writer).',
  },
  {
    name: 'mark',
    patterns: ['mark.js', 'mark.js/*'],
    allowed: ['**/src/features/highlight/render/mark-renderer.ts'],
    message: 'mark.js may only be imported in features/highlight/render/mark-renderer.ts.',
  },
]

// Flat config replaces rule options instead of merging them, so a file can only receive one
// no-restricted-imports option list. The list depends on which zones allow the file, so source
// files are grouped by their restriction set when the config loads (one config entry per group).
function restrictedImportPattern(zone) {
  return zone.regex
    ? { regex: zone.regex, message: zone.message }
    : { group: zone.patterns, message: zone.message }
}

function importRestrictionConfigs() {
  const groups = new Map()
  const files = globSync(['src/**/*.{ts,tsx}', 'tests/lint-fixtures/**/*.{ts,tsx}'], { cwd: import.meta.dirname })
  for (const raw of files) {
    const file = raw.split(sep).join('/')
    const zones = IMPORT_ZONES.filter((z) => !z.allowed.some((glob) => matchesGlob(file, glob)))
    const key = zones.map((z) => z.name).join(',')
    if (!groups.has(key)) groups.set(key, { zones, files: [] })
    groups.get(key).files.push(file)
  }
  return [...groups.entries()].map(([key, { zones, files: groupFiles }]) => ({
    name: `noteit/restricted-imports/${key || 'none'}`,
    files: groupFiles,
    rules: {
      'no-restricted-imports': zones.length
        ? ['error', { patterns: zones.map(restrictedImportPattern) }]
        : 'off',
    },
  }))
}

// Restricted globals / properties, expressed as AST selectors so object and property are matched
// together (no-restricted-properties cannot match a three-level chain such as chrome -> storage -> sync).
// Each storage area is matched as direct access (chrome.storage.<area>), computed literal access
// (chrome.storage['sync']) and destructuring (const { sync } = chrome.storage).
function storageAreaSelector(area) {
  const storage = "[object.type='MemberExpression'][object.object.name='chrome'][object.property.name='storage']"
  const storageInit = "[init.type='MemberExpression'][init.object.name='chrome'][init.property.name='storage']"
  return [
    `MemberExpression${storage}[computed=false][property.name='${area}']`,
    `MemberExpression${storage}[computed=true][property.value='${area}']`,
    `VariableDeclarator${storageInit} > ObjectPattern > Property[key.name='${area}']`,
    `VariableDeclarator${storageInit} > ObjectPattern > Property[key.value='${area}']`,
  ].join(', ')
}
const STORAGE_SYNC = {
  selector: `:matches(${storageAreaSelector('sync')})`,
  message: 'The synced chrome storage area (chrome.storage + sync) is forbidden (credentials and data must not sync via the browser account).',
}
const STORAGE_LOCAL = {
  selector: `:matches(${storageAreaSelector('local')})`,
  message: 'chrome.storage.local may only be used in core/settings and core/auth/storage-adapter.ts.',
}
// Matches any __noteit* member regardless of the object expression, so casts such as
// (window as any).__noteit_x__ and aliases (const w = window; w.__noteit_x__) are caught too.
const NOTEIT_GLOBAL = {
  selector: ":matches(MemberExpression[computed=false][property.name=/^__noteit/], MemberExpression[computed=true][property.value=/^__noteit/])",
  message: 'window.__noteit* globals are forbidden; keep state in modules.',
}
const STORAGE_LOCAL_ALLOWED = ['**/src/core/settings/**/*.{ts,tsx}', '**/src/core/auth/storage-adapter.ts']

// Dependency direction (architecture.md "Architectural Boundaries").
const boundariesSettings = {
  'boundaries/elements': [
    { type: 'core', pattern: 'src/core/*', capture: ['module'] },
    { type: 'feature', pattern: 'src/features/*', capture: ['feature'] },
    { type: 'ui', pattern: 'src/ui' },
    { type: 'entries', pattern: 'src/entries' },
    { type: 'legacy', pattern: 'src/(background|content|shared)', capture: ['legacy'] },
  ],
  'import/resolver': {
    node: { extensions: ['.ts', '.tsx', '.js', '.jsx'] },
  },
}

function boundariesRule(severity) {
  return [
    severity,
    {
      default: 'disallow',
      policies: [
        // Third-party and node built-in modules are governed by no-restricted-imports instead.
        { allow: { to: { module: { origin: ['external', 'core'] } } } },
        { from: { element: { type: 'core' } }, allow: { to: { element: { type: 'core' } } } },
        {
          from: { element: { type: 'feature' } },
          allow: [
            { to: { element: { types: { anyOf: ['core', 'ui'] } } } },
            { to: { element: { type: 'feature', captured: { feature: '{{ from.element.captured.feature }}' } } } },
          ],
        },
        { from: { element: { type: 'ui' } }, allow: { to: { element: { types: { anyOf: ['core', 'ui'] } } } } },
        {
          from: { element: { type: 'entries' } },
          allow: [
            { to: { element: { types: { anyOf: ['core', 'ui', 'entries'] } } } },
            // Features are reachable from entries only through their public index.ts, or sidebar.ts
            // for the side panel module (keeps React out of the service worker and content graphs).
            { to: { element: { type: 'feature', internalPath: 'index.ts' } } },
            { to: { element: { type: 'feature', internalPath: 'sidebar.ts' } } },
            // inpage.ts for the content script (keeps Preact out of the service worker graph).
            { to: { element: { type: 'feature', internalPath: 'inpage.ts' } } },
          ],
        },
        // Legacy directories keep their current cross-imports until migrated, and may use core
        // (shared model and pure functions), ui (strings) and a feature's public index.ts (message
        // protocol types) so they can migrate one call site at a time.
        {
          from: { element: { type: 'legacy' } },
          allow: [
            { to: { element: { types: { anyOf: ['legacy', 'core', 'ui'] } } } },
            { to: { element: { type: 'feature', internalPath: 'index.ts' } } },
            { to: { element: { type: 'feature', internalPath: 'inpage.ts' } } },
          ],
        },
      ],
    },
  ]
}

// Raw URL comparisons (architecture.md "Format Patterns": URL). Same-page / same-site checks must
// call core/url canonicalUrl() / siteKey(). Reported as warnings everywhere and confirmed in review.
// The built-in no-restricted-syntax rule is re-registered under its own name because one rule can
// only have one severity per file, and the selectors above are errors in the new layout.
const EQUALITY = "BinaryExpression[operator=/^[!=]==?$/]"
const RAW_URL_COMPARE = [
  {
    selector: `${EQUALITY} > MemberExpression[property.name='href']:matches([object.name='location'], [object.property.name='location'])`,
    message: 'Do not compare location.href directly; compare canonicalUrl() from core/url.',
  },
  {
    selector: `${EQUALITY} > MemberExpression[property.name='pathname']`,
    message: 'Do not compare .pathname directly; compare canonicalUrl() / siteKey() from core/url.',
  },
]
// Import cycles (architecture.md debt #10, "boundaries: no cycles"). eslint-plugin-boundaries has no
// cycle rule and no other plugin is pinned, so this local rule follows relative imports (including
// type-only ones) through the source files and reports an import that leads back to its own file.
const IMPORT_SPEC_RE = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*\(?\s*['"]([^'"]+)['"]/g
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
const importsCache = new Map()

function resolveRelative(fromFile, spec) {
  const base = resolvePath(dirname(fromFile), spec)
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function relativeImports(file) {
  if (importsCache.has(file)) return importsCache.get(file)
  const out = []
  let source = ''
  try {
    source = readFileSync(file, 'utf8')
  } catch {
    // Unreadable files simply have no edges.
  }
  for (const m of source.matchAll(IMPORT_SPEC_RE)) {
    const spec = m[1] ?? m[2]
    if (!spec.startsWith('.')) continue
    const target = resolveRelative(file, spec)
    if (target) out.push(target)
  }
  importsCache.set(file, out)
  return out
}

/** Shortest import chain from `start` back to `goal`, or null. */
function findPathBack(start, goal) {
  const previous = new Map([[start, null]])
  const queue = [start]
  while (queue.length > 0) {
    const file = queue.shift()
    for (const next of relativeImports(file)) {
      if (next === goal) {
        const chain = [file]
        for (let f = previous.get(file); f; f = previous.get(f)) chain.unshift(f)
        return chain
      }
      if (!previous.has(next)) {
        previous.set(next, file)
        queue.push(next)
      }
    }
  }
  return null
}

const noImportCycle = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { cycle: 'Import cycle: {{ chain }}. Move the shared code into its own module.' },
  },
  create(context) {
    const self = context.filename
    // Lint runs see the current file contents, not the cached ones.
    importsCache.delete(self)
    function check(node) {
      const spec = node.source?.value
      if (typeof spec !== 'string' || !spec.startsWith('.')) return
      const target = resolveRelative(self, spec)
      if (!target) return
      const chain = target === self ? [self] : findPathBack(target, self)
      if (!chain) return
      const names = [self, ...(target === self ? [] : chain), self].map((f) => relative(import.meta.dirname, f))
      context.report({ node: node.source, messageId: 'cycle', data: { chain: names.join(' -> ') } })
    }
    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check, ImportExpression: check }
  },
}

// Raw color literals (Story 3.1, architecture.md "Format Patterns": color values only appear in
// ui/tokens). Hex colors (#RGB, #RGBA, #RRGGBB, #RRGGBBAA) and rgba( in string and template literals
// are errors outside src/ui/tokens; test files and the legacy hex mapping table are exempt.
const HEX_OR_RGBA = '/(^|[^&\\w])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\\b|rgba\\(/'
const RAW_COLOR = [
  {
    selector: `:matches(Literal[value=${HEX_OR_RGBA}], TemplateElement[value.raw=${HEX_OR_RGBA}])`,
    message: 'Color literals are only allowed in src/ui/tokens; use colors / ntColor() from ui/tokens.',
  },
]
const RAW_COLOR_EXEMPT = ['**/src/ui/tokens/**', '**/src/core/color/legacy.ts', '**/*.test.ts', '**/*.test.tsx']

// Chinese copy (Story 3.2, architecture.md "Naming Patterns"): CJK characters in string literals,
// template literals and JSX text are errors outside src/ui/strings.ts. The ranges cover CJK
// symbols and punctuation, Han ideographs (incl. extension A and compatibility) and full-width forms.
const CJK = '/[\\u3000-\\u303f\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]/'
const CJK_LITERAL = [
  {
    selector: `:matches(Literal[value=${CJK}], TemplateElement[value.cooked=${CJK}], JSXText[value=${CJK}])`,
    message: 'Chinese UI copy is only allowed in src/ui/strings.ts; add an entry there and reference it.',
  },
]
const CJK_LITERAL_EXEMPT = ['**/src/ui/strings.ts']

// Text offsets (Story 4.1, architecture.md D7): anchoring/ and inpage/ must compute offsets through
// TextIndex. body.textContent and Range.toString() include excluded text (inline scripts, styles,
// the Shadow host) and shift offsets (#5). Range.toString() is matched syntactically: a receiver
// named *range / *Range, or a direct getRangeAt() / createRange() / cloneRange() call.
const RANGE_RECEIVER = "/(^r|R)ange$/"
const RAW_TEXT_OFFSET = [
  {
    selector: ":matches(MemberExpression[property.name='textContent'][object.name='body'], MemberExpression[property.name='textContent'][object.property.name='body'])",
    message: 'Do not read body.textContent in anchoring/ or inpage/; compute offsets with createTextIndex() (anchoring/text-index.ts).',
  },
  {
    selector: `CallExpression[arguments.length=0][callee.property.name='toString']:matches([callee.object.name=${RANGE_RECEIVER}], [callee.object.property.name=${RANGE_RECEIVER}], [callee.object.callee.property.name=/^(getRangeAt|createRange|cloneRange)$/])`,
    message: 'Do not use Range.toString() in anchoring/ or inpage/; compute offsets and text with createTextIndex() (anchoring/text-index.ts).',
  },
]
const RAW_TEXT_OFFSET_FILES = ['**/src/features/*/anchoring/**/*.{ts,tsx}', '**/src/features/*/inpage/**/*.{ts,tsx}']
const RAW_TEXT_OFFSET_EXEMPT = ['**/*.test.ts', '**/*.test.tsx']

const noteitPlugin = {
  rules: {
    'no-raw-url-compare': builtinRules.get('no-restricted-syntax'),
    'no-raw-color': builtinRules.get('no-restricted-syntax'),
    'no-cjk-literal': builtinRules.get('no-restricted-syntax'),
    'no-raw-text-offset': builtinRules.get('no-restricted-syntax'),
    'no-import-cycle': noImportCycle,
  },
}

const LEGACY_FILES = LEGACY_DIRS.map((d) => `${d}/*.{ts,tsx}`)

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'tests/lint-fixtures']),
  {
    name: 'noteit/base',
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    name: 'noteit/node-scripts',
    files: ['scripts/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    name: 'noteit/plain-js',
    files: ['**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },

  // Architecture rules: errors everywhere in src/ by default ...
  {
    name: 'noteit/architecture/error',
    files: SRC_FILES,
    plugins: { boundaries },
    settings: boundariesSettings,
    rules: {
      'boundaries/dependencies': boundariesRule('error'),
      'no-restricted-syntax': ['error', STORAGE_SYNC, STORAGE_LOCAL, NOTEIT_GLOBAL],
    },
  },
  {
    name: 'noteit/architecture/storage-local-allowed',
    files: STORAGE_LOCAL_ALLOWED,
    rules: {
      'no-restricted-syntax': ['error', STORAGE_SYNC, NOTEIT_GLOBAL],
    },
  },
  ...importRestrictionConfigs(),
  {
    name: 'noteit/architecture/raw-url-compare',
    files: SRC_FILES,
    plugins: { noteit: noteitPlugin },
    rules: {
      'noteit/no-raw-url-compare': ['warn', ...RAW_URL_COMPARE],
      // Error everywhere, legacy directories included (content was the last directory with a cycle).
      'noteit/no-import-cycle': 'error',
    },
  },
  {
    name: 'noteit/architecture/raw-color',
    files: SRC_FILES,
    ignores: RAW_COLOR_EXEMPT,
    plugins: { noteit: noteitPlugin },
    rules: {
      'noteit/no-raw-color': ['error', ...RAW_COLOR],
    },
  },

  {
    // Error everywhere, legacy directories included (no violations remained when it was added).
    name: 'noteit/architecture/cjk-literal',
    files: SRC_FILES,
    ignores: CJK_LITERAL_EXEMPT,
    plugins: { noteit: noteitPlugin },
    rules: {
      'noteit/no-cjk-literal': ['error', ...CJK_LITERAL],
    },
  },

  {
    name: 'noteit/architecture/raw-text-offset',
    files: RAW_TEXT_OFFSET_FILES,
    ignores: RAW_TEXT_OFFSET_EXEMPT,
    plugins: { noteit: noteitPlugin },
    rules: {
      'noteit/no-raw-text-offset': ['error', ...RAW_TEXT_OFFSET],
    },
  },

  // ... downgraded to warnings in legacy directories (keeps the same options, only severity changes).
  {
    name: 'noteit/architecture/legacy-warn',
    files: LEGACY_FILES,
    rules: {
      'boundaries/dependencies': 'warn',
      'no-restricted-syntax': 'warn',
      'no-restricted-imports': 'warn',
      'noteit/no-raw-color': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      // Pre-existing recommended-rule violations in legacy code, fixed as each directory migrates.
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
])
