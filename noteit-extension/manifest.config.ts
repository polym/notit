import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

// The manifest version is always taken from package.json so the two cannot drift.
export default defineManifest({
  manifest_version: 3,
  // User-visible manifest copy comes from public/_locales/zh_CN/messages.json (Story 3.2).
  default_locale: 'zh_CN',
  name: '__MSG_extName__',
  version: pkg.version,
  description: '__MSG_extDescription__',
  // Least privilege (NFR15, #20): only what the extension calls. No host_permissions: the content
  // script match below is the only host access, and Supabase is reached via CORS.
  permissions: ['storage', 'sidePanel', 'contextMenus', 'tabs', 'alarms'],
  // Selection translation (spec "selection translation"): nothing is granted at install. Saving the
  // provider in the side panel requests only that one origin, inside the click.
  optional_host_permissions: ['https://*/*'],
  background: {
    service_worker: 'src/entries/background/index.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'src/entries/sidepanel/index.html',
  },
  // Ginkgo icons (public/icons, rendered from icons-src by scripts/build-icons.ts). The toolbar starts
  // as the hollow green leaf; the badge code switches each tab to the gold leaf when it has highlights.
  icons: {
    16: 'icons/leaf-on-16.png',
    32: 'icons/leaf-on-32.png',
    48: 'icons/leaf-on-48.png',
    128: 'icons/leaf-128.png',
  },
  action: {
    default_title: '__MSG_actionTitle__',
    default_icon: {
      16: 'icons/leaf-off-16.png',
      32: 'icons/leaf-off-32.png',
      48: 'icons/leaf-off-48.png',
    },
  },
  commands: {
    'highlight-selection': {
      suggested_key: {
        default: 'Ctrl+Shift+H',
        mac: 'Command+Shift+H',
      },
      description: '__MSG_commandHighlightSelection__',
    },
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_end',
    },
  ],
})
