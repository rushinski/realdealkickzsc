# **REAL DEAL KICKZ — PHASE 0 + PHASE 1 MASTER PLAN (PRINTABLE MARKDOWN)**

**Updated For: MVP Deadline — Nov 23, 2025**

**Covers:**

- Complete technical architecture
- Full constraints & requirements
- Day-by-day execution plan
- Marketplace-ready schema
- Security & logging posture
- Frontend quality requirements

---

# --------------------------------------

# **PHASE 0 — FOUNDATION (Infrastructure)**

# --------------------------------------

## **Goals**

- Establish repo, CI/CD, hosting, database, and environment validation.
- Prepare security, logging, and operational guardrails.
- Zero app logic—this phase builds the *platform foundation*.

---

## **0.1 Repository & Branch System**

### **Branches**

- `main` → **production**
- `jacob-dev` → **staging**

### **Deployment Rules**

- Push to `jacob-dev` → auto-deploy to **Vercel Staging**
- Tag `vX.Y.Z` on `main` → auto-deploy to **Vercel Production**
- Semantic versioning must strictly increase (CI enforced).

---

## **0.2 GitHub Actions (Hosted Runners)**

Use **GitHub-hosted runners** for reliability and zero ops.

**Pipeline includes:**

- Install dependencies
- Lint
- Typecheck
- Build
- **Env validation** via `env.ts`
- **File path case enforcement**
- **Env variable case enforcement**
- Deploy staging on `jacob-dev`
- Deploy production on tag push
- Run migrations before deploy

---

## **0.3 Environment Validation (Required)**

`src/config/env.ts` uses a Zod schema:

- Validates all required environment variables
- Ensures correct casing and presence
- CI build fails if any variable is missing, malformed, or unexpected

---

## **0.4 Supabase Environment**

Two separate Supabase projects:

- **Staging**
- **Production**

Both must have:

- Row Level Security (RLS) enabled
- Identical migrations applied
- No schema drift

---

## **0.5 Vercel Environment**

Two Vercel projects:

- **rdk-staging**
    - Deploys from: `jacob-dev`
- **rdk-prod**
    - Deploys **only** from version tags (`vX.Y.Z`)

---

# --------------------------------------

# **PHASE 1 — MVP (Full E-Commerce System)**

# --------------------------------------

## **Goals**

Build a production-grade MVP including:

- Catalog + product detail pages
- Search bar + filters
- Multi-admin system (with 2FA)
- Multi-tenant-ready database
- Stripe checkout + webhook
- Admin dashboard with CRUD
- Inventory + pricing controls
- Audit logs
- Logging, observability, and security
- Able to handle **20k visits per 30 days**
- Breathtaking frontend UI / UX

---

# **1. DATABASE SCHEMA (Marketplace-Ready)**

The schema is immediately future-proofed for multi-tenant, multi-seller, multi-marketplace operation.

### **Tables**

- `tenants`
- `marketplaces`
- `sellers`
- `profiles`
- `products`
- `orders`
- `admin_audit_log`

### **Required Columns on Core Tables**

- `tenant_id`
- `seller_id`
- `marketplace_id`

### **Fields for Search**

- `brand` (text)
- `shoe_sizes` (numeric array)
- `clothing_sizes` (text array)

### **Indexes**

- `brand` index
- `GIN` on `shoe_sizes`
- `GIN` on `clothing_sizes`
- `created_at` index
- tenant/seller/marketplace composite indexes

### **RLS Requirements**

- Customers may only see their own orders
- Admins can read/write everything
- Tenant isolation logic prepared for future multi-tenant scenarios

---

# **2. AUTHENTICATION SYSTEM**

### **Supabase Auth**

- Email/password
- Profiles stored in `profiles` table

### **Roles**

- `customer`
- `admin`

### **Admin Requirements**

- Multiple admins supported
- 2FA **required** for all admins
- Admin-only routes locked by Next.js middleware

---

# **3. CATALOG + SEARCH**

### **Catalog Pages**

- `/products` — ISR cached
- `/products/[id]` — ISR cached

### **Search Bar**

Accessible on all pages, supports:

- Free-text search (`q`)
- Filter by **brand**
- Filter by **shoe size**
- Filter by **clothing size**
- Pagination
- Sorting (price & recency)

### **Cache Invalidation**

- Use `revalidateTag` for product and search updates

---

# **4. CHECKOUT & ORDER SYSTEM**

### **/api/checkout**

- Validates cart
- Creates Stripe CheckoutSession
- Creates a **pending** order in DB before redirect

### **Stripe Webhook**

Must include:

- Secret signature verification
- Idempotency protection (event ID table)
- Replay safety
- Order status updates
- Inventory updates
- Audit logging
- Cache invalidation

### **Stored Order Fields**

- subtotal
- shipping
- total
- Stripe fees
- timestamp

---

# **5. ADMIN DASHBOARD**

Pages under `/admin` include:

- Product list
- Product CRUD
- Pricing editor
- Inventory adjustments
- Audit log viewer
- Revenue analytics (last 30 days)

Audit logs must record:

- who performed the action
- what type of action
- old value → new value
- timestamp

---

# **6. SECURITY REQUIREMENTS**

### **Application Security**

- CSP
- HSTS
- Frame-ancestors: deny
- Strict MIME
- HTTPS-only cookies
- Secure, HttpOnly, SameSite Strict

### **Rate Limiting**

Using Upstash on:

- `/api/*`
- `/auth/*`
- `/checkout/*`
- `/admin/*`

### **Database Security**

- RLS enforced
- No table without policies
- Tenant isolation logic

### **Secrets**

- Stored in GitHub/Vercel secrets
- Never in repo

### **Stripe Security**

- Enforce webhook signature
- JIT verification per request

### **Logging Security**

- No PII
- No raw tokens
- No emails in logs

---

# **7. OBSERVABILITY**

### **Structured Logging**

- JSON logs
- `requestId` propagation
- route, user, timing

### **Health Endpoints**

- `/healthz` → always 200
- `/readyz` checks:
    - DB connectivity
    - Stripe secret loaded
    - env.ts validation
    - runtime sanity

---

# **8. FRONTEND REQUIREMENTS (“Breathtaking”)**

- Modern animations (Framer Motion)
- Red/black aggressive brand identity
- High-contrast product cards
- Responsive, mobile-first layout
- Smooth micro-interactions
- Hover/tap transitions
- Sleek, focused search experience
- Skeleton loading states

The MVP must **feel like a premium brand site**, even at this early stage.

---

# --------------------------------------

# **DAY-BY-DAY EXECUTION PLAN (NOV 13–23)**

# --------------------------------------

## **NOV 13 — Repo Initialization**

- Create repo with `main` + `jacob-dev`.
- Add CI skeleton.
- Add `.env.example`.
- Add case-enforcement scripts (file + env).
- Add initial folder structure.
- Add MVP_PLAN.md.

---

## **NOV 14 — Environment + Platform Setup**

- Implement `env.ts` validator.
- Create Vercel staging + prod.
- Create Supabase staging + prod.
- Connect GitHub → Vercel.
- Add CI steps for case enforcement.

---

## **NOV 15 — Database Work**

- Implement full multi-tenant-ready schema.
- Add indexes for search.
- Add migrations.
- Push to staging.
- Implement RLS baseline.

---

## **NOV 16 — Auth & Admin**

- Configure Supabase Auth.
- Build login/logout pages.
- Implement `profiles` with roles.
- Require 2FA for admins.
- Protect `/admin` with middleware.
- Support multiple admins.

---

## **NOV 17 — Catalog + Search + UI Polish**

- Implement catalog ISR pages.
- Implement product detail ISR.
- Build search bar.
- Implement filters (brand, shoe size, clothing size).
- Add sorting + pagination.
- Add UI polish (brand theme + animations).

---

## **NOV 18 — Checkout + Webhooks**

- Implement `/api/checkout`.
- Store pending orders.
- Implement Stripe webhook:
    - signature verification
    - idempotency
    - order update
    - inventory update
    - cache invalidation
- Test flow in Stripe test mode.

---

## **NOV 19 — Admin Dashboard + Analytics**

- CRUD for products.
- Pricing tools.
- Inventory adjustments.
- Admin audit logging.
- Revenue analytics page.

---

## **NOV 20 — Security + Rate Limits + Logging**

- Add CSP, HSTS, strict headers.
- Add Upstash rate limiting.
- Implement structured logging.
- Add `/healthz` + `/readyz`.

---

## **NOV 21 — Staging Full Test**

- Wire staging deploy in CI.
- Run full E2E test:
    - catalog
    - search
    - checkout
    - admin
    - logs
    - cache
    - rate limit
- Fix critical issues.

---

## **NOV 22 — Slack Day**

- Bug fixing.
- Additional polish.
- Final performance optimizations.

---

## **NOV 23 — Release Day**

- Merge → `main`.
- Create tag: `v0.1.0`.
- Production deployment.
- Smoke tests:
    - healthz
    - readyz
    - product page
    - checkout
    - admin UI
- MVP COMPLETE.