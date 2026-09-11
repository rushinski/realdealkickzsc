# MONITORING_GUIDE.md — Real Deal Kickz

> **Purpose:** Defines the monitoring, alerting, and observability framework for the Real Deal Kickz platform. Ensures system reliability, performance visibility, and actionable alerting at MVP through scaling phases.

---

## 1) Objectives

1. Detect and resolve production issues before customers are impacted.
2. Maintain continuous insight into performance (latency, errors, uptime, conversion).
3. Establish measurable **Service Level Objectives (SLOs)**.
4. Ensure traceability of errors, logs, and metrics across the stack.

---

## 2) Monitoring Stack Overview

| Layer | Tool | Purpose |
|-------|------|----------|
| **Frontend/API** | **Vercel Analytics** | Performance metrics (TTFB, FCP, LCP) |
| **App Errors** | **Sentry** | Exception tracking, alerting, stack traces |
| **User Events** | **PostHog** | User behavior analytics, funnels, feature usage |
| **Database** | **Supabase Logs** | Query latency, access audit, policy violations |
| **CI/CD** | **GitHub Actions Logs** | Build/test/deploy diagnostics |

---

## 3) Metrics & Dashboards

### 3.1 Key Metrics
| Category | Metric | Target / Threshold |
|-----------|---------|--------------------|
| **Availability** | API uptime | ≥ 99.9% |
| **Performance** | Avg page load (FCP) | ≤ 2s |
| **Checkout Success** | Payment completion rate | ≥ 98% |
| **Error Rate** | <1% of requests return 5xx | Alert if exceeded |
| **Database Health** | Query latency | <200ms p95 |
| **Webhooks** | Stripe webhook success | ≥ 99.5% |

### 3.2 Dashboards
- **Weekly Dashboard Review:** Monday 10:00 ET
- **Dashboard Owners:** Admin team lead

Tools:
- Vercel → Deploy & performance overview
- Sentry → Issue trends & release tracking
- PostHog → Conversion funnels, event heatmaps
- Supabase → DB latency, RLS violation counts

---

## 4) Alerts & Severity Levels

| Severity | Description | Example | Response SLA |
|-----------|--------------|----------|---------------|
| **P0 (Critical)** | User-facing outage or checkout blocked | Stripe webhook failures, 100% 5xx spike | Immediate (<30 min) |
| **P1 (High)** | Major feature broken (non-payment) | Admin dashboard unresponsive | 1 hour |
| **P2 (Moderate)** | Elevated error rate or slow DB | p95 latency >400ms | 4 hours |
| **P3 (Low)** | Minor degradation | API 404 increase | 24 hours |

### 4.1 Alert Channels
- **Primary:** Email notifications (ops@realdealkickz.com)
- **Secondary:** Slack `#alerts` (Phase 2)
- **Optional:** SMS for P0 (via Twilio Phase 3)

---

## 5) Log Management

### 5.1 Sources
| Source | Retention | Notes |
|---------|------------|-------|
| **Vercel Edge Logs** | 7 days | Request/response, region, latency |
| **Sentry** | 30 days (free plan) | Error stacks, environment tags |
| **Supabase** | 7 days (default) | Auth & RLS policy events |
| **GitHub Actions** | 90 days | Build/test logs |

### 5.2 Log Hygiene
- PII scrubbed before logging.
- Sensitive data (tokens, keys, addresses) redacted in middleware.
- Logs centralized visually via dashboards; aggregation tooling optional (Phase 3: Logtail / Grafana Loki).

---

## 6) Alert Rules & Examples

**Sentry Rules**
- Trigger on: new error >5/min or 5xx spike >2% over baseline.
- Severity tags: `critical`, `warning`, `info`.

**PostHog Rules**
- Alert when checkout drop-off >10% week-over-week.

**Supabase Rules**
- Trigger when query latency >200ms p95.

**Vercel Rules**
- Uptime check failures or build errors alert via email.

---

## 7) Observability Practices

| Area | Policy |
|------|--------|
| **Error Grouping** | Deduplicate via Sentry fingerprinting |
| **Release Tracking** | Link errors to GitHub tags (`vX.Y.Z`) |
| **Traceability** | Tag requests with `x-request-id` for end-to-end tracing |
| **Metric Correlation** | Cross-reference PostHog conversion dips with Sentry spikes |
| **Performance Audits** | Lighthouse CI run biweekly (Phase 2+) |

---

## 8) Incident Workflow

1. **Detection:** Alert triggers in Sentry/Vercel.
2. **Classification:** Assign P0–P3 severity.
3. **Acknowledgement:** Respond within SLA window.
4. **Containment:** Disable impacted feature if necessary.
5. **Resolution:** Apply fix, redeploy.
6. **Review:** Create postmortem in `/docs/incidents/YYYY-MM-DD.md`.

---

## 9) Testing & Validation

- **Pre-deploy tests:** CI pipeline includes lint, test, and build.
- **Monitoring validation:** Health checks (`/healthz`, `/readyz`) polled every 60s by uptime monitor (e.g., UptimeRobot).
- **Alert tests:** Monthly simulated P0 (disable webhook endpoint temporarily) to validate alerts.

---

## 10) Phase Expansion Path

| Phase | Enhancement |
|--------|--------------|
| **Phase 1 (MVP)** | Sentry, PostHog, Vercel Analytics basic alerts |
| **Phase 2** | Slack alerts, structured logs, weekly review cadence |
| **Phase 3** | SMS escalation, Grafana/Loki aggregation, auto root-cause tagging |
| **Phase 4** | Predictive anomaly detection, user journey correlation |

---

## 11) CVL Validation Points (Monitoring Layer)

| Risk | Mitigation |
|------|-------------|
| Alert noise / fatigue | Tune thresholds, group similar errors |
| Missed incidents | Add redundant monitors (Vercel + uptime bot) |
| Data drift | Cross-check metrics weekly vs logs |
| Unclear ownership | Assign dashboard & alert owners |
| PII leakage | Scrub logs and enforce Sentry filters |

---

**Monitoring baseline established for MVP with structured growth path to Phase 4 observability.**

