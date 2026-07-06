# Testing And UI Architecture Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the repo from Jest-heavy, structure-skewed testing to a module-aligned Vitest plus Playwright strategy, while cleaning stale tests and removing leftover telemetry runtime surfaces.

**Architecture:** Keep the existing modular monolith and vertical-slice direction. `app/**` stays thin, module-owned behavior becomes the main test target, and a small architecture-smoke layer replaces the current oversized migration-structure suite. Unit and in-process integration tests move to Vitest; real browser and async server-component flows stay in Playwright.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest, React Testing Library, Playwright, ESLint

---

### Task 1: Add Vitest Scaffolding And Shared Test Setup

**Files:**
- Create: `vitest.config.mts`
- Create: `tests/setup/vitest.setup.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `README.md`

- [ ] **Step 1: Write the failing smoke test expectation in the plan**

Create a basic Vitest harness target around the existing smoke test idea:

```ts
// tests/unit/jest-smoke.test.ts
import { describe, expect, it } from "vitest";

describe("vitest harness", () => {
  it("runs a basic assertion", () => {
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Add Vitest config and shared setup**

Create `vitest.config.mts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup/vitest.setup.ts"],
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    css: true,
  },
});
```

Create `tests/setup/vitest.setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Update package scripts and dev dependencies**

Modify `package.json` scripts to add Vitest alongside existing Jest during migration:

```json
{
  "scripts": {
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "npx playwright test",
    "test": "npm run test:unit"
  }
}
```

Also add dev dependencies:

```json
{
  "devDependencies": {
    "@testing-library/dom": "^10.4.1",
    "@testing-library/jest-dom": "^6.8.0",
    "@testing-library/react": "^16.3.0",
    "@vitejs/plugin-react": "^5.1.0",
    "jsdom": "^26.1.0",
    "vite-tsconfig-paths": "^5.1.4",
    "vitest": "^4.0.4"
  }
}
```

- [ ] **Step 4: Run the Vitest harness**

Run: `npx vitest run tests/unit/jest-smoke.test.ts`

Expected: PASS with one test run under Vitest.

- [ ] **Step 5: Update docs and commit**

Update `README.md` test commands from Jest-first to Vitest-first:

```md
- Unit tests: `npm run test:unit`
- Integration tests: `npm run test:integration`
- E2E tests: `npm run test:e2e`
```

Run:

```powershell
git add vitest.config.mts tests/setup/vitest.setup.ts package.json tsconfig.json README.md
git commit -m "test: add vitest scaffolding"
```

### Task 2: Migrate Shared Jest Globals And Mock Patterns

**Files:**
- Modify: `tests/unit/jest-smoke.test.ts`
- Modify: `tests/unit/server-session.test.ts`
- Modify: `tests/unit/store-access-api.test.ts`
- Modify: `tests/unit/store-access-settings.test.ts`
- Create: `tests/unit/test-helpers/vi-compat.ts`

- [ ] **Step 1: Write the first failing migrated test**

Convert `tests/unit/server-session.test.ts` imports to Vitest style:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
```

Replace Jest mock declarations:

```ts
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
```

- [ ] **Step 2: Add a tiny helper for typed mocks where needed**

Create `tests/unit/test-helpers/vi-compat.ts`:

```ts
export type MockedFn<T extends (...args: any[]) => any> = ReturnType<typeof import("vitest")["vi"]["fn"]> & T;
```

Only keep this helper if typed `vi.mocked(...)` usage proves repetitive during migration.

- [ ] **Step 3: Run the targeted migrated tests**

Run:

```powershell
npx vitest run tests/unit/server-session.test.ts tests/unit/store-access-api.test.ts tests/unit/store-access-settings.test.ts
```

Expected: PASS or targeted failures only from missing import conversions.

- [ ] **Step 4: Convert any lingering `jest.` references in the migrated files**

Replace:

```ts
jest.clearAllMocks();
jest.mocked(fn);
jest.fn();
```

With:

```ts
vi.clearAllMocks();
vi.mocked(fn);
vi.fn();
```

- [ ] **Step 5: Commit**

Run:

```powershell
git add tests/unit/jest-smoke.test.ts tests/unit/server-session.test.ts tests/unit/store-access-api.test.ts tests/unit/store-access-settings.test.ts tests/unit/test-helpers/vi-compat.ts
git commit -m "test: migrate shared unit test patterns to vitest"
```

### Task 3: Remove Or Rewrite Stale Route And Migration Tests

**Files:**
- Modify: `tests/unit/admin-inventory-route-structure.test.ts`
- Modify: `tests/unit/storefront-structure-regression.test.tsx`
- Modify: `tests/unit/checkout-page.test.tsx`
- Modify: `tests/unit/orders-module-migration-structure.test.ts`
- Modify: `tests/unit/order-item-details-modal-module-migration-structure.test.ts`

- [ ] **Step 1: Write current-behavior expectations for the known failing tests**

Update inventory route test to assert the current module page-content boundary:

```ts
expect(source).toContain("@/modules/catalog/presentation/admin/inventory");
expect(source).toContain("<InventoryPageContent");
```

Update storefront route regression to assert current module routing:

```ts
expect(source).toContain("@/modules/storefront");
expect(source).toContain("<StoreCatalogPageContent");
```

Update checkout page test to assert the page delegates to the module export instead of testing redirect behavior at the route file:

```ts
expect(result).toMatchObject({
  type: CheckoutGatePageContent,
});
```

- [ ] **Step 2: Move checkout redirect behavior into the correct module test target**

Create or replace the old route-level assertion with a direct test against `src/modules/checkout/presentation/CheckoutGatePageContent.tsx` behavior using mocked dependencies.

Use:

```ts
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));
```

And assert:

```ts
expect(mockRedirect).toHaveBeenCalledWith("/checkout/start");
```

- [ ] **Step 3: Delete references to removed legacy paths in migration tests**

For tests still asserting deleted compatibility paths such as:

- `src/services/orders-service.ts`
- `src/services/order-status-helpers.ts`
- `src/components/admin/orders/OrderItemDetailsModal.tsx`

rewrite them to assert:

- current module-owned paths exist
- legacy deleted paths do not exist

Example:

```ts
expect(fs.existsSync(path.join(process.cwd(), "src/modules/orders/application/orders-service.ts"))).toBe(true);
expect(fs.existsSync(path.join(process.cwd(), "src/services/orders-service.ts"))).toBe(false);
```

- [ ] **Step 4: Run only the stale-test cleanup set**

Run:

```powershell
npx vitest run tests/unit/admin-inventory-route-structure.test.ts tests/unit/storefront-structure-regression.test.tsx tests/unit/checkout-page.test.tsx tests/unit/orders-module-migration-structure.test.ts tests/unit/order-item-details-modal-module-migration-structure.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add tests/unit/admin-inventory-route-structure.test.ts tests/unit/storefront-structure-regression.test.tsx tests/unit/checkout-page.test.tsx tests/unit/orders-module-migration-structure.test.ts tests/unit/order-item-details-modal-module-migration-structure.test.ts
git commit -m "test: remove stale migration-era route assertions"
```

### Task 4: Reorganize The Test Tree Around Module Ownership

**Files:**
- Create: `tests/unit/modules/catalog/`
- Create: `tests/unit/modules/checkout/`
- Create: `tests/unit/modules/orders/`
- Create: `tests/unit/modules/settings/`
- Create: `tests/unit/modules/storefront/`
- Create: `tests/architecture/`
- Modify: moved test files under `tests/unit/**`
- Modify: `vitest.config.mts`

- [ ] **Step 1: Move checkout, storefront, catalog, orders, and settings tests into module folders**

Start by relocating the highest-signal behavior tests, for example:

- `tests/unit/checkout-page.test.tsx` -> `tests/unit/modules/checkout/checkout-gate-page-content.test.tsx`
- `tests/unit/checkout-pricing-service.test.ts` -> `tests/unit/modules/checkout/checkout-pricing-service.test.ts`
- `tests/unit/storefront-homepage.test.tsx` -> `tests/unit/modules/storefront/storefront-homepage.test.tsx`
- `tests/unit/storefront-product-detail.test.tsx` -> `tests/unit/modules/storefront/storefront-product-detail.test.tsx`
- `tests/unit/product-form-*.test.ts` -> `tests/unit/modules/catalog/...`
- `tests/unit/product-service.test.ts` -> `tests/unit/modules/catalog/product-service.test.ts`
- `tests/unit/store-access-*.test.ts` -> `tests/unit/modules/settings/...`

- [ ] **Step 2: Separate architecture-smoke tests from behavior tests**

Move thin-boundary and route-shape tests into `tests/architecture/`, such as:

- `app-shell-route-structure.test.ts`
- `public-route-structure.test.ts`
- `storefront-route-structure.test.ts`

Keep only architecture rules there, not user behavior.

- [ ] **Step 3: Update Vitest include patterns**

Update `vitest.config.mts`:

```ts
include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx", "tests/architecture/**/*.test.ts", "tests/architecture/**/*.test.tsx"],
```

- [ ] **Step 4: Run the moved tests by folder**

Run:

```powershell
npx vitest run tests/unit/modules/checkout tests/unit/modules/storefront tests/unit/modules/catalog tests/unit/modules/orders tests/unit/modules/settings tests/architecture
```

Expected: PASS with renamed paths discovered correctly.

- [ ] **Step 5: Commit**

Run:

```powershell
git add tests/unit tests/architecture vitest.config.mts
git commit -m "test: organize unit suite by module ownership"
```

### Task 5: Add Missing Checkout And Storefront Behavior Coverage

**Files:**
- Create: `tests/unit/modules/checkout/CheckoutGatePageContent.test.tsx`
- Create: `tests/unit/modules/checkout/CheckoutStartPageContent.test.tsx`
- Create: `tests/unit/modules/storefront/StoreCatalogPageContent.test.tsx`
- Create: `tests/unit/modules/storefront/storefront-catalog-application.test.ts`
- Modify: `src/modules/checkout/presentation/CheckoutGatePageContent.tsx` only if the tests reveal real issues
- Modify: `src/modules/storefront/presentation/catalog/StoreCatalogPageContent.tsx` only if the tests reveal real issues

- [ ] **Step 1: Write failing checkout gate behavior tests**

Cover:

- checkout lock shows locked notice
- authenticated user redirects to `/checkout/start`
- anonymous user renders checkout gate

Example:

```ts
it("redirects authenticated users to checkout start", async () => {
  mockGetServerSession.mockResolvedValue({ user: { id: "u1", email: "a@b.com" }, profile: null, role: "customer" });
  await CheckoutGatePageContent();
  expect(mockRedirect).toHaveBeenCalledWith("/checkout/start");
});
```

- [ ] **Step 2: Write failing storefront catalog behavior tests**

Cover:

- resolved search params are passed through
- empty search params do not break rendering
- the page renders the current storefront catalog shell

Use React Testing Library against the page-content export instead of route-file import-string assertions.

- [ ] **Step 3: Run the new tests to confirm failure before implementation**

Run:

```powershell
npx vitest run tests/unit/modules/checkout/CheckoutGatePageContent.test.tsx tests/unit/modules/storefront/StoreCatalogPageContent.test.tsx
```

Expected: FAIL only where current behavior is not yet directly testable.

- [ ] **Step 4: Make minimal production changes if needed**

Only change module code if the new behavior tests expose a real flaw, not just a testability issue.

Prefer preserving:

- current redirect behavior
- current page-content boundaries
- current storefront rendering flow

- [ ] **Step 5: Commit**

Run:

```powershell
git add tests/unit/modules/checkout/CheckoutGatePageContent.test.tsx tests/unit/modules/checkout/CheckoutStartPageContent.test.tsx tests/unit/modules/storefront/StoreCatalogPageContent.test.tsx tests/unit/modules/storefront/storefront-catalog-application.test.ts src/modules/checkout/presentation/CheckoutGatePageContent.tsx src/modules/storefront/presentation/catalog/StoreCatalogPageContent.tsx
git commit -m "test: add checkout and storefront behavior coverage"
```

### Task 6: Add Missing Catalog And Orders Behavior Coverage

**Files:**
- Create: `tests/unit/modules/catalog/inventory-client-requests.test.ts`
- Create: `tests/unit/modules/catalog/product-form-submit-handler.test.ts`
- Create: `tests/unit/modules/orders/transaction-detail-view.test.ts`
- Create: `tests/unit/modules/orders/refund-order-state.test.ts`
- Modify: existing related tests under moved module folders

- [ ] **Step 1: Write failing catalog behavior tests**

Cover:

- inventory mutation request builders produce the expected request init
- product form submit helpers call `onSubmit` with shaped data
- upload and catalog helper coverage remains under module ownership

Example:

```ts
expect(buildInventoryItemRequestInit("PATCH")).toMatchObject({
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
});
```

- [ ] **Step 2: Write failing orders behavior tests**

Cover:

- transaction detail helper logic such as price and payment display shaping
- refund mode state transitions and validation rules

Use module helpers rather than page-level import-structure assertions.

- [ ] **Step 3: Run the targeted module coverage set**

Run:

```powershell
npx vitest run tests/unit/modules/catalog tests/unit/modules/orders
```

Expected: PASS after minimal fixes.

- [ ] **Step 4: Keep only the architecture-smoke tests that still earn their keep**

If a structure test is fully replaced by stronger behavior coverage, delete it.

Do not keep both unless the structure test protects a distinct architecture rule.

- [ ] **Step 5: Commit**

Run:

```powershell
git add tests/unit/modules/catalog tests/unit/modules/orders tests/architecture
git commit -m "test: expand catalog and orders module coverage"
```

### Task 7: Remove Jest And Finalize Vitest As The Default Runner

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Delete: `jest.config.ts`
- Delete: `jest.integration.config.ts`
- Modify: `scripts/check-file-case.ts`
- Modify: docs that mention `test:jest`

- [ ] **Step 1: Verify no live unit or integration scripts still depend on Jest**

Run:

```powershell
rg -n "test:jest|jest --config|jest\\." package.json tests docs scripts --glob "!node_modules"
```

Expected: only historical docs or files intentionally queued for cleanup remain.

- [ ] **Step 2: Remove Jest config files and scripts**

Modify `package.json`:

```json
{
  "scripts": {
    "test": "npm run test:unit",
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:integration": "vitest run tests/integration",
    "test:e2e": "npx playwright test"
  }
}
```

Delete:

- `jest.config.ts`
- `jest.integration.config.ts`

Remove Jest-related dev dependencies:

- `jest`
- `ts-jest`
- `babel-jest`
- `@types/jest`

- [ ] **Step 3: Update file-case and docs references**

Adjust `scripts/check-file-case.ts` if it explicitly whitelists Jest config names.

Update docs under `README.md`, `docs/ARCHITECTURE.md`, and active plans/docs where current instructions should no longer point to Jest as the live runner.

- [ ] **Step 4: Run the full non-E2E test suite**

Run:

```powershell
npm run test
```

Expected: PASS under Vitest.

- [ ] **Step 5: Commit**

Run:

```powershell
git add package.json package-lock.json scripts/check-file-case.ts README.md docs/ARCHITECTURE.md
git rm jest.config.ts jest.integration.config.ts
git commit -m "test: make vitest the default unit runner"
```

### Task 8: Remove Leftover Telemetry And Runtime Instrumentation Surfaces

**Files:**
- Modify: `src/modules/app-shell/presentation/RootLayoutShell.tsx`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app/legal/privacy/page.tsx`
- Modify: `tests/unit/solesneakers-brand-config.test.ts` if branding copy changes are needed
- Create or modify: `tests/architecture/runtime-cleanup.test.ts`

- [ ] **Step 1: Write the failing runtime-cleanup assertion**

Create `tests/architecture/runtime-cleanup.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

describe("runtime cleanup", () => {
  it("does not mount vercel analytics providers in the root layout shell", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/modules/app-shell/presentation/RootLayoutShell.tsx"),
      "utf8",
    );

    expect(source).not.toContain("@vercel/analytics/next");
    expect(source).not.toContain("@vercel/speed-insights/next");
    expect(source).not.toContain("<Analytics />");
    expect(source).not.toContain("<SpeedInsights />");
  });
});
```

- [ ] **Step 2: Remove provider imports and render calls**

Update `RootLayoutShell.tsx` so the body ends without analytics provider mounts:

```tsx
      <body className="bg-brand-page text-brand-text">
        <SessionProvider initialUser={sessionUser} initialRole={role}>
          <CartProvider userId={userId}>
            <ClientShell isAdmin={isAdmin} userEmail={userEmail} role={role}>
              <ScrollHeader
                isAuthenticated={isAuthenticated}
                userEmail={userEmail}
                role={role}
              />
              <main className="min-h-screen pt-16 pb-20 md:pb-0">{children}</main>
            </ClientShell>
          </CartProvider>
        </SessionProvider>
      </body>
```

- [ ] **Step 3: Remove dependency entries and update privacy copy if needed**

Remove from `package.json`:

- `@vercel/analytics`
- `@vercel/speed-insights`
- `posthog-js`

Update `app/legal/privacy/page.tsx` only if it currently promises future analytics wording that no longer reflects the immediate product stance.

- [ ] **Step 4: Run the targeted cleanup verification**

Run:

```powershell
npx vitest run tests/architecture/runtime-cleanup.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/modules/app-shell/presentation/RootLayoutShell.tsx package.json package-lock.json app/legal/privacy/page.tsx tests/architecture/runtime-cleanup.test.ts
git commit -m "chore: remove leftover telemetry runtime surfaces"
```

### Task 9: Final Verification And Documentation Cleanup

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ARCHITECTURE_RULES.md` if the test-layer guidance needs one short section
- Modify: `docs/superpowers/specs/2026-07-05-testing-and-ui-architecture-design.md` only if implementation forced a small clarification

- [ ] **Step 1: Add short durable test-boundary guidance to architecture docs**

Update `docs/ARCHITECTURE.md` testing section to reflect the final live model:

```md
- Vitest covers unit and in-process integration tests.
- Playwright covers browser and async server-component flows.
- Architecture smoke tests are intentionally narrow and do not replace behavior coverage.
- Tests are grouped by module ownership where possible.
```

- [ ] **Step 2: Run typecheck, lint, and full test verification**

Run:

```powershell
npm run typecheck
npm run lint
npm run test
```

Expected:

- `typecheck`: PASS
- `lint`: PASS
- `test`: PASS

- [ ] **Step 3: Run Playwright only if the existing environment is ready**

Run:

```powershell
npm run test:e2e
```

Expected: PASS, or document clearly if local E2E prerequisites are not currently available.

- [ ] **Step 4: Review spec coverage**

Check that the completed work covers:

- Vitest migration
- module-based test organization
- stale test removal
- behavior coverage increase in checkout, storefront, catalog, orders, settings
- UI organization consistency
- telemetry cleanup

- [ ] **Step 5: Commit final cleanup**

Run:

```powershell
git add docs/ARCHITECTURE.md docs/ARCHITECTURE_RULES.md docs/superpowers/specs/2026-07-05-testing-and-ui-architecture-design.md
git commit -m "docs: finalize testing architecture guidance"
```

---

## Spec Coverage

- Vitest migration: Tasks 1, 2, and 7
- module-aligned test organization: Tasks 4, 5, and 6
- stale test cleanup: Task 3
- missing coverage in high-risk modules: Tasks 5 and 6
- proper UI organization and reusable frontend rules: Task 9 docs finalization plus behavior-test realignment around page-content exports and module boundaries
- leftover telemetry and mitigation cleanup: Task 8

## Placeholder Scan

No `TODO`, `TBD`, or deferred implementation markers are intentionally left in the plan. The only conditional language is where production code changes should happen only if newly added tests reveal real defects.

## Type Consistency

- Vitest imports consistently use `vi`, `describe`, `it`, `expect`, and `beforeEach`
- unit tests stay under `tests/unit/**`
- architecture smoke tests stay under `tests/architecture/**`
- browser tests remain `tests/e2e/**`
