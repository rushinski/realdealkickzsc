# REAL DEAL KICKZ SC — SOFTWARE DEVELOPMENT & MAINTENANCE AGREEMENT  
*(Full Project Lifecycle: MVP → Scaling → Maintenance + Security & DevOps Integration)*

---

## 1. PARTIES

**Client (Owner):** Josiah Smith, operating as “Real Deal Kickz SC”  
**Developer:** Jacob Rushinski  
**Effective Date:** 11/12/2025  
**Contract Renewal Date:** Annually, unless terminated or amended.

---

## 2. PURPOSE & OVERVIEW

Developer agrees to design, implement, and maintain a **secure, full-stack e-commerce platform** under the “Real Deal Kickz SC” brand.  
The project replaces the Client’s existing Shopify system with a modern, high-performance, secure, and fully owned architecture.

All **source code, intellectual property, and associated assets** created under this agreement shall belong exclusively to the **Client**.

---

## 3. TIMELINE & CONTRACT DURATION

- **MVP Completion Deadline:** November 23, 2025, 11:59 PM EST  
- Client may terminate or seek alternative options if MVP is not delivered by this date.  
- If the MVP is not satisfactory, the Client may terminate at their discretion.  
- The contract remains active through **Phase 4**, after which it may transition to a renewable **Maintenance Agreement**.  

---

## 4. PROJECT PHASES

### **Phase 1 — MVP (Launch)**

**Deliverables:**
- Next.js + Supabase full-stack application
- Stripe Checkout + Apple Pay integration
- Flat-rate shipping
- Supabase Auth (with 2FA for Admins; supports multiple admin accounts at MVP)
- Admin dashboard with CRUD, profit analytics
- Responsive red/black UI
- Docker-based local dev environment
- CI/CD setup (GitHub Actions → Vercel)
- Secure deployment pipeline

**Security:** HTTPS (Vercel + Caddy), rate limiting, Supabase RLS, Helmet middleware.  
**DevOps:** Docker + Compose, GitHub Actions, `.env` secrets, automated deploy on merge.  
The platform does not calculate or remit taxes; any tax obligations remain the Client's responsibility.


---

### **Phase 2 — Post-MVP (User Experience & Monitoring)**

**Additions:**
- Google Pay + Link by Stripe
- Dynamic shipping via Shippo/EasyPost
- Email notifications (restocks, updates)
- Advanced filters (designer, condition)
- Sentry error tracking + PostHog analytics
- SEO improvements, sitemap automation

**DevOps Enhancements:**
- Dependabot + CodeQL scans
- Admin activity audit logs
- CI test coverage with Jest + Playwright

---

### **Phase 3 — Scaling & Automation**

**Goals:**
- Production-grade CI/CD (zero downtime)
- Automated report exports (CSV)
- Advanced admin roles and permission management (baseline supports multiple admin accounts from MVP)
- Staging environment for QA
- Edge middleware for caching/rate limiting
- Sentry/PostHog dashboards for monitoring

**Infrastructure:**
- Docker multi-stage builds
- Supabase Pro upgrade if needed
- Cloudflare R2 for image scaling
- TLS auto-renew (Caddy)

---

### **Phase 4 — Intelligence Layer**

**Focus:**
- PostHog event analysis (user flows, conversions)
- Customer insights dashboard
- Abandoned cart detection
- ML-ready data schema for predictive analytics
- Developer observability portal (traffic, uptime, logs)

---

### **Phase 5 — Maintenance & Long-Term Support**

**Commitments:**
- Monthly performance & uptime checks
- Weekly error reviews
- Supabase backup verification
- Quarterly dependency & infra updates
- Continuous CI/CD monitoring
- Optional headless CMS (Sanity) integration
- Long-term scalability maintenance

**Maintenance Agreement:**
Developer provides free ongoing maintenance for MVP and short-term post-launch.  
Feature expansions or new capabilities will be separately scoped and approved.

---

## 5. MAINTENANCE & RENEWAL TERMS

- After Phase 4 completion, Developer provides **free upkeep** (≤5 hours/week) covering bug fixes, small UI updates, uptime checks, and dependency updates.  
- Larger feature requests or new modules require separate written agreements.  
- The Client retains **full administrative access** to repositories, environments, and deployed services at all times.  
- The contract renews annually, with optional renegotiation of maintenance terms.  

---

## 6. SOFTWARE OWNERSHIP & RIGHTS

1. **Full Ownership** —  
   All intellectual property, source code, documentation, configuration files, and derivative works developed under this agreement become the **sole property of the Client** upon creation.  

2. **License to Developer** —  
   The Developer retains a **non-exclusive, non-transferable right** to reference the work in public portfolios and technical demonstrations (excluding confidential business data and sensitive data).  

3. **Delivery Obligations** —  
   Upon project handoff or termination, the Developer must deliver:  
   - Complete GitHub repository ownership transfer  
   - All `.env` templates and deployment instructions  
   - Dockerfiles, CI/CD configurations, and infrastructure definitions  
   - Any auxiliary service credentials (e.g., Supabase, Stripe, Vercel)  

4. **Client Control** —  
   The Client has perpetual and exclusive rights to host, modify, redistribute, or commercialize the website and any associated source materials.  

5. **No Revocation Clause** —  
   The Developer cannot revoke or restrict the Client’s ownership, access, or use under any circumstance.

---

## 7. TERMINATION CONDITIONS

- Failure to deliver MVP by November 23, 2025 → Client may terminate.  
- Dissatisfaction with MVP result → Client may terminate immediately.  
- Either party may terminate after MVP completion with 30 days’ notice.  
- Upon termination, Developer shall deliver all project files, including full repository access and deployment materials.

---

## 8. LIABILITY

- Developer’s total liability is limited to fees paid.  
- Developer is not responsible for failures caused by third-party services (e.g., Stripe, Supabase, Vercel).  

---

## 9. AGREEMENT & SIGNATURE

This contract remains valid through completion of **Phase 4** and may continue as a renewable maintenance agreement thereafter.  
All changes must be agreed upon in writing.

---

**Client (Owner):** ________________________ **Date:** ____________  
**Developer:** _____________________ **Date:** ____________

---

**End of Document — Real Deal Kickz SC Development Agreement**
