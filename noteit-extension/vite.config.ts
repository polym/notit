import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import preact from '@preact/preset-vite'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.config.ts'

const DEBUG_HTML_SOURCE = 'src/entries/debug/debug.html'

// The diagnostics page is not referenced by the manifest, so it is an extra build input. Emitting it
// at the dist root makes it reachable as chrome-extension://<id>/debug.html (Story 2.23). Asset
// paths in the emitted HTML are absolute (/assets/...), so moving the file does not break them.
function debugPageAtRoot(): Plugin {
  return {
    name: 'noteit-debug-page-at-root',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const asset = bundle[DEBUG_HTML_SOURCE]
      if (asset?.type !== 'asset') return
      // Rolldown does not support assigning bundle entries: drop the original and emit a copy.
      const source = asset.source
      delete bundle[DEBUG_HTML_SOURCE]
      this.emitFile({ type: 'asset', fileName: 'debug.html', source })
    },
  }
}

// In-page Preact components (architecture.md "Build"): src/ui/inpage/** and src/features/*/inpage/**.
// Everything else (side panel) stays on the React plugin.
const INPAGE_TSX = [/\/src\/ui\/inpage\/.*\.tsx$/, /\/src\/features\/[^/]+\/inpage\/.*\.tsx$/]

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({ exclude: [/node_modules/, ...INPAGE_TSX] }),
    // `babel: {}` keeps the Preact JSX transform per file (Babel, scoped by `include`) instead of a
    // global oxc/esbuild jsxImportSource that would also hit the React side panel. No react -> preact
    // aliases, no HMR or devtools injection: content scripts are not served by the dev server.
    preact({
      include: INPAGE_TSX,
      babel: {},
      reactAliasesEnabled: false,
      prefreshEnabled: false,
      devToolsEnabled: false,
    }),
    // Tailwind 4 for the side panel stylesheet only (src/ui/sidebar/styles.css); the in-page Shadow DOM
    // uses the token CSS variables without Tailwind (architecture.md D10).
    tailwindcss(),
    crx({ manifest }),
    debugPageAtRoot(),
  ],
  build: {
    rollupOptions: {
      input: { debug: DEBUG_HTML_SOURCE },
    },
  },
})
