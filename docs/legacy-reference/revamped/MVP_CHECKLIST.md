# Real Deal Kickz — MVP Implementation Checklist

## 1. Database & Models
- [ ] Add `tags` to products (array or join table)
- [ ] Create `shipping_profiles` table
- [ ] Add order fields: status, tracking_number, carrier, shipping_address
- [ ] Ensure all tables include tenant/seller context
- [ ] Run migrations on staging & prod

## 2. Storefront
- [ ] Home page polished
- [ ] Catalog with filters (brand, size, tags)
- [ ] Product detail with images & tag chips
- [ ] Search working with filters
- [ ] About, Contact, FAQ, Legal pages

## 3. Auth
- [ ] Supabase email/password auth
- [ ] Password reset flow
- [ ] Customer profile page
- [ ] Admin 2FA enforced

## 4. Admin Dashboard
- [ ] Product CRUD
- [ ] Inventory adjustments
- [ ] Tag management (Shopify-style)
- [ ] Shipping profile management
- [ ] Analytics: revenue, orders, items sold, AOV
- [ ] Admin System page (health & logs)

## 5. Checkout & Orders
- [ ] Stripe Checkout Session workflow
- [ ] Pending order creation
- [ ] Webhook with signature verification
- [ ] Idempotency handling
- [ ] Order confirmation email
- [ ] Shipping update email

## 6. UI/UX
- [ ] Black/red theme
- [ ] Framer Motion transitions
- [ ] Skeleton loaders
- [ ] Responsive mobile-first
- [ ] Chart theming

## 7. Security
- [ ] RLS tests passing
- [ ] Upstash rate limiting
- [ ] CSP, HSTS, frame-ancestors
- [ ] Secure cookies
- [ ] Secrets only via env vars

## 8. Testing
- [ ] Jest unit tests passing
- [ ] Playwright E2E tests
- [ ] RLS tests
- [ ] Smoke tests
- [ ] API contract linting
- [ ] Load tests meet SLOs

## 9. CI/CD
- [ ] ci-env:check, env-case, file-case
- [ ] Build + lint + typecheck
- [ ] supabase db lint
- [ ] Staging deploy
- [ ] Production deploy via tag
- [ ] Release notes auto-generation

## 10. Monitoring
- [ ] Sentry configured
- [ ] PostHog events firing
- [ ] /healthz and /readyz valid
- [ ] Admin System Page reflects monitoring data
