## Architectural Patterns and Design

### 1. System Architecture Diagram

The system follows a **Distributed State Architecture** where `chrome.storage` acts as the central "Database" and "Message Bus". The components (Side Panel and Content Script) are decoupled and react to storage changes rather than communicating directly for state updates.

```mermaid
graph TD
    subgraph "Chrome Browser Context"
        Storage[("chrome.storage (Single Source of Truth)")]
    end

    subgraph "Side Panel (React)"
        SP_UI[React UI Components]
        SP_Hook["useHighlights() Hook"]
        SP_UI --> SP_Hook
        SP_Hook -- "Reads/Subscribes" --> Storage
        SP_Hook -- "Writes (Add/Delete)" --> Storage
    end

    subgraph "Content Script (Vanilla JS)"
        CS_Main[Main Entry]
        CS_High[HighlightManager]
        CS_Select[SelectionManager]
        CS_Menu[FloatingMenu (Shadow DOM)]
        
        CS_Main --> CS_High
        CS_Main --> CS_Select
        CS_Select --> CS_Menu
        
        CS_High -- "Reads/Subscribes" --> Storage
        CS_High -- "Writes (New Highlight)" --> Storage
        CS_High -- "DOM Manipulation" --> DOM[Web Page DOM]
    end
```

### 2. Code Organization (Directory Structure)

For a **Vite + CRXJS** project, a "monorepo-like" structure within a single `src` folder is recommended. This separates concerns while allowing easy sharing of types and utilities.

```text
src/
├── manifest.json             # Entry point for CRXJS
├── shared/                   # Shared code between "apps"
│   ├── types.ts              # Shared interfaces (e.g., IHighlight)
│   ├── constants.ts          # Storage keys, message IDs
│   └── utils/
│       ├── storage.ts        # Typed wrappers for chrome.storage
│       └── dom.ts            # Shared DOM helpers (if any)
├── sidepanel/                # The React Application
│   ├── index.html
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/           # React components (HighlightList, Search)
│   └── hooks/
│       └── useHighlights.ts  # The sync hook
├── content/                  # The Vanilla JS Application
│   ├── index.ts              # Entry point
│   ├── managers/
│   │   ├── HighlightManager.ts
│   │   └── SelectionManager.ts
│   ├── components/
│   │   └── FloatingMenu.ts   # Shadow DOM component class
│   └── styles/
│       └── content.css       # Injected styles for highlights
└── background/               # Service Worker (if needed)
    └── index.ts
```

### 3. State Management Patterns

#### "Single Source of Truth"
We avoid duplicating state. The `chrome.storage.local` is the definitive state. React state is merely a **cache/reflection** of storage.

#### The `useHighlights()` Hook Pattern
This custom hook bridges the asynchronous, event-driven nature of `chrome.storage` with React's reactive rendering.

**Key Responsibilities:**
1.  **Load:** Fetch initial data on mount.
2.  **Subscribe:** Listen to `chrome.storage.onChanged`. If the *Content Script* adds a highlight, this listener fires, updating the React state automatically.
3.  **Write:** Provide methods (`add`, `remove`) that write to storage. *Do not update local state directly in these methods*; wait for the `onChanged` event to ensure truth.

**Conceptual Implementation:**
```typescript
// src/sidepanel/hooks/useHighlights.ts
export const useHighlights = () => {
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  useEffect(() => {
    // 1. Initial Load
    chrome.storage.local.get("highlights", (data) => {
      if (data.highlights) setHighlights(data.highlights);
    });

    // 2. Subscription
    const listener = (changes, area) => {
      if (area === "local" && changes.highlights) {
        setHighlights(changes.highlights.newValue);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const removeHighlight = (id: string) => {
    // 3. Write (Optimistic updates can be added if needed, but simple write is safer)
    const newHighlights = highlights.filter(h => h.id !== id);
    chrome.storage.local.set({ highlights: newHighlights });
  };

  return { highlights, removeHighlight };
};
```

### 4. Content Script Design Patterns

Since we are using Vanilla JS here to keep the bundle light and avoid React conflicts with the host page, we use **Manager Classes**.

#### Manager Pattern
*   **`HighlightManager`**: Responsible for painting.
    *   *Methods*: `loadFromStorage()`, `drawHighlight(range)`, `removeHighlight(id)`.
    *   *Logic*: It listens to `chrome.storage.onChanged`. If the Side Panel deletes a highlight, this manager receives the event and removes the DOM wrapping for that ID.
*   **`SelectionManager`**: Responsible for user input.
    *   *Logic*: Listens for `mouseup`. Calculates the selection range. Decides if the "Floating Menu" should appear.
*   **`TooltipManager` / `FloatingMenu`**: Responsible for the UI overlay.

#### Event Delegation (Performance)
Instead of attaching a `click` listener to every single `<span class="highlight">` (which could be thousands), attach **one** listener to the document (or a container).

```typescript
// Inside HighlightManager or a global event handler
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  // Check if the clicked element is a highlight
  if (target.matches('.my-ext-highlight')) {
    const highlightId = target.dataset.id;
    console.log("Clicked highlight:", highlightId);
    // Show delete tooltip or focus in side panel
  }
});
```

### 5. Shadow DOM Architecture

For the "Floating Menu" (the "Highlight this?" button), we must use **Shadow DOM** to prevent the host page's CSS from breaking our button, and our button's CSS from leaking out.

**Implementation Strategy: Class-based Shadow Host**
We don't need a full Web Component (Custom Element) registry, which can sometimes conflict if not named uniquely. A simple class that manages a `div` host is sufficient.

**Structure:**
1.  **Host Creation:** Create a `div` (`id="my-ext-root"`). Append to `document.body`.
2.  **Shadow Root:** `const shadow = host.attachShadow({ mode: 'open' });`
3.  **Style Injection:** Create a `<style>` tag with the menu's CSS and append to `shadow`.
4.  **Content:** Append the menu HTML to `shadow`.

**Why not React here?**
Injecting a second React instance into the content script is possible but heavy. For a simple button/menu, Vanilla JS + Shadow DOM is significantly more performant and less prone to conflicts.
