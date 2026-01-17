---
stepsCompleted: [1]
inputDocuments: []
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 0
workflowType: 'prd'
lastStep: 0
project_name: 'noteit'
user_name: 'Polym'
date: 'December 24, 2025'
---

# Product Requirements Document - noteit

**Author:** Polym
**Date:** December 24, 2025

## 1. Project Overview
The `noteit` extension allows users to annotate web pages, enhancing their reading and research experience by allowing them to mark important information and add personal insights.

## 2. Functional Requirements

### 2.1 Text Highlighting (Core)
- **Selection Highlight**: Users must be able to select text on any web page and apply a highlight.
- **Persistence**: Highlights should persist when the user returns to the page (assumed requirement based on typical extension behavior).

### 2.2 Text Commenting (New Feature)
- **Add Comment to Selection**: Users can select a text segment and choose to add a text comment/note to it.
- **Implicit Highlighting**: When a user adds a comment to a selected text, the system must **automatically highlight** that text segment. No separate "highlight" action is needed if commenting.
- **Distinct Visual Style**:
    - **Standard Highlight**: Standard styling (e.g., yellow background).
    - **Comment Highlight**: Must have a **distinct visual style** (e.g., different color, underline, or border) to differentiate it from a simple highlight. This signals to the user that specific content has an attached note.
