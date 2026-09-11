# REAL DEAL KICKZ SC — SOFTWARE DEVELOPMENT & MAINTENANCE AGREEMENT
*(Full Project Lifecycle: MVP → Scaling → Maintenance + Security & DevOps Integration)*

---

## 1. PARTIES

**Client:** Josiah Smith, operating as “Real Deal Kickz SC”  
**Developer:** Jacob Rushinski 
**Effective Date:** 11/11/2025  
**Contract Renewal Date:** Annually, unless terminated or amended.

---

## 2. PURPOSE & OVERVIEW

Developer agrees to design, implement, and maintain a **secure, full-stack e-commerce platform** for the Client under the “Real Deal Kickz SC” brand.  
This platform replaces the current Shopify setup, introducing modern architecture, enhanced speed, and enterprise-grade security and DevOps practices.

The project lifecycle follows the **Real Deal Kickz — System Plan**, which includes MVP → Scaling → Automation → Intelligence → Maintenance.

---

## 3. TIMELINE & CONTRACT DURATION

- **MVP Completion Deadline:** November 23, 2025, 11:59 PM EST.  
- If the MVP is not completed by this date, the Client may explore other options or terminate this agreement.  
- If the Client is not satisfied with the MVP upon delivery, the contract may be terminated at the Client’s discretion.  
- The contract remains in effect through **completion of Phase 4** unless terminated earlier.  
- Upon completion of Phase 4, the contract may transition into a **Maintenance Agreement** as defined in Section 7.  

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

## 5. POST-PHASE 4 MAINTENANCE & RENEWAL TERMS

- After Phase 4 completion, Developer provides **free reasonable upkeep** of up to **5 hours per week**.  
- “Reasonable upkeep” includes bug fixes, small UI adjustments, uptime checks, and dependency updates.  
- Feature requests beyond routine upkeep may incur fees, subject to discussion and mutual agreement.  
- If the Developer voluntarily offers new features and agrees to perform them for free, that is permitted.  
- The contract renews **annually**, with terms and fees eligible for renegotiation each renewal year.

---

## 6. SOFTWARE OWNERSHIP & RIGHTS

- As the software is being developed and maintained **free of charge**, the **Developer retains ownership** of the software.  
- The Developer **cannot revoke** the Client’s use of the deployed or working versions of the software.  
- If the Client wishes to **purchase full ownership** of the software, the Developer may negotiate a buyout price.  
- If the Developer and Client part ways, the Developer retains ownership, but the **Client retains the most up-to-date working version** of the software for continued use.  
- The **System Plan** and all **estimated pricing or costs** are subject to change based on design constraints or technical anomalies.

---

## 7. TERMINATION CONDITIONS

- Failure to deliver the MVP by November 23, 2025 → Client may terminate or seek alternative developers.  
- Client dissatisfaction with MVP result → Client may terminate immediately.  
- Either party may terminate after MVP completion with 30 days’ written notice.  
- Upon termination, Developer shall provide the Client with all source code, documentation, environment files, and deployment instructions.

---

## 8. LIABILITY

- Developer’s total liability is limited to fees paid (MVP is no-cost).  
- Developer is not responsible for failures caused by third-party services (Stripe, Supabase, Vercel, etc.).  

---

## 9. AGREEMENT & RENEWAL

This contract remains active until the completion of **Phase 4** and may continue as a renewable yearly maintenance agreement thereafter.  
All changes or additional features must be agreed upon in writing.  

---

**Client:** ________________________ **Date:** ____________  
**Developer:** _____________________ **Date:** ____________

---

**End of Document — Real Deal Kickz SC Development Agreement**
