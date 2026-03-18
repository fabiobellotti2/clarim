# Clarim --- Project Context (for AI Assistants)

## Overview

Clarim is a web-based personal/family financial control system that runs
in the browser and uses Firebase Firestore as its backend.

The system manages: - expenses - income - bank accounts - credit cards -
financial categories

It supports multi-user environments using a **family-based multi-tenant
architecture** via `familyId`.

------------------------------------------------------------------------

# Current Architecture

The project was recently refactored from a **single large file (`app.js`
\~1500 lines)** into a **modular ES Modules architecture**.

## Current Structure

clarim/ │ ├─ index.html ├─ style.css ├─ firestore.rules ├─ app.js │ ├─
categorias.js ├─ contas.js ├─ despesas.js ├─ receitas.js ├─ firebase.js
├─ ui.js ├─ utils.js

------------------------------------------------------------------------

# Module Responsibilities

## app.js

Main orchestrator of the application.

Responsibilities: - imports all modules - registers global functions in
`window.*` - initializes modules - listens for `DOMContentLoaded` -
configures Firebase authentication - starts data loading

------------------------------------------------------------------------

## firebase.js

Handles all Firebase integration.

Main responsibilities: - Firebase configuration - authentication -
shared `state` object - CRUD helpers - real-time listeners via
`onSnapshot`

Example operations:

fbAdd() fbUpdate() fbDelete() loadAllData() setupAuth()

------------------------------------------------------------------------

## despesas.js

Handles all **expense logic**.

Features: - rendering expense list - create/edit/delete expenses - mark
as paid - Excel import - XLSX export

------------------------------------------------------------------------

## receitas.js

Handles all **income logic**.

Features: - rendering - CRUD operations - modals and UI integration

------------------------------------------------------------------------

## contas.js

Handles **bank accounts and credit cards**.

Features: - account rendering - creation/editing - integration with
transactions

------------------------------------------------------------------------

## categorias.js

Handles **financial categories**.

Features: - CRUD operations - automatic category creation when new
categories appear in transactions

------------------------------------------------------------------------

## ui.js

Handles **UI logic**.

Examples: - navigation - modals - status badges - filters - UI
interactions

------------------------------------------------------------------------

## utils.js

Pure utility helpers.

Examples:

formatDate formatCurrency showToast normalizeExcelDate convertBRValue
DOM helpers

No dependencies on the rest of the project.

------------------------------------------------------------------------

# Application Boot Flow

index.html ↓ app.js (type="module") ↓ imports all modules ↓
DOMContentLoaded ↓ setupAuth() ↓ loadAllData() ↓ onSnapshot listeners ↓
automatic UI rendering

------------------------------------------------------------------------

# Security

Firestore uses rules based on **familyId isolation**.

familyId = Firebase Auth UID

Queries filter documents like:

where("familyId", "==", userFamilyId)

Ensuring separation between families.

------------------------------------------------------------------------

# Current Features

## Expenses

-   create
-   edit
-   delete
-   mark as paid
-   filters
-   Excel import
-   XLSX export

## Income

-   full CRUD

## Accounts

-   account creation
-   transaction integration

## Categories

-   default categories
-   automatic category creation

## Reports

-   category analysis
-   financial history

------------------------------------------------------------------------

# Technology Stack

Frontend: - HTML - CSS - JavaScript ES Modules

Backend: - Firebase - Firestore - Firebase Authentication

Development Tools: - VS Code - Live Server - Claude Code - Git

------------------------------------------------------------------------

# Current Project Status

✔ Modular architecture implemented\
✔ Firebase integration working\
✔ Real-time updates via onSnapshot\
✔ Running locally in browser\
✔ Git repository initialized\
✔ First commit completed

Refactor completed successfully.

------------------------------------------------------------------------

# Potential Future Improvements

## 1. Smart invoice importer

Automatically detect: - date - amount - category - account -
installments

## 2. Automatic categorization

Examples:

EDP → Utilities\
Uber → Transportation\
iFood → Food\
Netflix → Entertainment

## 3. Advanced financial dashboard

Charts for: - monthly spending - category distribution - financial
evolution

## 4. Duplicate transaction detection

Prevent duplicate imports.

------------------------------------------------------------------------

# Important Note

The application uses **modern ES Modules**, therefore the main script is
loaded via:

```{=html}
<script type="module" src="app.js"></script>
```
The browser resolves dependencies automatically.

------------------------------------------------------------------------

# Purpose of This Context File

This document is meant to be loaded into AI assistants (Claude, Gemini,
ChatGPT, etc.) to provide them with:

-   project architecture
-   module responsibilities
-   system flow
-   technology stack
-   development status

This helps the AI provide more accurate and context-aware assistance for
further development of the Clarim project.
