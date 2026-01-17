---
story_key: 1-1-chrome-extension-skeleton
status: ready-for-dev
sprint: 1
feature: Chrome Extension Skeleton
---

# Story: Chrome Extension Skeleton Setup

## Context
Initial setup of the Chrome Extension project using Vite, CRXJS, React, and TypeScript. This establishes the foundation for the "NoteIt" extension.

## Acceptance Criteria
- [x] Project initialized with Vite + React-TS template
- [x] CRXJS plugin configured and working
- [x] Manifest V3 file created with correct permissions
- [x] Directory structure created (`src/content`, `src/sidepanel`, `src/shared`)
- [x] "Hello World" verification:
    - [x] Side Panel opens and displays text
    - [x] Content Script runs and logs to console
- [x] Extension loads unpacked in Chrome without errors

## Tasks

### 1. Project Initialization
- [x] Initialize Vite project `noteit-extension`
- [x] Install dependencies (`@crxjs/vite-plugin`, `mark.js`, `uuid`)
- [x] Install dev dependencies (`@types/chrome`, `@types/uuid`)

### 2. Build Configuration
- [x] Configure `vite.config.ts` with CRXJS
- [x] Create `manifest.json` (V3)
- [x] Define permissions (`storage`, `sidePanel`, `activeTab`, `scripting`)

### 3. Codebase Structure
- [x] Create `src/content` directory
- [x] Create `src/sidepanel` directory
- [x] Create `src/shared` directory
- [x] Create `src/background` directory

### 4. Hello World Implementation
- [x] Implement `src/content/index.ts` (Console Log)
- [x] Implement `src/sidepanel/index.tsx` (React Root)
- [x] Implement `src/sidepanel/App.tsx` (Simple UI)
- [x] Implement `src/background/index.ts` (Service Worker)
- [x] Update `manifest.json` to point to these entry points

## Dev Agent Record
### Debug Log
- [x] Initial creation
- [x] Fixed TypeScript errors: missing `chrome` types, missing `mark.js` types, unused React import.


### Completion Notes
- [ ] None
