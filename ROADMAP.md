# Chrome Extension Implementation Roadmap

## Implementation Roadmap

### Phase 1: Project Skeleton & Infrastructure
- [ ] **Setup Vite with CRXJS and React-TS template.**
  - Initialize project using Vite.
  - Install and configure `@crxjs/vite-plugin`.
- [ ] **Configure `manifest.json`.**
  - Set manifest version to 3.
  - Add permissions: `storage`, `sidePanel`, `activeTab`, `scripting`.
  - Define `side_panel` configuration.
- [ ] **Create the directory structure.**
  - `src/content`: For content scripts (Vanilla JS + mark.js).
  - `src/sidepanel`: For the React application.
  - `src/shared`: For shared types and utilities.
- [ ] **Goal:** A "Hello World" extension where the Side Panel opens and a Content Script logs to the console.

### Phase 2: Core Highlighting Engine (The "MVP")
- [ ] **Implement `HighlightManager` with `mark.js`.**
  - Setup `mark.js` instance on the document body.
  - Create methods to apply highlights based on ranges or text.
- [ ] **Implement `SelectionManager` to detect user selection.**
  - Listen for `mouseup` events to capture text selection.
  - Extract selection range and text.
- [ ] **Create the `IHighlight` interface in `shared/types.ts`.**
  - Define the structure for a highlight object (id, text, color, pageUrl, timestamp, etc.).
- [ ] **Implement basic storage saving.**
  - Use `chrome.storage.local.set` to save new highlights.
  - Use `chrome.storage.local.get` to retrieve them.
- [ ] **Goal:** Select text -> It gets highlighted -> Data appears in Storage (verify via DevTools).

### Phase 3: UI & Interaction
- [ ] **Side Panel: Implement `useHighlights` hook.**
  - Create a custom React hook to subscribe to storage changes.
  - Render the list of highlights in the Side Panel.
  - Add a "Delete" button to each list item.
- [ ] **Floating Menu: Implement the Shadow DOM component.**
  - Create a vanilla JS component injected into the page.
  - Show the menu near the selection on `mouseup`.
  - Handle click events on the menu to trigger highlighting.
- [ ] **Two-way Sync.**
  - Implement message passing (`chrome.runtime.sendMessage` / `chrome.runtime.onMessage`) or rely on `chrome.storage.onChanged`.
  - Clicking "Delete" in Side Panel removes the highlight in the page.
- [ ] **Goal:** Full interaction loop: Highlight via Menu -> Appears in Panel -> Delete from Panel -> Disappears from Page.

### Phase 4: Persistence & Polish
- [ ] **Robust Anchoring.**
  - Implement logic to store "Context" (prefix/suffix text around the selection).
  - Implement restoration logic on page reload using fuzzy matching (since DOM might change).
- [ ] **Browser Integration.**
  - Add a Context Menu item ("Highlight this") via `chrome.contextMenus`.
  - Add a Keyboard Shortcut (e.g., `Alt+H`) via `commands` in manifest.
- [ ] **Styling.**
  - Polish the Side Panel UI using Tailwind CSS.
  - Ensure the Floating Menu looks good and doesn't conflict with page styles.
- [ ] **Goal:** A fully functional, robust extension ready for personal use.

## Testing & Debugging Guide

### How to inspect the Side Panel
1. Open the Side Panel in the browser.
2. Right-click anywhere inside the Side Panel area.
3. Select **Inspect**.
4. This opens a dedicated DevTools window for the React application running in the panel. You can use the Console, Elements, and React DevTools here.

### How to inspect Content Scripts
1. Open the web page where the extension is active.
2. Open the standard DevTools for the page (F12 or Right-click -> Inspect).
3. The **Console** tab will show logs from your Content Script.
4. To debug code: Go to the **Sources** tab. Look for the "Content Scripts" tab on the left sidebar (next to "Page" and "Filesystem"). Expand your extension's ID to find your source files.

### How to inspect the Floating Menu (Shadow DOM)
1. Since the Floating Menu is injected into the page (often inside a Shadow Root), use the standard Page DevTools.
2. Use the **Element Inspector** (arrow icon) and click on your floating menu.
3. Ensure you are looking inside the `#shadow-root` to see your component's internal HTML and styles.

### Verifying Storage
1. Open the DevTools for the **Side Panel** (or the Extension's Background page).
2. Go to the **Application** tab.
3. Expand **Storage** -> **Local Storage** (Note: For `chrome.storage.local`, it might not appear in standard Local Storage. Instead, type `chrome.storage.local.get(null, console.log)` in the Console of the Side Panel or Background script to dump all data).
