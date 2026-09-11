# INFRA_GUIDE.md — Real Deal Kickz

> **Purpose:** Operational and deployment infrastructure reference for the Real Deal Kickz platform. Covers local, staging, and production setup; environment variable management; networking; and backup strategy.

---

## 1) Infrastructure Overview

| Layer | Role | Hosting | Key Tech | Notes |
|-------|------|----------|-----------|-------|
| **Frontend & API** | Public web and API | Vercel | Next.js (App Router) | CI/CD auto-deploy on tag or main merge |
| **Database & Auth** | Persistent data | Supabase Cloud | Postgres + RLS | Managed backups, daily snapshots |
| **Payments** | Transactions | Stripe | Hosted Checkout | No card data stored; webhook listener in app |
| **Proxy** | Local reverse proxy | Caddy (Docker) | TLS simulation | Local/dev only, optional VM Phase 3 |
| **CI/CD** | Build, test, deploy | GitHub Actions | Node, Docker, Vercel CLI | Automated lint/test/build/deploy pipeline |

**Topology (MVP)**
```mermaid
flowchart LR
  subgraph Local
    Dev[Docker Compose: web+db+caddy]
  end
  Dev -->|push→main| CI[GitHub Actions]
  CI -->|deploy| Vercel[Vercel (Next.js)]
  Vercel --> Supabase[(Supabase DB/Auth/Storage)]
  Vercel --> Stripe[Stripe Checkout]
```

---

## 2) Environment Management

### 2.1 File Layout
```
.env.example
.env.local       # developer machine
```
Vercel manages production/staging environment variables securely. No secrets committed to git.

### 2.2 Variable Scopes
| Context | Storage | Purpose |
|----------|----------|----------|
| **Local Dev** | `.env.local` | Personal testing, Stripe test keys |
| **CI/CD** | GitHub Secrets | Build/test credentials only |
| **Prod Deploy** | Vercel Env Vars | Live runtime, Stripe live keys |

### 2.3 Naming Conventions
```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SENTRY_DSN=
POSTHOG_KEY=
```

### 2.4 Validation
Each environment validated by startup script `check_env.py` (Phase 2) to ensure required vars exist before build/deploy.

---

## 3) Local Development Setup

**Core stack:** Docker Compose with services for Next.js, Caddy, and Postgres (via Supabase CLI).

**compose.yml**
```yaml
services:
  web:
    build: ./app
    ports:
      - "3000:3000"
    env_file:
      - .env.local
    depends_on:
      - db
    command: ["npm", "run", "dev"]

  db:
    image: supabase/postgres
    ports:
      - "5432:5432"
    volumes:
      - db_data:/var/lib/postgresql/data

  caddy:
    image: caddy:latest
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./infra/Caddyfile:/etc/caddy/Caddyfile

volumes:
  db_data:
```

**Startup:**
```bash
docker compose up --build
```
Access at https://localhost (Caddy TLS proxy).

---

## 4) CI/CD Pipeline

### 4.1 Branch Strategy
| Branch | Environment | Behavior |
|---------|--------------|-----------|
| `jacob-dev` | Dev | Manual builds or previews |
| `main` | Prod | Merge → GitHub Actions → Vercel deploy |

### 4.2 GitHub Actions Workflow (Simplified)
```yaml
name: Deploy
on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run lint && npm run test
      - run: npm run build
      - run: npx vercel --token ${{ secrets.VERCEL_TOKEN }} --prod
```

### 4.3 Version Enforcement
- **Git Tags:** Every production deployment tagged (e.g., `v0.1.0`, `v0.1.1`).
- **CI check:** Blocks deployment if no version tag on commit.

---

## 5) Database & Storage

- **Managed Postgres (Supabase)** with row-level security.
- **Automatic Backups:** Daily snapshots (7-day retention by default).
- **Verification:** Manual restore test monthly (Phase 2 automation).
- **Storage:** Supabase buckets for product images; pre-generated variants.

**Local Parity (optional):** Supabase CLI emulation (`supabase start`).

---

## 6) Networking & Domains

| Layer | Purpose | Provider |
|--------|----------|-----------|
| **DNS** | Domain & subdomains | Cloudflare |
| **CDN** | Asset caching | Vercel Edge Network |
| **TLS** | HTTPS | Vercel (Prod), Caddy (Local) |
| **Proxy** | Optional Phase 3 Caddy VM | DigitalOcean / AWS |

**Firewall Rules:** Supabase → accept only Vercel origins. Stripe → allow inbound from Stripe IP ranges.

---

## 7) Monitoring & Logging

| Tool | Purpose |
|------|----------|
| **Sentry** | Error tracking |
| **PostHog** | Analytics & feature tracking |
| **Vercel Analytics** | Performance metrics |
| **Supabase Logs** | DB access and RLS audits |

Logs stored 7 days in Supabase dashboard; critical alerts routed via email/Slack.

---

## 8) Backup & Disaster Recovery

| Layer | Mechanism | Frequency | Verification |
|--------|------------|------------|---------------|
| **Supabase DB** | Managed snapshots | Daily | Monthly restore test |
| **Storage** | Supabase bucket versioning | Daily diff | Manual Phase 2 verification |
| **CI Artifacts** | GitHub repository | Continuous | Version tags (immutable) |

**Restoration:** restore snapshot → verify schema → re-sync images → redeploy tagged version.

---

## 9) Access Control

| Role | Access | Enforcement |
|------|---------|-------------|
| **Admin** | Vercel dashboard, Supabase console, GitHub repo | SSO / 2FA required |
| **Developer** | Local dev + PRs | Reviewer approval required |
| **CI/CD Bot** | Deployment only | Scoped GitHub token |

---

## 10) Scaling Path (Phase 3+)

- Add staging environment (`staging.realdealkickz.app`) for pre‑release testing.
- Introduce private **worker container** behind Caddy for asynchronous jobs.
- Switch image hosting to **Cloudflare R2** for cost reduction.
- Enable **auto‑restore tests** for DB + file backups.

---

## 11) Troubleshooting Playbook

| Symptom | Likely Cause | Remedy |
|----------|--------------|--------|
| Build fails on Vercel | Missing env vars | Recheck Vercel env tab |
| API 403 errors | RLS misconfig | Review Supabase policy logs |
| Webhook 400 errors | Signature mismatch | Confirm `STRIPE_WEBHOOK_SECRET` |
| Caddy cert errors | Port conflict / reused volume | Prune and rebuild containers |

---

## 12) CVL Checkpoints (Infra Layer)

| Risk | Mitigation |
|------|-------------|
| Config drift | Docker parity; `.env.example` maintained |
| Secret leakage | Centralized secrets; rotation schedule |
| Build inconsistency | Tag‑based version enforcement |
| Backup failure | Manual restore validation; alerts Phase 2 |
| Unexpected cost growth | Monitor Supabase storage + Vercel usage monthly |

---

**Infra baseline established for MVP → scaling path defined for Phase 3+.**

