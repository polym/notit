# NoteIt Extension Documentation

**Generated:** January 17, 2026
**Scan Level:** Deep
**Project Type:** Browser Extension (Manifest V3)

## Project Overview

NoteIt is a browser extension that allows users to highlight text on web pages and save these highlights for future reference. It features a local history storage and optional synchronization capabilities.

### Key Features
- **Text Highlighting**: Select and highlight text on any webpage.
- **Persistence**: Highlights are saved locally and restored when visiting the page again.
- **Management**: Side panel interface for managing and searching highlights.
- **Customization**: Multiple highlight colors.

## Technical Architecture

The project is built using:
- **Core**: React 19, TypeScript, Vite
- **Extension Framework**: Chrome Manifest V3
- **Highlighting Engine**: mark.js
- **Storage**: chrome.storage.local (Primary), Supabase (Optional Sync)

### Directory Structure
- `src/background`: Service Worker (Context menus, shortcuts)
- `src/content`: Content Scripts (DOM manipulation, highlighting logic)
- `src/sidepanel`: React UI for managing highlights
- `src/shared`: Shared types and utilities
- `src/assets`: Static resources

## Documentation Index

- [Architecture & Components](architecture.md)
- [Data Models](data-models.md)
