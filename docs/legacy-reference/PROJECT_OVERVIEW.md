# PROJECT_OVERVIEW.md — Real Deal Kickz

> **Purpose:** Provide a unified reference point linking all technical, operational, and security documentation for the Real Deal Kickz system. This ensures every collaborator, auditor, or maintainer can locate authoritative sources instantly.

---

## 1) Project Summary

**Project Name:** Real Deal Kickz (RDK)  
**Objective:** Deliver a transparent sneaker resale platform that aggregates listings, applies risk scoring, and enables verified transactions through Stripe Checkout — all under modern full-stack architecture (Next.js + Supabase + Vercel).

**Core Philosophy:** Build production-grade infrastructure from MVP onward — every component (infra, API, security, monitoring, deployment) is version-controlled, documented, and validated through **Critical Validation Loop (CVL)** checkpoints.

---

## 2) Documentation Map

| Document | Purpose | Key Maintainer |
|-----------|----------|----------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System and runtime architecture overview, environment model, and evolution plan | Architect / Lead Dev |
| [SECURITY.md](./SECURITY.md) | Access control, RLS, 2FA enforcement, secrets policy, data retention | Security Engineer |
| [API_SPEC.yaml](./API_SPEC.yaml) | Formal OpenAPI 3.1 contract with version enforcement | Backend Dev |
| [INFRA_GUIDE.md](./INFRA_GUIDE.md) | Infrastructure layout (Docker, Vercel, CI/CD), env conventions | DevOps |
| [MONITORING_GUIDE.md](./MONITORING_GUIDE.md) | Metrics, alerting, dashboards, and escalation policy | DevOps / QA |
| [DEPLOYMENT_PIPELINE.md](./DEPLOYMENT_PIPELINE.md) | CI/CD pipeline definition, versioning enforcement, migration flow | CI Engineer |
| [RUNBOOK.md](./RUNBOOK.md) | Operational procedures, incident response, and maintenance workflows | Ops / Admin |

---

## 3) System Snapshot — MVP Baseline

| Layer | Tool | Description |
|--------|------|--------------|
| **Frontend/API** | Next.js (App Router) | SSR + ISR pages, server actions, integrated APIs |
| **Backend DB/Auth** | Supabase | Postgres + Row-Level Security (RLS) |
| **Payments** | Stripe Checkout | Hosted flow, no card data stored |
| **Hosting** | Vercel | Edge-deployed web app |
| **Proxy (local)** | Caddy | TLS emulation, reverse proxy |
| **CI/CD** | GitHub Actions | Lint → Test → Build → Deploy (tag-gated) |
| **Monitoring** | Sentry, PostHog, Vercel Analytics | Errors, performance, conversion tracking |

---

## 4) Development Lifecycle

1. **Plan:** Feature or fix documented and mapped to issue.
2. **Develop:** Work on `jacob-dev` branch.
3. **Validate:** Pass CI checks — lint, test, type, schema.
4. **Merge:** Create PR → Review → Merge to `main`.
5. **Tag:** Semantic tag (e.g., `v0.2.0`) → triggers CI deploy.
6. **Verify:** Run smoke tests, monitor Sentry & metrics.
7. **Document:** Update changelog + relevant doc.

---

## 5) Version Enforcement Policy

- Every production deployment **must** be tied to a **Git tag**.
- Each tag corresponds to a known **OpenAPI version**, **Supabase migration**, and **release notes**.
- No untagged deploys permitted.

**Example:**
```bash
git tag -a v0.1.0 -m "MVP release"
git push origin v0.1.0
```

---

## 6) Operational Ownership Model

| Role | Responsibilities |
|------|------------------|
| **Developer** | Implements features, manages migrations, runs local builds |
| **Admin** | Maintains Vercel & Supabase access, manages secrets |
| **DevOps** | Monitors uptime, manages CI/CD, validates backups |
| **Security Lead** | Oversees RLS, 2FA, and compliance evolution |
| **Product Owner** | Prioritizes roadmap, monitors performance outcomes |

All roles align with **least-privilege** principle and rotation of credentials every quarter.

---

## 7) Health & Monitoring

- **Endpoints:** `/healthz` (liveness) and `/readyz` (readiness) respond 200 OK when system stable.
- **Alerts:** Sentry P0/P1 emails, Vercel uptime checks.
- **SLOs:** API uptime ≥99.9%, Checkout success ≥98%.

---

## 8) Disaster & Recovery Overview

- **DB Backups:** Daily via Supabase; verified monthly.
- **Rollback:** Redeploy previous tagged build via Vercel or `vercel --prod --archive <id>`.
- **Hotfix:** Branch from `main`, tag patch version, redeploy.
- **Restoration:** Snapshot restore + migration resync.

---

## 9) Compliance & Data Ethics

- **Data Retention:** Only for registered users.
- **PII Handling:** No storage of card data; Stripe handles PCI.
- **Security:** All secrets stored in Vercel + GitHub Secrets; rotation enforced.
- **Audit Readiness:** Logs retained 30 days minimum; RLS enforced; CSP active.

---

## 10) CVL (Critical Validation Loop) Enforcement

Each doc and process passes CVL:
- **Assumptions Check:** Validate tech decisions quarterly.
- **Failure Pathways:** Track known risks & mitigations.
- **Redundancy Check:** Avoid duplicate infra or pipelines.
- **Goal Alignment:** Tie all work to north-star deliverable (production-grade reliability).
- **Execution Risk:** Secret exposure, cost creep, schema drift monitored.
- **Strategic Soundness:** Prefer proven managed services over custom ops.

---

## 11) Phase Roadmap Summary

| Phase | Theme | Focus |
|--------|--------|--------|
| **Phase 1 — MVP** | Foundation | Auth, checkout, product CRUD, CI/CD |
| **Phase 2 — Post-MVP** | Hardening | Sentry, PostHog, Dependabot, audit logs |
| **Phase 3 — Scaling** | Resilience | Staging, background workers, R2 storage |
| **Phase 4 — Intelligence** | Insights | User analytics, reporting, ML readiness |
| **Phase 5 — Maintenance** | Longevity | Security patches, uptime audits, CMS integration |

---

## 12) File & Folder Summary
```
/ (repo root)
├─ app/                  # Next.js frontend/API
├─ docs/                 # All markdown & spec docs
│  ├─ ARCHITECTURE.md
│  ├─ SECURITY.md
│  ├─ API_SPEC.yaml
│  ├─ INFRA_GUIDE.md
│  ├─ MONITORING_GUIDE.md
│  ├─ DEPLOYMENT_PIPELINE.md
│  └─ RUNBOOK.md
├─ infra/                # Docker, Caddy, compose configs
├─ .github/workflows/    # CI/CD pipeline definitions
└─ .env.example          # environment variable template
```

---

## 13) Handoff Expectations

- **New Engineer:** Read ARCHITECTURE.md and INFRA_GUIDE.md first.
- **Ops Onboarding:** Read RUNBOOK.md and MONITORING_GUIDE.md.
- **Security Review:** Audit SECURITY.md and DEPLOYMENT_PIPELINE.md.
- **API Integration:** Follow API_SPEC.yaml version corresponding to deployed tag.

---

**Real Deal Kickz System — production‑grade discipline from MVP to scale.  
This overview connects every operational layer for full traceability and clarity.**

