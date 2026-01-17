## Integration Patterns Analysis

### Component Communication Strategy

In a Manifest V3 Chrome Extension, the architecture is event-driven. The three main components—**Content Script**, **Side Panel**, and **Background Service Worker**—run in isolated contexts. Effective communication requires specific messaging patterns.

#### 1. Message Passing Architecture

**A. Content Script -> Side Panel (e.g., "Text Selected")**
*   **Direct Communication:** Content scripts cannot directly access the Side Panel's DOM or window object.
*   **Pattern:** Use `chrome.runtime.sendMessage`.
*   **Flow:**
    1.  User selects text on the webpage.
    2.  Content Script detects the `mouseup` event.
    3.  Content Script sends a message: `chrome.runtime.sendMessage({ action: "TEXT_SELECTED", data: selectionData })`.
    4.  **Receiver:** The Side Panel listens via `chrome.runtime.onMessage.addListener`.
    *   *Note:* If the Side Panel is closed, it will not receive the message. To handle this, the Background Service Worker can listen to the message and store the state in `chrome.storage.local`. When the Side Panel opens, it reads the current state from storage.

**B. Side Panel -> Content Script (e.g., "Scroll to Highlight", "Delete Highlight")**
*   **Pattern:** Use `chrome.tabs.sendMessage`.
*   **Flow:**
    1.  User clicks a highlight in the Side Panel history.
    2.  Side Panel gets the active tab ID: `chrome.tabs.query({ active: true, currentWindow: true })`.
    3.  Side Panel sends a message: `chrome.tabs.sendMessage(tabId, { action: "SCROLL_TO_HIGHLIGHT", id: highlightId })`.
    4.  Content Script listens via `chrome.runtime.onMessage.addListener` and executes the DOM manipulation.

**C. Background -> Side Panel (e.g., Sync State)**
*   **Pattern:** Storage Events or Runtime Messages.
*   **Best Practice:** Use `chrome.storage.onChanged`.
    *   Instead of passing messages directly to keep UI in sync, the Background script should update `chrome.storage.local`.
    *   The Side Panel (and any other open views) listens to `chrome.storage.onChanged` to automatically update its UI (e.g., adding a new highlight to the list). This ensures a "Single Source of Truth."

**D. Connection Pattern: Request/Response vs. Long-lived Connections (Ports)**
*   **Request/Response (`sendMessage`):** Best for one-off events like "save this highlight" or "delete this". It is simpler to implement and sufficient for most of this extension's needs.
*   **Long-lived Connections (`connect`):** Best for continuous streams of data.
    *   *Recommendation:* Use **Request/Response** for commands. Use **Storage Observation** for state syncing. This avoids the complexity of managing port lifecycles, especially since Service Workers in MV3 are ephemeral and can terminate at any time, breaking long-lived connections.

### Data Serialization & Persistence Strategy

Storing a reference to a specific part of a webpage is the most challenging part of a highlighting extension because the DOM is dynamic.

#### 1. The Challenge
A standard DOM `Range` object cannot be serialized to JSON. It contains references to live DOM nodes. If the page reloads, those nodes are gone.

#### 2. Serialization Formats

*   **XPath:**
    *   *Description:* A path string like `/html/body/div[2]/p[1]`.
    *   *Pros:* Precise.
    *   *Cons:* **Extremely Brittle.** If the website adds a `<div>` wrapper or an ad banner, the XPath breaks. *Not recommended.*

*   **CSS Selectors:**
    *   *Description:* `#content > .article > p:nth-child(2)`.
    *   *Pros:* Standard.
    *   *Cons:* Specificity issues. Dynamic classes (e.g., Tailwind or CSS-in-JS hashes) change on every build/deploy of the website.

*   **Text Fragments (Google's Approach):**
    *   *Description:* `#:~:text=[prefix-,]textStart[,textEnd][,-suffix]`.
    *   *Pros:* Native browser support for scrolling and highlighting. Robust against minor DOM structure changes.
    *   *Cons:* The API is primarily for *navigation* (URL fragments). While you can generate these, using them to programmatically re-create a DOM Range for a custom highlighter (like `mark.js`) requires parsing the fragment syntax yourself or using a polyfill.

#### 3. Recommended Strategy: Robust Anchoring

Combine **Text Position** with **Context**.

*   **Data Structure:**
    ```json
    {
      "id": "uuid-1234",
      "url": "https://example.com/page",
      "text": "The exact text selected by the user",
      "containerSelector": "body > main > article", // A stable-ish parent
      "startOffset": 150, // Character index from start of container
      "context": {
        "prefix": "words before the selection ",
        "suffix": " words after the selection"
      }
    }
    ```
*   **Restoration Logic (Fuzzy Matching):**
    1.  Try to find the exact text at the `startOffset`.
    2.  If that fails (DOM changed), search the `container` for the `text`.
    3.  If multiple instances of `text` exist, use `prefix` and `suffix` to disambiguate.
    4.  *Library:* Consider using **`dom-anchor-text-quote`** or similar libraries that implement this "fuzzy anchoring" strategy, which is used by professional annotation tools like Hypothesis.

### Browser API Integration

#### 1. Context Menus
*   **Goal:** Allow users to right-click text and select "Highlight".
*   **API:** `chrome.contextMenus`
*   **Implementation:**
    *   **Setup:** In `background.js` (Service Worker), call `chrome.contextMenus.create` during `runtime.onInstalled`.
    *   **Context:** Set `contexts: ["selection"]` so it only appears when text is selected.
    *   **Handling:** Listen to `chrome.contextMenus.onClicked`. When triggered, send a message to the active tab's Content Script to perform the highlighting logic.

#### 2. Commands (Keyboard Shortcuts)
*   **Goal:** Press `Ctrl+Shift+H` (or Mac equivalent) to highlight.
*   **API:** `chrome.commands`
*   **Implementation:**
    *   **Manifest:** Define commands in `manifest.json`:
        ```json
        "commands": {
          "toggle-highlight": {
            "suggested_key": {
              "default": "Ctrl+Shift+H",
              "mac": "Command+Shift+H"
            },
            "description": "Highlight selected text"
          }
        }
        ```
    *   **Handling:** In `background.js`, listen to `chrome.commands.onCommand`. Send a message to the active tab's Content Script to execute.

#### 3. Tabs API
*   **Goal:** Update the Side Panel when the user switches tabs.
*   **API:** `chrome.tabs`
*   **Implementation:**
    *   The Side Panel needs to show highlights *only* for the current page.
    *   **Event:** Listen to `chrome.tabs.onActivated` and `chrome.tabs.onUpdated` in the Side Panel (or Background).
    *   **Action:** When the active tab changes, get the new URL. Query `chrome.storage.local` for highlights matching that URL and update the React state in the Side Panel.

### References
*   [Chrome Messaging](https://developer.chrome.com/docs/extensions/mv3/messaging/)
*   [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/sidePanel/)
*   [Chrome Context Menus](https://developer.chrome.com/docs/extensions/reference/contextMenus/)
*   [Chrome Commands](https://developer.chrome.com/docs/extensions/reference/commands/)
*   [Text Fragments](https://web.dev/text-fragments/)
