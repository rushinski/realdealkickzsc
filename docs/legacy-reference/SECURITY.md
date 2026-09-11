# SECURITY.md — Real Deal Kickz

> **Security posture for MVP with forward path to Phase 2+.** Decisions in this doc reflect the client’s confirmations:
> - **Admins:** Mandatory 2FA at MVP; **no session reuse after the page/browser closes**; page refresh keeps the session; **multiple admin accounts** supported.
> - **RLS baseline:** OK as proposed.
> - **Secrets:** `.env` (local), GitHub Actions secrets, and Vercel project env vars.
> - **Payments:** Stripe Checkout only; **no card data stored**; **taxes out of scope for all phases (handled externally by Client)**.
> - **PII retention:** Retain **only** for users who create accounts; guests are not persisted.

---

## 1) Security Goals & Scope (MVP)

1. Prevent account takeover of **admin** identities (mandatory 2FA, short‑lived sessions, CSP/HSTS).
2. Enforce **least privilege** access to data (RLS + role‑based APIs).
3. Protect secrets and keys in CI/CD and runtime (centralized secret stores, rotation, no plaintext in repo).
4. Maintain payment integrity via **Stripe Checkout + webhooks** (signature verification + idempotency).
5. Keep PII surface minimal — **store only for registered users**; allow deletion upon request.

Out of scope: Tax computation, PCI SAQ-A beyond Stripe Checkout requirements, SOC2/ISO formal compliance. Any tax obligations are handled externally by the Client; the platform will not implement tax calculation or remittance.

---

## 2) Identities, AuthN & Sessions

### 2.1 Identity Providers
- **Supabase Auth** (email/password + TOTP 2FA) for customers and admins.
- Roles: `customer`, `admin` (optionally `ops` in Phase 2).

### 2.2 Admin 2FA (Mandatory)
- Enforce TOTP enrollment for any user assigned `admin` role **before** granting dashboard access.
- Admin login flow: email+password → TOTP → session issuance.

### 2.3 Session Model (Confirmed)
- **While page/tab is open:** session remains valid (page refresh **does not** force re‑login).
- **After page/browser close:** user must log in again.
- Implementation guidance:
  - Use **cookie‑based sessions** (HTTPOnly, `Secure`, `SameSite=Lax`), **no token in `localStorage`**.
  - Use **non‑persistent session cookies** (no `Expires`), re‑established only via fresh login after browser close.
  - Session lifetime (inactivity): 30–60 minutes recommended; refresh on activity (optional). No hard “device/session count” limits at MVP.

### 2.4 Account Management
- Multiple admin accounts allowed at MVP.
- Admin creation only by an existing admin; changes audited (Phase 2+ persistent audit log).

---

## 3) Authorization (RLS & App‑Level)

### 3.1 Tables & Policies (baseline)
- `products`: readable by all; write restricted to `admin`.
- `orders`: users can `SELECT` only their own orders; `INSERT` via webhook/session context; `UPDATE` by `admin` or system.
- `profiles`: users can `SELECT/UPDATE` self‑row; admins read all.

**Example (illustrative) RLS policy snippets**
```sql
-- orders: customers can see only their orders
create policy customer_read_own_orders on public.orders
for select using (auth.uid() = user_id);

-- orders: only system/admin can update fulfillment status
create policy admin_update_orders on public.orders
for update using (exists (
  select 1 from public.user_roles ur
  where ur.user_id = auth.uid() and ur.role = 'admin'
));

-- products: public read
create policy public_read_products on public.products
for select using (true);

-- products: only admins write
create policy admin_write_products on public.products
for insert with check (exists (
  select 1 from public.user_roles ur
  where ur.user_id = auth.uid() and ur.role = 'admin'
));
```

### 3.2 App‑Level Guards
- Admin routes protected by middleware checking `role=admin` claim.
- Server Actions and Route Handlers verify role claims server‑side; no client‑only trust.

---

## 4) Payments Security (Stripe)

- **Checkout only** (Stripe‑hosted): site never handles raw PAN/CVV.
- Webhooks: verify **signature** with `STRIPE_WEBHOOK_SECRET`; use **idempotency keys** when mutating orders.
- Store only Stripe identifiers (e.g., `checkout.session.id`, `payment_intent.id`) and non‑sensitive amounts/statuses.
- Refunds and disputes managed via Stripe Dashboard (MVP). Admin actions are mirrored to orders table.
- **Taxes:** explicitly out of scope for MVP.

---

## 5) Data Classification & Retention

### 5.1 Classes
- **Public**: product catalog, images.
- **Internal**: logs/metrics, non‑PII operational data.
- **PII**: name, email, shipping address (only for registered accounts).
- **Sensitive (3rd‑party)**: Stripe tokens/IDs (not card data).

### 5.2 Retention Rules (MVP)
- **Guests**: no persistent PII.
- **Registered users**: retain account PII until account deletion; support **Right to Erasure** upon request.
- **Orders**: retain financial records needed for business accounting (non‑card data) — default 24 months (configurable) or per client directive.
- Backups follow Supabase retention defaults; access restricted to admins.

---

## 6) Secrets Management

- **Local dev**: `.env.local` (never committed). Provide `.env.example` with placeholders.
- **CI**: GitHub Actions **encrypted secrets**. Jobs read only the keys they need.
- **Prod**: Vercel Project **Environment Variables** (Preview/Production scopes).
- Rotation: on key exposure and quarterly (Phase 2 policy); maintain a rotation log.

Key examples
```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_ANON_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
SENTRY_DSN
```

---

## 7) Web App Hardening

- **TLS**: Vercel auto‑TLS for production; Caddy TLS for local/dev only.
- **CSP**: strict default‑deny with explicit allow‑lists (tune per integration).

**Recommended CSP (baseline, adjust domains)**
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.vercel.app https://js.stripe.com https://cdn.posthog.com;
  connect-src 'self' https://*.supabase.co https://*.vercel.app https://api.posthog.com https://js.stripe.com;
  img-src 'self' data: https://public.supabase.storage https://*.vercel.app;
  style-src 'self' 'unsafe-inline';
  frame-src https://js.stripe.com;
  base-uri 'self';
  frame-ancestors 'none';
```

Other headers
- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY` (use `frame-ancestors` in CSP when possible)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`: disable unnecessary APIs (geolocation, camera, etc.)

---

## 8) Logging, Monitoring & Auditing

- **Errors**: Sentry (PII scrubbing enabled).
- **Product analytics**: PostHog with IP anonymization.
- **Access logs**: Vercel edge logs; Supabase audit logs.
- **Admin audit (Phase 2+)**: table `admin_audit_log` for product CRUD, order state changes, role changes.

**Alerting (minimum)**
- P0: webhook signature failures, payment success rate dips.
- P1: 5xx spikes on admin/API routes.
- Destination: configured email/Slack channel.

---

## 9) CI/CD & Supply‑Chain Security

- GitHub branch protection on `main`; PR required with status checks (lint/test/build) before deploy.
- **Least‑privilege CI**: tokens scoped to required projects only; no long‑lived deploy tokens in repo.
- Dependency hygiene: Dependabot, `npm audit` in CI; Pin major versions; lockfile committed.
- Build provenance (Phase 2+): enable build metadata, signed artifacts if/when applicable.

---

## 10) Incident Response (IR) — MVP Playbook

1. **Detect**: alert triggers (webhook verify failure, auth anomaly, error spike).
2. **Triage**: classify severity (P0/P1/P2), assign incident lead.
3. **Contain**: temporarily disable affected features (e.g., admin panel), rotate impacted secrets.
4. **Eradicate**: patch vulnerability, add test to prevent regression.
5. **Recover**: redeploy; verify via smoke tests.
6. **Postmortem**: within 48h — root cause, timeline, action items with owners and due dates.

---

## 11) Privacy & User Rights

- Store PII **only** for registered accounts.
- Provide export/delete on request; validate requester identity via fresh login + TOTP (if enabled).
- Avoid logging PII; mask any incidental PII in logs.

---

## 12) Phase‑Upgrades (Preview)

- **Phase 2**: comprehensive admin audit log; device/session management; automated secrets rotation; enhanced CSP; canary deploys; formal DR drills.
- **Phase 3**: rate limiting at edge; WAF rules; background workers behind Caddy with mTLS; data tokenization for sensitive references.

---

## 13) Security Checklist (MVP Gate)

- [ ] Admins must enroll in **TOTP 2FA** before accessing admin UI.
- [ ] Sessions are **cookie‑based**, HTTPOnly, Secure; **non‑persistent** (require login after browser close).
- [ ] **RLS** enabled and tested for `orders`, `products`, `profiles`.
- [ ] Stripe webhooks **signature‑verified**; **idempotency** enforced on mutations.
- [ ] No card data stored; taxes **out of scope**.
- [ ] PII stored **only** for registered users; guest flows do not persist PII.
- [ ] Secrets: `.env.local` (dev), GitHub Actions secrets, Vercel env vars; no secrets in repo.
- [ ] Core security headers + CSP applied; TLS enforced.
- [ ] Sentry/PostHog configured with PII scrubbing; critical alerts wired.
- [ ] Backup/restore access restricted to admins (Supabase defaults).

