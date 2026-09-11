# ARCHITECTURE.md — Real Deal Kickz

> **Scope:** End‑to‑end architecture across all phases (MVP → Post‑MVP → Scaling → Intelligence → Maintenance). Each section labels its intended phase and evolution path.

---

## 0) System Overview (All Phases)

- **App Framework:** Next.js (App Router) with Server Actions & Route Handlers (API inside Next.js)
- **Data & Auth:** Supabase (Postgres, Auth, RLS, Storage)
- **Payments:** Stripe Checkout (Apple Pay at MVP; Google Pay/Link post‑MVP)
- **Hosting:** Vercel (global edge)
- **Dev Envs:** Two‑tier (Local Dev via Docker Compose; Production via Vercel)
- **Proxy:** Caddy (local/dev now; optional dedicated VM Phase 3+)
- **CI/CD:** GitHub Actions → Vercel deploy
- **Monitoring & Analytics:** Sentry, PostHog, Vercel Analytics
- **Target Cost:** $0–$30/month early phases

```mermaid
flowchart LR
  Dev[Local Dev (Docker Compose)] -->|merge jacob-dev→main| CI[GitHub Actions]
  CI -->|build+test| Vercel[Vercel Deploy]
  Vercel --> Users[End Users]
  Vercel --> Supabase[(Supabase: Postgres/Auth/Storage)]
```

---

## 1) Repository & Project Boundaries (MVP)

**Repo Model:** Single monorepo (app + infra + CI).  
**Rationale:** Tight coupling of web, infra, and CI; simplest control surface for solo dev.  
**Evolution (Phase 3+):** Optional split (e.g., workers/private services) if roles/permissions or scaling require.

**Monorepo Layout (illustrative)**
```
/ (repo root)
├─ app/                    # Next.js (App Router)
├─ infra/
│  ├─ Caddyfile
│  └─ docker/
│     ├─ compose.yml       # web + db + caddy
│     └─ Dockerfile
├─ .github/workflows/      # CI
├─ docs/                   # SYSTEM_PLAN, CONTRACT, this ARCHITECTURE
└─ .env.example            # example config (no secrets)
```

---

## 2) Environment & Deployment Model (Two‑Tier) (MVP)

| Layer | Purpose | Runtime | Key Variables | Notes |
|---|---|---|---|---|
| **Local Dev** | Build/test before prod | Docker Compose (web+db+caddy) | `.env.local` | Local parity; Stripe test keys; optional Supabase local or staging keys.
| **Production** | Public live site | Vercel + Supabase (Prod) | Managed in Vercel (`.env.prod` equivalent) | Auto‑deploy from `main`; Stripe live keys; Vercel TLS.

**Branch Model**
- `jacob-dev`: active development
- `main`: production (merge → CI → Vercel deploy)

```mermaid
graph LR
A[Local Dev]-->B[push origin jacob-dev]
B-->C[merge jacob-dev→main]
C-->D[CI: Lint/Test/Build]
D-->E[Vercel Deploy (prod)]
```

**CI Pipeline (high‑level)**  
- Lint → Unit/Integration tests (Jest/Playwright) → Build → Vercel deploy (`--prod`)  
- Secrets: managed via GitHub/Vercel; no secrets in repo.

---

## 3) Runtime Architecture (MVP → Phase 3)

**Next.js App Router**
- **Rendering:** SSR for product detail & critical pages; SSG/ISR for catalog & marketing pages
- **API:** Route Handlers for: auth integration, catalog reads/writes, order lifecycle webhooks
- **Server Actions:** Admin CRUD, cache revalidation triggers, image variant orchestration

**No separate Node service at MVP**  
- All API lives inside Next.js.  
- **Phase 3+ option:** Add a background worker (e.g., queue consumer for heavy jobs/report exports) behind Caddy if required.

**Key Modules**
- `app/(store)/products/[slug]/page.tsx` (ISR)
- `app/api/products/route.ts` (GET/POST, RLS‑aware)
- `app/api/checkout/route.ts` (Stripe session create)
- `app/api/stripe/webhook/route.ts` (order finalize)
- `lib/supabase.ts`, `lib/stripe.ts`, `lib/cache.ts`

---

## 4) Data Model (Initial) (MVP)

**Products**
- `id (uuid)`, `sku (text unique)`, `name`, `brand`, `size_runs (text[] or JSONB)`, `condition (enum: new|used)`,
  `images (text[])`, `price (numeric)`, `inventory_strategy (enum: flat|per_size)`, `created_at`, `updated_at`

**Orders**
- `id (uuid)`, `user_id (uuid, fk users)`, `stripe_session_id (text)`,
  `subtotal (numeric)`, `shipping (numeric)`, `fee (numeric)`,
  `status (enum: pending|paid|shipped|canceled)`, `created_at`

**Users**
- `id (uuid)`, `email`, `role (enum: customer|admin|ops?)`, `display_name`, `avatar`, `twofa_enabled (bool)`, `created_at`

**Authorizations & RLS**
- Row Level Security enabled on `orders`, `users`, `products`  
- Policies: users can read public products; users can read own orders; admins can CRUD

**Evolution**
- **Phase 2:** Add advanced filters, more product metadata (designer, materials)
- **Phase 3:** Advanced admin roles/permissions and reporting tables; export views (multiple admin accounts already supported from MVP)

---

## 5) Payments (MVP → Phase 3)

- **Stripe Checkout** is the source of truth for payment state
- **Orders table** mirrors Stripe session & captures cost breakdown: `subtotal`, `shipping`, `fee`
- No tax computation is performed by the platform; any applicable taxes are handled externally by the Client.
- **Webhooks:** `/api/stripe/webhook` finalizes order, triggers cache revalidation & email

---

## 6) Storage & Assets (MVP → Phase 3)

- **Images:** Supabase Storage (default)
- **Variants:** Pre‑generate (`thumb`, `medium`, `large`) on upload via edge function (MVP)
- **CDN Transform (Phase 3):** Optional on‑the‑fly resize via CDN or R2 Workers
- **R2 Integration (Phase 3):** Cloudflare R2 as cost/perf optimization

**Folder Convention**
```
/storage
  /products/{sku}/
    original.jpg
    thumb.jpg
    medium.jpg
    large.jpg
```

---

## 7) Edge, Caching & Performance (MVP → Phase 3)

- **ISR & Tag Revalidation:** Product/category pages tagged; admin CRUD or webhook triggers `revalidateTag`
- **Cache Headers:**
  - Static assets & image variants: `Cache-Control: public, max-age=86400, immutable`
  - Dynamic user & order APIs: `Cache-Control: no-store`
- **SLA Target (early):** <200ms TTFB on cached assets; <2s FCP on product pages
- **Phase 3:** Edge middleware for rate limiting, bot filtering, and selective caching of JSON reads

---

## 8) Networking & Caddy (MVP → Phase 3)

**MVP**  
- **Local only:** Caddy inside Docker Compose to simulate TLS and act as a simple reverse proxy/static server during dev.
- **Public TLS:** Managed by Vercel for production.

**Phase 3+**  
- Optional dedicated Caddy VM in front of private services (e.g., workers, internal dashboards) with TLS termination, mTLS for private endpoints, and static caching for non‑Vercel assets.

---

## 9) Observability & Ops (Phase 2 → Phase 5)

- **Phase 2:** Sentry (errors), PostHog (events), Vercel Analytics (perf). Alerting wired to CI/Slack/email.
- **Phase 3:** Dashboards for uptime, error budgets, conversion funnels; weekly backup verification job
- **Phase 4:** Developer observability portal aggregating logs/metrics; customer insights dashboard
- **Phase 5:** Monthly perf & uptime report; quarterly dependency & infra updates

---

## 10) Security Controls (MVP → Phase 5)

- **HTTPS/TLS:** Vercel for prod; Caddy for local; optional Caddy VM Phase 3+
- **Auth:** Supabase Auth (JWT); Admin 2FA; strict RLS
- **Headers:** Helmet/CSP on Next.js
- **Secrets:** Vercel project env vars; no plaintext in repo
- **Scanning:** Dependabot/CodeQL Phase 2+
- **Backups:** Supabase daily; weekly restore verification Phase 3+
- **Audit:** Admin action logs Phase 2+

---

## 11) Failure Modes & Mitigations (CVL) (All Phases)

| Risk | Phase | Mitigation |
|---|---|---|
| Config drift between dev & prod | MVP | Docker parity; CI build gates; env var checks |
| Cache staleness after orders/admin updates | MVP | Webhook → `revalidateTag`; admin actions call `revalidatePath/Tag` |
| Webhook replay/forgery | MVP | Stripe signature verify; idempotency keys |
| RLS misconfig exposing data | MVP | Policy tests in CI; least‑privilege service role usage |
| Cost creep for images | Phase 3 | R2 offload; tiered variants; CDN cache |
| Deploy instability | Phase 3 | Zero‑downtime deploys; canary via Vercel previews if added |

---

## 12) Evolution Path by Phase

- **MVP (Phase 1)**: Monorepo; two‑tier env; API inside Next.js; Supabase Storage; pre‑generated image variants; ISR+tags; Vercel TLS; Stripe Checkout; foundational RLS & tests.
- **Post‑MVP (Phase 2)**: Google Pay/Link; email notifications; SEO & sitemap; Sentry/PostHog; Dependabot/CodeQL; admin audit logs.
- **Scaling & Automation (Phase 3)**: Staging optional if team grows; background worker behind Caddy; Cloudflare R2; dashboards; backup verification; advanced admin roles/permissions; edge middleware for rate limiting.
- **Intelligence (Phase 4)**: Customer insights dashboard; abandoned cart analysis; ML‑ready schema; dev observability portal.
- **Maintenance (Phase 5)**: Monthly uptime/perf checks; quarterly upgrades; security patching; optional headless CMS.

---

## 13) Operational Runbooks (Pointers)

- **Deploy:** merge `jacob-dev → main` → CI → Vercel prod
- **Rollback:** redeploy previous Vercel build or revert merge commit
- **Secrets:** manage via Vercel; rotate on schedule and on incident
- **Backups:** verify weekly (Phase 3+); document restore drills
- **Monitoring:** alert routes for checkout failures, webhook errors, auth anomalies

---

## 14) Appendix — Example ENV Keys

```bash
# Public
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_POSTHOG_KEY=

# Server
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SENTRY_DSN=
NODE_ENV=production
DEBUG=false
```

> **Authoritative Decisions (confirmed):** Single monorepo; two‑tier env; Next.js App Router with API in‑app; Supabase Storage (R2 optional later); pre‑generated image variants; ISR + tag revalidation; Caddy local now (VM optional later).

