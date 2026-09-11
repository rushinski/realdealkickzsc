# SYSTEM_PLAN.md — Realdealkickz

---

## 1. Project Overview

**Objective**

Deliver a production-grade sneaker commerce platform with strict correctness, predictable scaling behavior, and a hardened security posture. All development flows through a versioned, auditable pipeline with three environments:

- **Local (dev)**
- **Staging (prod-like)**
- **Production**

**Core Stack**

- **Frontend / API:** Next.js (App Router)
- **Database / Auth:** Supabase (PostgreSQL + RLS)
- **Payments:** Stripe Checkout (Apple Pay; Google Pay/Link post-MVP)
- **Hosting:** Vercel
- **Proxy:** Caddy (local only; optional VM Phase 3)
- **CI/CD:** GitHub Actions (tag-gated deploys)
- **Monitoring:** Sentry + PostHog + Vercel Analytics
- **Cost Target:** $0–$50/mo initial phase

---

## 2. Environment Model (Updated: 3-Tier)

### **Local Development**

- Fast iteration
- Optional local Supabase; or use staging keys
- Stripe test mode
- Debuggable logs, hot reload, unrestricted dev tools

### **Staging (Hosted, Prod-Like)**

- Full integration testing
- Load testing (Artillery/k6)
- Security scanning
- RLS validation tests
- Uses same migrations as prod
- Stripe sandbox flows

### **Production**

- Locked-down environment
- Tag-based deploys only
- Observability + alerting
- Error budgets & SLOs apply

**Benefits**

- Prevents “works locally, breaks in prod.”
- Guarantees schema/env parity across environments.
- Safe for performance, concurrency, and RLS tests.

---

## 3. Configuration & Environment Validation

### Centralized Env Module

All environment variables validated in a dedicated module:

```
src/config/env.ts

```

- Zod schema validation
- Fails fast in CI if required variables missing
- Prevents runtime “undefined key” failures
- Ensures parity across local, staging, and production

---

## 4. Database Model & Migration Strategy

### Versioned Supabase Migrations (Mandatory)

- All schema tracked in `/supabase/migrations/*`
- `supabase db diff` used to generate migrations
- CI validates migration order and checksum
- Migrations applied automatically during tagged release

### Why this matters

- Prevents untracked schema drift
- Enables safe multi-env migrations
- Required for background jobs, marketplaces, and tenant isolation later

---

## 5. Updated Application Layering Model

The system now uses **enterprise-grade boundaries**:

### **Repositories (Data Layer)**

- Encapsulate all Supabase queries
- Enforce RLS-aware operations
- Index-optimized access patterns
- Natural extension for multi-tenant filters

### **Services (Domain Layer)**

- Core business logic
- Validation rules
- Inventory, pricing, order creation flows
- No direct DB access

### **Jobs (Background Workflow Layer)**

- Stripe webhook processing
- Cache revalidation
- Inventory syncing
- Email notifications
- Future offloading to worker containers

### **Route Handlers (Controller Layer)**

- Input validation
- Authz checks
- Call services/jobs
- No business logic allowed

**Outcome:** Predictable, testable, and scalable architecture that avoids monolith entropy.

---

## 6. Multi-Tenant Ready Data Model

Prepared for marketplace evolution:

- Optional `tenant_id` or `seller_id` on major tables
- Indexing optimized (`tenant_id`, `seller_id`, `user_id`)
- RLS templates ready for tenant isolation
- Repo layer auto-injects context

No breaking changes required when evolving into multi-seller mode later.

---

## 7. Caching & Performance Model

### Rules (Updated)

**Catalog**

- ISR (`revalidate=60`)
- `dynamic='force-static'`
- Tag-based invalidation: `revalidateTag("products")`

**Assets / Images**

- `Cache-Control: max-age=86400, immutable`
- Filenames include content hashes

**User-Specific Pages**

- `dynamic='force-dynamic'`
- `fetchCache='force-no-store'`

**API**

- Public: short TTL (30s)
- Private/authenticated: `no-store`

This fully prevents private-data caching while maximizing global performance.

---

## 8. Edge Rate Limiting

Enforced via Upstash Ratelimit (Edge Middleware):

- `/api/*`
- `/auth/*`
- `/checkout/*`
- `/admin/*`

Default: **30 requests/min per IP**

Mitigates bot traffic, checkout abuse, scraper spikes.

---

## 9. Structured Logging & Observability

All environments use consistent structured logging:

- Every request tagged with `x-request-id`
- Logs emitted as JSON
- Include contextual metadata:
    - `userId`
    - `route`
    - `stripeSessionId`
    - `tenantId`

Benefits:

- End-to-end traceability across Vercel, Supabase, Stripe
- Faster debugging & incident reconstruction

---

## 10. Load Testing & RLS Testing

### Load Testing (Staging Only)

Scenarios:

- Catalog browsing
- Product detail concurrency
- Checkout session creation
- Admin CRUD
- Rate limit behavior

### RLS Testing

Automated SQL + app-level tests:

- Verify user-specific isolation
- Verify tenant isolation (future)
- Ensure policies enforce least-privilege

🛡 Critical for preventing data leakage under scale.

---

## 11. Background Jobs Seam (New)

`/src/jobs/*` layer enables:

- Stripe webhook order finalization
- Cache invalidation
- Inventory sync
- Email flows
- Multi-step workflows (Phase 3+)

Later extension:

- Dedicated worker container
- Persistent queue (e.g., Upstash Q/Stomp/Cloudflare Queues)

---

## 12. Cost & Environment Strategy

**Supabase Strategy**

- One Pro-tier DB for Production
- One separate Staging DB
- Avoid splitting into multiple $25 DBs
    
    (creates fragmentation and increases ops overhead)
    

Pro-tier overages cheaper than multi-DB complexity.

---

## 13. Failure Modes & Mitigations (Updated)

New failures addressed:

| Failure Mode | Mitigation |
| --- | --- |
| Abuse traffic | Edge rate limit + 429 |
| Missing/malformed env vars | Zod env validator, CI fail-fast |
| RLS misconfig | RLS test suite; policy CI checks |
| Schema drift | Versioned migrations + CI diff |
| Stale cache | Tag-based invalidation |
| Webhook replay | Stripe signature verify + idempotency |
| Load bottlenecks | Staging load tests |

---

## 14. Updated Phase Roadmap

### **Phase 1 — MVP**

- Checkout
- Admin panel
- RLS
- Initial Layered Architecture
- ISR + caching rules
- Basic logging

### **Phase 2 — Post-MVP Hardening**

- Sentry
- PostHog
- Dependabot + CodeQL
- Admin audit logs
- Automated env validator
- Stronger CI gates

### **Phase 3 — Scaling**

- Staging environment fully utilized
- Background worker container
- Cloudflare R2 for images
- Load tests + RLS tests automated
- Zero-downtime deploys

### **Phase 4 — Intelligence Layer**

- Customer analytics
- Conversion insights
- ML-ready schema

### **Phase 5 — Maintenance**

- Quarterly security reviews
- Dependency refresh
- Automated backup restore drills
- CMS (optional)

---

## 15. Updated Testing Matrix

| Type | Focus | Tool |
| --- | --- | --- |
| Unit | Services, repos | Jest |
| Integration | Checkout, auth | Playwright |
| API Contract | OpenAPI 3.1 validation | Redocly |
| RLS Tests | Row isolation correctness | SQL + Supabase CLI |
| Load Tests | Concurrency + scale | Artillery / k6 |
| Staging Smoke | Health checks | CI |

---

## 16. Documentation Deliverables (Updated)

| Document | Description |
| --- | --- |
| SYSTEM_PLAN.md | This file — strategic plan + evolution |
| ARCHITECTURE.md | High-level runtime & evolution paths |
| SECURITY.md | RLS, 2FA, secrets, CSP |
| RUNBOOK.md | Incident response, deploy recovery |
| INFRA_GUIDE.md | Dev/staging/prod environment setup |
| MONITORING_GUIDE.md | Metrics, dashboards, alert policy |
| DEPLOYMENT_PIPELINE.md | Tag-gated CI/CD pipeline |
| API_SPEC.yaml | OpenAPI contract |

---

## 17. Maintenance Agreement

- Developer maintains deployment pipeline, monitoring, and restore procedures.
- Client responsible for taxes, Stripe fees, and hosting upgrade costs.
- All new features follow CVL validation loops before approval.