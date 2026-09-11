rdk/
├── app/
│   ├── (public)/
│   │   ├── layout.tsx
│   │   └── page.tsx
│   │
│   ├── products/
│   │   ├── page.tsx                # Catalog page (ISR)
│   │   └── [id]/
│   │       └── page.tsx            # Product detail (ISR)
│   │
│   ├── search/
│   │   └── page.tsx                # Search results UI
│   │
│   ├── admin/
│   │   ├── layout.tsx              # Secured admin layout
│   │   ├── page.tsx                # Admin overview
│   │   ├── products/
│   │   │   ├── page.tsx            # Admin product list
│   │   │   ├── create/
│   │   │   │   └── page.tsx        # Create product
│   │   │   └── [id]/
│   │   │       └── page.tsx        # Edit product
│   │   ├── inventory/
│   │   │   └── page.tsx            # Inventory adjustments
│   │   ├── analytics/
│   │   │   └── page.tsx            # Revenue / order metrics
│   │   ├── audit/
│   │   │   └── page.tsx            # Admin audit logs (post-MVP)
│   │   └── settings/
│   │       └── page.tsx            # Admin settings (2FA mgmt)
│   │
│   ├── api/
│   │   ├── checkout/
│   │   │   └── route.ts            # Starts Stripe Checkout
│   │   ├── stripe/
│   │   │   └── webhook/
│   │   │       └── route.ts        # Stripe webhook handler
│   │   ├── search/
│   │   │   └── route.ts            # Product search API
│   │   ├── auth/
│   │   │   └── route.ts            # Auth helpers / session tooling
│   │   ├── healthz/
│   │   │   └── route.ts            # Always 200
│   │   ├── readyz/
│   │   │   └── route.ts            # DB/Stripe/env validation
│   │   └── revalidate/
│   │       └── route.ts            # Trigger ISR invalidation
│   │
│   └── login/
│       └── page.tsx                # Login (customers/admins)
│
├── middleware.ts                   # Next.js edge entrypoint (auth/rate limits)
│
├── src/
│   ├── config/
│   │   ├── env.ts                  # Zod env validator (single source of truth)
│   │   ├── constants.ts            # Global constants
│   │   └── security.ts             # CSP, headers, cache & rate-limit config
│   │
│   ├── lib/
│   │   ├── log.ts                  # JSON logs + x-request-id handling
│   │   ├── supabase.ts             # Supabase client wiring
│   │   ├── stripe.ts               # Stripe SDK wiring
│   │   └── cache.ts                # Cache/tag utilities (ISR helpers)
│   │
│   ├── repositories/               # Data access (Supabase queries; RLS-aware)
│   │   ├── products.repo.ts
│   │   ├── orders.repo.ts
│   │   ├── profiles.repo.ts
│   │   └── admin.repo.ts
│   │
│   ├── services/                   # Domain logic (no direct DB access)
│   │   ├── products.ts
│   │   ├── orders.ts
│   │   ├── admin.ts
│   │   ├── auth.ts
│   │   └── search.ts
│   │
│   ├── jobs/                       # Backgroundable workflows (SECURITY.md)
│   │   ├── stripeWebhook.ts        # Stripe webhook → order finalization
│   │   ├── cacheRevalidate.ts      # Tag/path revalidation jobs
│   │   └── inventorySync.ts        # Inventory syncing jobs
│   │
│   ├── middleware/                 # Edge middleware layer (ARCHITECTURE.md)
│   │   ├── auth.ts                 # Role checks (admins, etc.)
│   │   └── rate-limit.ts           # Upstash rate limiting for key routes
│   │
│   └── styles/
│       └── globals.css
│
├── supabase/
│   ├── migrations/                 # Versioned SQL migrations (source of truth)
│   │   ├── 000_init.sql
│   │   ├── 001_products.sql
│   │   ├── 002_orders.sql
│   │   ├── 003_profiles.sql
│   │   ├── 004_marketplace.sql
│   │   ├── 005_audits.sql
│   │   └── ...additional migrations
│   │
│   ├── seed.sql                    # Seed data for dev/staging (used in tests)
│   │
│   └── types/
│       └── database.types.ts       # Supabase-generated types
│
├── infra/
│   ├── Caddyfile                   # Local/dev reverse proxy & TLS simulation
│   └── docker/
│       ├── compose.yml             # Local dev: web + caddy (+ optional local Supabase)
│       └── Dockerfile              # Image used by CI/local container builds
│
├── scripts/
│   ├── check-case-collisions.mts   # Enforce file name casing
│   ├── check-env-usage.mts         # Enforce env var usage/casing
│   ├── seed-dev.ts                 # Optional dev seeder (wraps supabase/seed.sql)
│   └── gen-types.ps1               # Supabase type generation (Windows)
│
├── public/
│   ├── images/
│   │   ├── logo.png
│   │   ├── placeholder-product.png
│   │   └── ...assets
│   └── favicon.ico
│
├── docs/
│   ├── PROJECT_OVERVIEW.md
│   ├── MVP_PLAN.md
│   ├── ARCHITECTURE.md
│   ├── SYSTEM_DESIGN.md
│   ├── SECURITY.md
│   ├── INFRA_GUIDE.md
│   ├── DEPLOYMENT_PIPELINE.md
│   ├── MONITORING_GUIDE.md
│   ├── RUNBOOK.md
│   ├── CONTRACT.md
│   ├── API_SPEC.yaml               # OpenAPI contract (validated in CI)
│   └── incidents/                  # Incident reports, one file per incident
│       └── .gitkeep
│
├── .github/
│   └── workflows/
│       ├── ci.yml                  # Build, lint, test, validate, stage deploy
│       └── deploy-prod.yml         # Tag-triggered prod deployment
│
├── .env.example                    # Template only (no secrets)
├── next.config.js
├── tsconfig.json
├── package.json
└── README.md
