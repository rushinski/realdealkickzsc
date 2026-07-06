# Frontend Standards

## Placement

- `app/` contains route entrypoints, route layouts, and server composition.
- `src/modules/<module>/presentation/*` is the canonical home for feature-owned screens, hooks, view models, and route-facing UI.
- `src/modules/storefront/*` is the canonical customer-facing storefront feature tree.
- `src/modules/shared/presentation/admin/*` is the canonical shared admin shell and shared admin UI tree.
- `src/modules/app-shell/presentation/components/*` owns route shell components that frame the application experience.
- `src/shared/ui/*` is reserved for generic reusable UI building blocks and shared interaction surfaces.
- `src/shared/<capability>/*` is the canonical home for cross-module client providers and shared state helpers such as cart support.

## Imports

- Use `@/` imports for application code.
- Do not import from `../../../src/...` out of `app/`.
- Feature modules may depend on `src/modules/shared/**` and `src/shared/**`, but not on another module's private internals.
- Avoid importing from legacy catch-all folders when a module-owned or `src/shared/**` boundary exists.

## Route Shape

- Prefer server `page.tsx` by default.
- Move heavy interactive UI into `client.tsx` or focused screen components.
- Keep page files thin and declarative.
