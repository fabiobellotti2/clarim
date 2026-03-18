# Clarim --- AI Development Instructions

This document defines how AI assistants (Claude, Gemini, ChatGPT, etc.)
should behave when helping develop the Clarim project.

Its goal is to ensure that all AI-generated code follows the same
architecture, standards, and principles used in the system.

------------------------------------------------------------------------

# Project Philosophy

Clarim is designed to be:

-   **Simple**
-   **Modular**
-   **Browser-native**
-   **Realtime**
-   **Maintainable**

The architecture prioritizes:

-   clear module separation
-   minimal dependencies
-   readability
-   low complexity

AI assistants must respect these principles when generating or modifying
code.

------------------------------------------------------------------------

# Core Architecture Rules

## 1. Use ES Modules

All JavaScript must use **ES Module syntax**.

Example:

``` javascript
import { showToast } from "./utils.js"
export function renderDespesas() {}
```

Never use:

-   CommonJS
-   require()
-   bundlers

The browser loads modules directly.

------------------------------------------------------------------------

## 2. app.js is the Orchestrator

`app.js` is responsible for:

-   importing modules
-   initializing modules
-   registering global functions in `window`
-   handling startup flow

Modules must **not depend directly on each other unnecessarily**.

Avoid circular dependencies.

------------------------------------------------------------------------

## 3. Modules Must Have Clear Responsibilities

Each module should represent a **domain**.

Examples:

  Module          Responsibility
  --------------- ----------------------
  firebase.js     Firebase integration
  despesas.js     expense logic
  receitas.js     income logic
  contas.js       accounts
  categorias.js   categories
  ui.js           UI interactions
  utils.js        helper utilities

Do **not mix responsibilities** across modules.

------------------------------------------------------------------------

## 4. utils.js Must Stay Pure

`utils.js` must only contain **pure utilities**.

Allowed:

-   format functions
-   DOM helpers
-   small converters

Not allowed:

-   Firebase logic
-   business rules
-   rendering logic

------------------------------------------------------------------------

## 5. Firebase Layer

All Firestore operations must go through `firebase.js`.

Allowed operations:

``` javascript
fbAdd()
fbUpdate()
fbDelete()
loadAllData()
```

Never access Firestore directly inside other modules.

------------------------------------------------------------------------

# State Management

The project uses a **shared state object** exported from `firebase.js`.

Example:

``` javascript
export const state = {
  despesas: [],
  receitas: [],
  contas: [],
  categorias: []
}
```

Modules read from `state` but avoid mutating it directly unless
required.

------------------------------------------------------------------------

# UI Interaction Rules

UI interactions should be centralized.

Avoid:

-   duplicated event listeners
-   logic embedded directly in HTML

Preferred:

-   functions registered in `window` from `app.js`

Example:

``` javascript
window.marcarPago = marcarPago
```

------------------------------------------------------------------------

# DOM Strategy

Prefer:

-   minimal DOM manipulation
-   render functions per module
-   template literals

Example:

``` javascript
container.innerHTML = data.map(item => `
  <div class="row">
    <span>${item.nome}</span>
  </div>
`).join("")
```

Avoid:

-   deeply nested DOM operations
-   heavy frameworks

------------------------------------------------------------------------

# Firestore Rules

All data must include:

``` javascript
familyId
```

Queries must filter by:

``` javascript
where("familyId","==",state.familyId)
```

Never expose public collections.

------------------------------------------------------------------------

# Performance Guidelines

Prefer:

-   real-time listeners (`onSnapshot`)
-   batch operations when possible
-   minimal re-rendering

Avoid:

-   unnecessary loops
-   heavy DOM rebuilds

------------------------------------------------------------------------

# Coding Style

Use:

-   clear variable names
-   short functions
-   early returns

Example:

``` javascript
if (!data.length) return
```

Avoid deeply nested logic.

------------------------------------------------------------------------

# Naming Conventions

  Type        Pattern
  ----------- ------------
  files       camelCase
  variables   camelCase
  constants   UPPER_CASE
  functions   camelCase

Examples:

    renderDespesas()
    loadAllData()
    formatCurrency()

------------------------------------------------------------------------

# Error Handling

Use:

``` javascript
try/catch
showToast("Erro ao salvar", "error")
```

Errors must not silently fail.

------------------------------------------------------------------------

# Feature Development Guidelines

When adding a feature:

1.  Identify the correct module
2.  Avoid modifying unrelated modules
3.  Add reusable helpers to `utils.js`
4.  Keep UI logic inside `ui.js` or domain module
5.  Keep Firebase logic in `firebase.js`

------------------------------------------------------------------------

# Refactoring Guidelines

Before refactoring:

-   preserve current behavior
-   maintain module boundaries
-   avoid introducing dependencies between modules

Refactoring should prioritize:

-   readability
-   modularity
-   smaller functions

------------------------------------------------------------------------

# Testing Strategy

Because the system runs directly in the browser:

Test using:

-   local Live Server
-   Firebase emulator (optional)
-   console logs

Always verify:

-   CRUD operations
-   real-time updates
-   authentication flow

------------------------------------------------------------------------

# Things AI Assistants Should NOT Do

Do not:

-   introduce frameworks (React, Vue, Angular)
-   add build tools
-   introduce unnecessary libraries
-   break modular structure
-   move Firebase logic outside `firebase.js`

------------------------------------------------------------------------

# Things AI Assistants SHOULD Prefer

Prefer:

-   modular code
-   readable code
-   incremental improvements
-   performance-friendly rendering
-   clear architecture

------------------------------------------------------------------------

# Future System Evolution

Planned improvements include:

### Smart transaction importer

Automatically detect:

-   merchant
-   category
-   installments

### AI categorization

Map merchants to categories automatically.

### Financial dashboard

Add charts and financial insights.

### Duplicate detection

Prevent repeated imports.

------------------------------------------------------------------------

# Purpose of This Document

This document helps AI assistants:

-   understand project architecture
-   generate compatible code
-   avoid architectural mistakes
-   accelerate development safely
