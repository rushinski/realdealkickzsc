# RUNBOOK.md — Real Deal Kickz

> **Purpose:** Operational reference for handling incidents, deployments, and maintenance tasks. This document defines step-by-step playbooks for common scenarios to ensure fast recovery and consistent handling.

---

## 1) Daily Operations Checklist

| Task | Frequency | Owner |
|------|------------|--------|
| Check Sentry alerts | Daily | Admin/DevOps |
| Review Vercel deployments | Daily | Developer |
| Verify Stripe webhook health | Daily | Admin |
| Monitor Supabase logs for RLS violations | Weekly | Developer |
| Validate backups (Supabase snapshot present) | Weekly | Admin |
| Review PostHog funnels | Weekly | Product |

---

## 2) Incident Response — Quick Flow

### 2.1 Trigger Sources
- Sentry P0/P1 alert
- Stripe webhook delivery failure
- API `/readyz` returns non-200

### 2.2 Response Workflow
1. **Acknowledge:** Confirm incident in alert channel (email/Slack).
2. **Assess:** Identify if user-facing outage or internal issue.
3. **Contain:** Disable affected feature via feature flag or rollback build.
4. **Mitigate:** Apply hotfix or config change.
5. **Verify:** Confirm `/healthz` and critical flows are restored.
6. **Document:** Log postmortem under `docs/incidents/YYYY-MM-DD.md`.

**Time Targets:**
- P0: Response <30min; resolution <2h.
- P1: Response <1h; resolution <6h.

---

## 3) Deployment Runbook

### 3.1 Pre‑Deploy
- Ensure **`main` branch** passes CI (lint, tests, build, OpenAPI validation).
- Confirm all secrets exist in Vercel & GitHub Actions.
- Run manual smoke locally: `npm run dev` → `/healthz` = 200.

### 3.2 Release Steps
1. Merge `jacob-dev` → `main`.
2. Tag release:
   ```bash
   git tag -a v0.X.X -m "Release summary"
   git push origin v0.X.X
   ```
3. GitHub Actions auto‑deploys via CI.
4. Monitor build logs (Vercel dashboard).
5. Validate production `/readyz` & key API endpoints.
6. Announce successful release in changelog.

### 3.3 Post‑Deploy Verification
- Run smoke:
  ```bash
  curl -fsS https://realdealkickz.vercel.app/healthz
  curl -fsS https://realdealkickz.vercel.app/api/v1/products
  ```
- Check Sentry for new criticals.
- Validate Stripe webhook delivery.
- Confirm database migrations applied.

---

## 4) Hotfix Procedure

1. Branch from `main` → `hotfix/<issue>`.
2. Commit minimal fix.
3. Tag patch version `vX.Y.Z+1`.
4. Push tag → triggers prod deploy.
5. Verify `/healthz` and `/readyz`.
6. Merge hotfix back into `jacob-dev`.

---

## 5) Backup & Restore Procedure

### 5.1 Backup Verification
- Confirm daily snapshot in Supabase console.
- Run monthly restore to staging.

### 5.2 Restore Steps (Disaster Recovery)
1. Identify target snapshot in Supabase.
2. Restore to new database instance.
3. Update connection string in `.env` (temporary).
4. Redeploy build via tag `vX.Y.Z-recovery`.
5. Verify app operational.

**Data Consistency Validation:**
```sql
select count(*) from orders;
select count(*) from users;
```
Compare counts before/after restore.

---

## 6) Stripe Webhook Failure Recovery

1. Check Stripe Dashboard → Developers → Webhooks → Logs.
2. Locate failed events (400 or timeout).
3. Verify `STRIPE_WEBHOOK_SECRET` in Vercel.
4. Replay event from Stripe Dashboard.
5. Confirm app responds 200 OK.
6. Log event ID in incident file.

---

## 7) Authentication / Admin Lockout

1. Use Supabase Console → Auth → Users.
2. Reset admin password or 2FA key.
3. Confirm re-login works at `/admin`.
4. Rotate session tokens for all admins.
5. Review audit log (Phase 2+).

---

## 8) Monitoring Degradation

1. Vercel Analytics shows TTFB >200ms:
   - Check DB latency via Supabase → Logs.
   - If persistent, add index or tune query.
2. Sentry spike (>5/min):
   - Identify stack trace source.
   - Patch & redeploy hotfix.

---

## 9) Routine Maintenance

| Task | Frequency | Responsible |
|------|------------|--------------|
| Rotate API keys (Stripe, Supabase) | Quarterly | Admin |
| Review CSP headers & security scan | Quarterly | Developer |
| Update npm deps / audit | Monthly | Developer |
| Verify backups + restore test | Monthly | Admin |
| Performance profiling | Bi‑monthly | DevOps |

---

## 10) Communication Templates

### 10.1 Incident Acknowledgment
```
[Incident] P0 — Checkout Unavailable
Start Time: <timestamp>
Impact: Checkout sessions returning 5xx.
Status: Investigating.
Next Update: 30 min.
```

### 10.2 Post‑Incident Summary
```
[Postmortem] Incident ID #2025-11-01
Root Cause: Stripe webhook secret mismatch
Fix: Rotated secret, replayed events.
Prevention: Added alert + env validation.
```

---

## 11) CVL Validation Points (Ops Layer)

| Failure Pathway | Mitigation |
|-----------------|-------------|
| Unclear ownership during incident | Assign roles explicitly in each alert |
| Lost secrets after rotation | Store securely in Vercel + GitHub Secrets |
| Missed backup restore | Monthly verification task mandatory |
| Repeat outage | Postmortem + test added per root cause |
| Unverified release | Tag + smoke verification enforced |

---

**Runbook provides operational discipline ensuring consistent, auditable responses from development through live operations.**

