# Data Models

## Core Interfaces (`src/shared/types.ts`)

### IHighlight
The primary data entity representing a single highlighted text segment.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique UUID for the highlight. |
| `text` | `string` | The text content that was selected. |
| `url` | `string` | The full URL of the page where the highlight exists. |
| `color` | `string` | Hex code or CSS color value for the highlight background. |
| `timestamp` | `number` | Unix timestamp of creation. |
| `start` | `number` | The character offset start position relative to the document body. |
| `length` | `number` | The length of the highlighted text. |
| `context` | `object` | (Optional) Context for robust anchoring (prefix, suffix, offset). |
| `xpath` | `string` | (Optional) XPath to the container element for fallback anchoring. |

### IStorageSchema
Defines the structure of the data stored in `chrome.storage.local`.

```typescript
interface IStorageSchema {
  highlights: IHighlight[];
}
```

## Storage Strategy

- **Persistence**: Data is primarily stored in `chrome.storage.local`. This provides persistent storage usually limited to 5MB (unless `unlimitedStorage` permission is requested).
- **Synchronization**: `chrome.storage.sync` is used for storing configuration (e.g., Supabase credentials), but highlights themselves appear to be local-first in the current implementation.
