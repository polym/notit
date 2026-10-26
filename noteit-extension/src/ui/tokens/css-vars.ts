// Generates the --nt-* CSS custom properties from tokens.ts (architecture.md "Naming Patterns":
// CSS variable --nt-<token>, DESIGN.md token names transcribed). The sidebar and the in-page
// Shadow DOM both read these variables; the shadcn semantic variables and the Tailwind 4 theme
// only reference them, so no color value is repeated outside src/ui/tokens.
import { colors, fontFamily, rounded, spacing, typography } from './tokens.ts'

/** DESIGN.md keys such as "0.5" are not valid in a CSS identifier; dots become dashes. */
function ident(key: string): string {
  return key.replaceAll('.', '-')
}

/** Every --nt-* variable with its value, in a stable order. */
export function ntVars(): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const [name, value] of Object.entries(colors)) vars[`--nt-${name}`] = value
  vars['--nt-font-family'] = fontFamily
  for (const [name, t] of Object.entries(typography)) {
    vars[`--nt-${name}-font-size`] = t.fontSize
    vars[`--nt-${name}-font-weight`] = t.fontWeight
    vars[`--nt-${name}-line-height`] = t.lineHeight
  }
  for (const [name, value] of Object.entries(rounded)) {
    vars[name === 'DEFAULT' ? '--nt-radius' : `--nt-radius-${name}`] = value
  }
  for (const [name, value] of Object.entries(spacing)) vars[`--nt-space-${ident(name)}`] = value
  return vars
}

/** Reference to a color token's variable, for inline styles and component CSS. */
export function ntColor(name: keyof typeof colors): string {
  return `var(--nt-${name})`
}

// shadcn/ui semantic variables. DESIGN.md: unlisted shadcn tokens (card, popover, input, ...) map
// to background / border.
const SHADCN_ALIASES: Record<string, string> = {
  '--background': 'var(--nt-background)',
  '--foreground': 'var(--nt-foreground)',
  '--card': 'var(--nt-background)',
  '--card-foreground': 'var(--nt-foreground)',
  '--popover': 'var(--nt-background)',
  '--popover-foreground': 'var(--nt-foreground)',
  '--primary': 'var(--nt-primary)',
  '--primary-foreground': 'var(--nt-primary-foreground)',
  '--secondary': 'var(--nt-muted)',
  '--secondary-foreground': 'var(--nt-foreground)',
  '--muted': 'var(--nt-muted)',
  '--muted-foreground': 'var(--nt-muted-foreground)',
  '--accent': 'var(--nt-hover)',
  '--accent-foreground': 'var(--nt-foreground)',
  '--border': 'var(--nt-border)',
  '--input': 'var(--nt-border-strong)',
  '--ring': 'var(--nt-ring)',
  '--radius': 'var(--nt-radius)',
}

/** shadcn semantic variable -> var(--nt-*) reference. */
export function shadcnVars(): Record<string, string> {
  return { ...SHADCN_ALIASES }
}

function declarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')
}

/**
 * Stylesheet text declaring the --nt-* variables (and, for the sidebar, the shadcn aliases) on
 * `selector`. In-page UI uses ':host' inside its Shadow root; the sidebar uses ':root'.
 */
export function cssVarsText(selector: string, options: { shadcn?: boolean } = {}): string {
  const vars = options.shadcn ? { ...ntVars(), ...shadcnVars() } : ntVars()
  return `${selector} {\n${declarations(vars)}\n}\n`
}

/**
 * Tailwind 4 `@theme inline` block for the sidebar stylesheet: theme colors, radii and font point at
 * the shadcn / --nt-* variables, so utilities such as bg-background or rounded-md use the tokens.
 */
export function tailwindThemeCss(): string {
  const theme: Record<string, string> = {}
  for (const name of Object.keys(SHADCN_ALIASES)) {
    if (name !== '--radius') theme[`--color-${name.slice(2)}`] = `var(${name})`
  }
  for (const name of Object.keys(colors)) {
    if (!(`--${name}` in SHADCN_ALIASES)) theme[`--color-${name}`] = `var(--nt-${name})`
  }
  for (const name of Object.keys(rounded)) {
    theme[name === 'DEFAULT' ? '--radius' : `--radius-${name}`] =
      name === 'DEFAULT' ? 'var(--nt-radius)' : `var(--nt-radius-${name})`
  }
  theme['--font-sans'] = 'var(--nt-font-family)'
  return `@theme inline {\n${declarations(theme)}\n}\n`
}

/** Installs the sidebar :root variables once (no-op when already present). */
export function installRootCssVars(doc: Document = document): void {
  const id = 'noteit-tokens'
  if (doc.getElementById(id)) return
  const style = doc.createElement('style')
  style.id = id
  style.textContent = cssVarsText(':root', { shadcn: true })
  doc.head.append(style)
}
