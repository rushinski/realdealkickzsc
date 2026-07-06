# Testing And UI Architecture Design

## Goal

Standardize the repo's testing strategy and frontend organization so they match the modular monolith architecture already chosen for the codebase.

This design covers:

- migration from Jest to Vitest
- module-aligned test organization
- removal of stale tests tied to deleted or superseded code
- addition of behavior coverage where the current suite is weak
- durable UI organization and reuse rules
- remaining cleanup of telemetry and mitigation surfaces that are no longer in scope

## Current State

The repository has already started migrating toward a modular monolith with vertical slices under `src/modules/**`.

That direction is still correct, but the test system and frontend organization are not yet aligned with it:

- `tests/unit/**` is a flat global bucket
- a large share of the suite checks structure and migration state instead of user or module behavior
- several tests still reference deleted files or old route internals
- package scripts still center Jest even though Next.js now recommends Vitest for unit testing
- browser-level and async server-component coverage is not clearly separated from unit-level coverage
- shared UI patterns exist, but the reusable UI contract is still implicit instead of enforced

## Architecture Decision

Keep the current modular monolith plus vertical-slice architecture.

Do not redesign the application architecture again.

Instead, align the surrounding systems to that architecture:

1. tests should be organized by module ownership and risk level
2. unit and module-integration tests should move to Vitest
3. browser and async server-component flows should be covered by Playwright
4. UI composition should follow a consistent shared-primitives plus module-composites model
5. stale telemetry and mitigation dependencies should be removed as part of the cleanup

## Testing Strategy

### Test Portfolio

Use four test layers:

1. module unit tests
2. module integration tests
3. browser end-to-end tests
4. narrow architecture smoke tests

### Module Unit Tests

Tooling:

- Vitest
- React Testing Library where React rendering is needed
- `jsdom` environment for component and hook tests

Purpose:

- pure domain helpers
- presentation state helpers
- data shaping functions
- small module orchestration helpers
- client-side view logic

These should become the default test type for code under `src/modules/**`.

### Module Integration Tests

Tooling:

- Vitest

Purpose:

- route handler logic that is still best tested in-process
- service and repository contracts
- request parsing and response shaping
- module-level orchestration that crosses a few collaborators

These should still be organized by module, not in a generic cross-repo bucket.

### Browser End-To-End Tests

Tooling:

- Playwright

Purpose:

- async server-component flows
- checkout gates and redirects
- storefront browsing and product detail behavior
- admin high-risk workflows
- any behavior that depends on the real browser, routing, hydration, or server rendering

Playwright remains the correct tool here. Vitest should not be forced to cover async server-component behavior that Next.js itself recommends testing with E2E.

### Architecture Smoke Tests

Keep a small number of structure tests only where they protect real architectural rules, such as:

- route files staying thin
- module entrypoints remaining the public import boundary
- dead legacy surfaces remaining deleted

These are allowed, but they must be a minority of the suite.

They must not dominate the suite or replace behavior tests.

## Test Organization

### Primary Rule

Tests should largely be organized per module.

Recommended target shape:

```text
tests/
  unit/
    modules/
      catalog/
      checkout/
      nexus/
      orders/
      settings/
      storefront/
  integration/
    modules/
      catalog/
      checkout/
      orders/
      storefront/
  e2e/
    storefront/
    checkout/
    admin/
  architecture/
```

Alternative acceptable variant:

- colocate Vitest files inside module folders with `__tests__`

Both options are valid. The important rule is that ownership is obvious and consistent.

For this repo, the preferred direction is:

- keep cross-cutting browser tests in `tests/e2e/**`
- move unit and integration tests into module-grouped test directories under `tests/**`

This gives clearer ownership without mixing tests into already-busy presentation trees.

## Jest To Vitest Migration

### Migration Scope

Replace Jest for unit and integration testing.

Do not replace Playwright.

### Migration Rules

1. introduce Vitest config and scripts first
2. migrate shared test setup and mocks
3. move passing behavior tests over in slices
4. delete or rewrite stale Jest-era structure tests
5. remove Jest dependencies and scripts only after the suite is green on Vitest

### Known Compatibility Notes

Based on the current Vitest migration guide:

- Vitest is largely Jest-compatible
- some mock behavior differs, including `mockReset`
- async Server Components should not be treated as standard Vitest targets

This means the migration should be deliberate, not a blind search-and-replace.

## Coverage Priorities

The first coverage pass should not chase percentages.

It should target high-change, high-risk module behavior:

1. `checkout`
   - gate behavior
   - redirect and lock scenarios
   - pricing and submission helpers
2. `storefront`
   - catalog page behavior
   - product detail rendering behavior
   - route-level data handling
3. `catalog`
   - product form helpers and submission wiring
   - inventory mutations and state helpers
4. `orders`
   - transaction detail view logic
   - refund and shipping helper flows
5. `settings`
   - store-access and admin settings behaviors

Coverage should be evaluated by whether a risky change path is protected, not by raw line count.

## Stale Test Cleanup Rules

Delete or rewrite tests when they:

- assert imports of files that no longer exist
- enforce deleted compatibility shims
- verify internal component composition that users do not observe
- duplicate newer module-boundary tests
- preserve old route internals after those routes were intentionally slimmed down

Current examples include tests still tied to:

- deleted legacy orders files
- old inventory route internals
- old storefront route composition

The cleanup standard is:

- keep tests that protect current behavior or current architecture
- remove tests that protect superseded migration states

## UI Organization And Reuse

### Reuse Model

Use composition-first React design.

The reusable UI hierarchy should be:

1. shared primitives
2. shared surface shells
3. module-owned composites
4. route-level page content adapters

### Shared Primitives

These belong in shared boundaries and stay generic:

- buttons
- badges
- cards
- dialogs
- inputs
- layout primitives
- empty, loading, and feedback shells

### Shared Surface Shells

These also belong in shared boundaries when reused across multiple modules:

- admin page header
- admin section card
- sidebar and topbar framing
- storefront shell framing

They may express shared visual language, but they should still avoid module-specific business behavior.

### Module-Owned Composites

These belong inside each module:

- inventory toolbars
- product form sections
- transactions tables
- checkout gate surfaces
- storefront catalog panels

If a component speaks a module's domain language, it belongs in that module even if it is reused several times inside the same module.

### Route Adapters

`app/**` files should stay thin and only:

- accept route params or search params
- call module page-content exports
- handle route metadata or Next.js file conventions

They should not re-accumulate business or screen orchestration logic.

### Next.js Organization Rules

Use Next.js route groups and private folders where they improve clarity, but keep business ownership in `src/modules/**`.

This means:

- `app/**` remains routing and composition
- route-local non-routable helpers may be colocated when they are truly route-local
- shared or reusable business UI still belongs under module or shared boundaries

## Telemetry And Mitigation Cleanup

Remove or phase out surfaces that are no longer wanted in the repo, including current leftovers related to:

- Vercel Analytics
- Vercel Speed Insights
- stale PostHog dependency presence
- leftover custom mitigation-related dependency surface that is no longer part of the product direction

This cleanup should include:

- dependency removal
- provider unmounting from app shell code
- doc updates
- test updates

## Success Criteria

This effort is successful when:

1. unit and integration tests run through Vitest
2. Playwright remains the browser and async server-component test layer
3. stale migration-era tests are removed or rewritten
4. high-risk module behavior has stronger coverage than before
5. test ownership is obvious by module
6. UI reuse follows the same shared-shell and module-composite pattern across pages
7. out-of-scope telemetry and mitigation remnants are no longer wired into the runtime

## Implementation Order

1. add Vitest scaffolding and shared test setup
2. classify and clean stale Jest-era tests
3. migrate module tests in high-risk order: checkout, storefront, catalog, orders, settings
4. add missing behavior coverage for those modules
5. formalize architecture and UI smoke tests as a small separate layer
6. remove Jest dependencies and scripts
7. remove leftover telemetry and mitigation runtime surfaces

## Out Of Scope

This design does not introduce:

- a new backend architecture
- a new state-management framework
- Storybook adoption
- a complete visual-regression program across every surface
- replacement vendor solutions for analytics or bot mitigation

Those can be added later once the codebase is cleaner and the test architecture is stable.
