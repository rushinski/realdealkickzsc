# Lightspeed Sales, Refunds, and Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Export paid website orders and confirmed refunds to Lightspeed exactly once, let those remote sales/returns own their Lightspeed inventory movements, and complete a measured rollout proving both inventories remain 1:1.

**Architecture:** The paid-order and refund transactions append durable outbox intents but never call Lightspeed inline. Immutable money/item snapshots map into the date-versioned Sales API. Generated Lightspeed sale/return IDs are stored in vendor-specific link tables, and ambiguous requests are resolved by search/refetch before any retry decision. An unknown create/close outcome is never sent again unless the transport proves no request bytes were written. Local checkout/refund inventory changes are tagged sale-origin; remote inventory observations set the authoritative designated-outlet quantity without a second decrement or increment.

**Tech Stack:** Next.js 16, TypeScript 5.9, Supabase Postgres RPC/RLS, Zod 4, Vitest 4, Lightspeed 2026-07 Sales/Returns/Search/Inventory APIs.

**Spec:** docs/superpowers/specs/2026-08-29-lightspeed-bidirectional-sync-rebuild-design.md

## Global Constraints

| Constraint | Required value |
|---|---|
| Prerequisite | Plans 1 and 2 are deployed; the 10-product catalog/inventory pilot has zero unexplained drift |
| Activation | `sales_refunds_enabled`, the product allowlist, and the live sales/returns contract evidence all gate claims |
| Checkout | Allowlisted synced products stay blocked before payment until sales_refunds_enabled passes every gate; disabling it blocks new payment attempts again |
| Sale identity | Lightspeed generates `data.id`; `source.id` carries the website order ID and `invoice_number` is deterministic/searchable |
| Refund identity | Lightspeed generates the parked return ID; one local refund stores one remote return ID through baseline-diff recovery |
| Money | Integer cents internally; exact decimal strings on the wire; every line, tax, shipping, discount, and payment total balances |
| Inventory | A sale/return is the remote stock movement; never emit a second manual adjustment for the same restock/decrement |
| Non-restock | Close the product return, then compensate its remote stock increase with one mapped negative adjustment |
| Failure | Checkout/refund success is not rolled back by Lightspeed downtime; sync state becomes pending or needs_attention |
| Existing sales | A Lightspeed/POS sale never creates a website order; only authoritative inventory is applied locally |
| Data | No PAN, tokens, addresses, raw payment payloads, or customer PII in sync payloads/logs |

---

## File Structure

| Responsibility | Files |
|---|---|
| Sale identity/money snapshots | Create `supabase/migrations/20260829140000_lightspeed_sales_identity.sql` |
| Refund ledger/transaction | Create `supabase/migrations/20260829141000_order_refund_ledger.sql` |
| Canonical mapping | Create `src/modules/lightspeed-sync/domain/{sales,refunds}.ts` and `application/{loadWebsiteSale,loadWebsiteRefund}.ts` |
| Sales adapter | Create `infrastructure/lightspeed/2026-07/{saleSchemas,saleWriter,returnWriter}.ts` |
| Orchestration | Create `application/{processSale,processRefund}.ts`; modify `processOutbox.ts` and `worker.ts` |
| Orders integration | Modify paid-order RPC, refund route/service/repository, refund modal, and order details UI |
| Admin controls | Modify Lightspeed settings API/page and add sale/refund sync state components |
| Verification | Create focused unit/integration/contract tests and `docs/runbooks/LIGHTSPEED_SALES_ROLLOUT.md` |

### Task 1: Persist Exact Sale Money and Generated Remote Identities

**Files:**

- Create: `supabase/migrations/20260829140000_lightspeed_sales_identity.sql`
- Modify: `src/types/db/database.types.ts`
- Modify: `src/modules/orders/infrastructure/orders-repo-helpers.ts`
- Create: `src/modules/orders/domain/orderMoneySnapshot.ts`
- Modify: `src/services/checkout-pricing-service.ts`
- Modify: `src/types/domain/checkout.ts`
- Create: `tests/integration/lightspeed-sales-schema.test.ts`
- Create: `tests/unit/modules/lightspeed-sync/order-money-snapshot.test.ts`

**Interfaces:**

- Adds immutable per-order-item tax/discount cents and shipping-tax cents required by the Sales API.
- Produces `lightspeed_sync_sale_links`, `lightspeed_sync_sale_line_links`, and `lightspeed_sync_refund_links`; the orders module remains free of Lightspeed columns.
- Historical orders with insufficient tax allocation remain ineligible instead of receiving fabricated values.

- [ ] **Step 1: Write failing schema and snapshot tests**

~~~ts
describe("Lightspeed sales identity schema", () => {
  it("enforces one website order and one generated remote sale per connection", async () => {
    const indexes = await listIndexes(client, "lightspeed_sync_sale_links");
    expect(indexes).toContain("lightspeed_sync_sale_links_order_key");
    expect(indexes).toContain("lightspeed_sync_sale_links_remote_sale_key");
  });

  it("stores one generated return ID per website refund", async () => {
    const indexes = await listIndexes(client, "lightspeed_sync_refund_links");
    expect(indexes).toContain("lightspeed_sync_refund_links_refund_key");
    expect(indexes).toContain("lightspeed_sync_refund_links_remote_return_key");
  });

  it("links every website order item to one generated remote sale line", async () => {
    const indexes = await listIndexes(client, "lightspeed_sync_sale_line_links");
    expect(indexes).toContain("lightspeed_sync_sale_line_links_order_item_key");
    expect(indexes).toContain("lightspeed_sync_sale_line_links_remote_line_key");
  });
});

describe("order money snapshots", () => {
  it("writes zero tax and discount explicitly for the current zero-tax checkout", () => {
    const [row] = buildPendingOrderItemsInsert("order-1", [checkoutItem()]);
    expect(row).toMatchObject({
      unit_tax_cents: 0,
      tax_mapping_key: "no_tax",
      unit_discount_cents: 0,
    });
  });

  it("rejects a paid historical order whose nonzero order tax has no line allocation", () => {
    expect(() => assertOrderMoneySnapshot(taxedHistoricalOrderWithoutAllocation())).toThrow(
      "sale_tax_allocation_missing",
    );
  });
});
~~~

- [ ] **Step 2: Run tests to verify RED**

Run:

~~~powershell
npx vitest run tests/integration/lightspeed-sales-schema.test.ts tests/unit/modules/lightspeed-sync/order-money-snapshot.test.ts
~~~

Expected: FAIL because the columns, link tables, and assertion do not exist.

- [ ] **Step 3: Create the identity and money migration**

Implement:

~~~sql
begin;

alter table public.order_items
  add column unit_tax_cents integer,
  add column tax_mapping_key text,
  add column unit_discount_cents integer,
  add constraint order_items_unit_tax_cents_nonnegative
    check (unit_tax_cents is null or unit_tax_cents >= 0),
  add constraint order_items_unit_discount_cents_nonnegative
    check (unit_discount_cents is null or unit_discount_cents >= 0);

alter table public.orders
  add column shipping_tax_amount_cents integer,
  add column shipping_tax_mapping_key text,
  add constraint orders_shipping_tax_amount_cents_nonnegative
    check (shipping_tax_amount_cents is null or shipping_tax_amount_cents >= 0);

update public.order_items oi
set unit_tax_cents = 0,
    tax_mapping_key = 'no_tax',
    unit_discount_cents = 0
from public.orders o
where o.id = oi.order_id
  and coalesce(o.tax_amount, 0) = 0;

update public.orders
set shipping_tax_amount_cents = 0,
    shipping_tax_mapping_key = 'no_tax'
where coalesce(tax_amount, 0) = 0;

create table public.lightspeed_sync_sale_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.lightspeed_connections(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  website_order_id uuid not null references public.orders(id) on delete restrict,
  external_source_id text not null,
  invoice_number text not null,
  canonical_payload_hash text,
  lightspeed_sale_id text,
  remote_state text,
  remote_version bigint,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, connection_id, tenant_id),
  unique (connection_id, external_source_id),
  unique (connection_id, invoice_number),
  foreign key (connection_id, tenant_id)
    references public.lightspeed_connections(id, tenant_id) on delete cascade
);

create unique index lightspeed_sync_sale_links_order_key
  on public.lightspeed_sync_sale_links(connection_id, website_order_id);
create unique index lightspeed_sync_sale_links_remote_sale_key
  on public.lightspeed_sync_sale_links(connection_id, lightspeed_sale_id)
  where lightspeed_sale_id is not null;

create table public.lightspeed_sync_sale_line_links (
  id uuid primary key default gen_random_uuid(),
  sale_link_id uuid not null references public.lightspeed_sync_sale_links(id) on delete cascade,
  connection_id uuid not null references public.lightspeed_connections(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  line_kind text not null check (line_kind in ('merchandise', 'shipping')),
  website_order_item_id uuid references public.order_items(id) on delete restrict,
  lightspeed_sale_line_id text not null,
  lightspeed_product_id text not null,
  created_at timestamptz not null default now(),
  foreign key (connection_id, tenant_id)
    references public.lightspeed_connections(id, tenant_id) on delete cascade,
  foreign key (sale_link_id, connection_id, tenant_id)
    references public.lightspeed_sync_sale_links(id, connection_id, tenant_id)
    on delete cascade,
  check (
    (line_kind = 'merchandise' and website_order_item_id is not null)
    or (line_kind = 'shipping' and website_order_item_id is null)
  )
);

create unique index lightspeed_sync_sale_line_links_order_item_key
  on public.lightspeed_sync_sale_line_links(sale_link_id, website_order_item_id)
  where website_order_item_id is not null;
create unique index lightspeed_sync_sale_line_links_shipping_key
  on public.lightspeed_sync_sale_line_links(sale_link_id)
  where line_kind = 'shipping';
create unique index lightspeed_sync_sale_line_links_remote_line_key
  on public.lightspeed_sync_sale_line_links(connection_id, lightspeed_sale_line_id);

create table public.lightspeed_sync_refund_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.lightspeed_connections(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  website_refund_id uuid not null,
  sale_link_id uuid not null references public.lightspeed_sync_sale_links(id) on delete restrict,
  lightspeed_return_sale_id text,
  baseline_return_sale_ids text[] not null default '{}',
  phase text not null default 'pending'
    check (phase in (
      'pending', 'initializing', 'parked', 'closing', 'compensating',
      'verifying', 'succeeded', 'needs_attention'
    )),
  desired_payload_hash text,
  remote_payment_id text,
  compensating_operation_id uuid references public.lightspeed_sync_operations(id),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, connection_id, tenant_id),
  foreign key (connection_id, tenant_id)
    references public.lightspeed_connections(id, tenant_id) on delete cascade,
  foreign key (sale_link_id, connection_id, tenant_id)
    references public.lightspeed_sync_sale_links(id, connection_id, tenant_id)
    on delete restrict
);

create unique index lightspeed_sync_refund_links_refund_key
  on public.lightspeed_sync_refund_links(connection_id, website_refund_id);
create unique index lightspeed_sync_refund_links_remote_return_key
  on public.lightspeed_sync_refund_links(connection_id, lightspeed_return_sale_id)
  where lightspeed_return_sale_id is not null;

alter table public.lightspeed_sync_sale_links enable row level security;
alter table public.lightspeed_sync_sale_line_links enable row level security;
alter table public.lightspeed_sync_refund_links enable row level security;

commit;
~~~

Add tenant-admin SELECT policies and service-role-only mutations using the same policy helpers as the Phase 1 tables. Add the `website_refund_id` foreign key in Task 2 after `order_refunds` exists; do not create a circular migration dependency.

- [ ] **Step 4: Persist new checkout snapshots**

Extend resolved line items with `unitTaxCents`, `taxMappingKey`, and `unitDiscountCents`. The current pricing engine sets them to zero, `no_tax`, and zero explicitly. `buildPendingOrderItemsInsert` persists those fields, and every checkout route persists `shipping_tax_amount_cents` plus `shipping_tax_mapping_key` from the pricing result.

Do not distribute a nonzero order-level tax across items in this task. When a future tax engine is enabled, it must return line and shipping allocations whose integer-cent sum equals `orders.tax_amount` before the order can be paid.

- [ ] **Step 5: Regenerate types and verify GREEN**

Run:

~~~powershell
npx supabase db reset
npm run gen:types:local
npx vitest run tests/integration/lightspeed-sales-schema.test.ts tests/unit/modules/lightspeed-sync/order-money-snapshot.test.ts
npm run typecheck
~~~

Expected: schema uniqueness and money-snapshot tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

~~~powershell
git add supabase/migrations/20260829140000_lightspeed_sales_identity.sql src/types/db/database.types.ts src/modules/orders/domain/orderMoneySnapshot.ts src/modules/orders/infrastructure/orders-repo-helpers.ts src/services/checkout-pricing-service.ts src/types/domain/checkout.ts app/api/checkout tests/integration/lightspeed-sales-schema.test.ts tests/unit/modules/lightspeed-sync/order-money-snapshot.test.ts
git commit -m "feat: persist exact sale snapshots and remote identities"
~~~

### Task 2: Replace Best-Effort Refund Writes with One Transactional Ledger

**Files:**

- Create: `supabase/migrations/20260829141000_order_refund_ledger.sql`
- Modify: `src/types/db/database.types.ts`
- Create: `src/modules/orders/domain/refunds.ts`
- Create: `src/modules/orders/application/recordRefund.ts`
- Modify: `src/modules/orders/infrastructure/orders-repo.ts`
- Modify: `app/api/admin/orders/[orderId]/refund/route.ts`
- Modify: `src/modules/orders/presentation/admin/refund-order/refundOrderTypes.ts`
- Modify: `src/modules/orders/presentation/admin/refund-order/useRefundOrderState.ts`
- Modify: `src/modules/orders/presentation/admin/refund-order/RefundOrderModal.tsx`
- Create: `tests/integration/order-refund-transaction.test.ts`
- Create: `tests/unit/modules/orders/refund-request.test.ts`

**Interfaces:**

- Replaces sequential order/payment/item/stock writes in the current refund route with `record_order_refund_and_enqueue`.
- Produces durable `order_refunds`/`order_refund_items`; a Lightspeed-eligible order gets exactly one `sale.refund.requested` event while a wholly local-only order gets none.
- Requires explicit returned quantity, restock choice, and payment confirmation; custom refunds require item/shipping allocation.

- [ ] **Step 1: Write failing atomicity and validation tests**

~~~ts
describe("record_order_refund_and_enqueue", () => {
  it("commits refund ledger, summaries, restock, and outbox exactly once", async () => {
    const input = productRefundInput({ restock: true, quantity: 1 });
    const first = await callRecordRefund(client, input);
    const replay = await callRecordRefund(client, input);

    expect(replay.refund_id).toBe(first.refund_id);
    expect(await refundRowCount(client, first.refund_id)).toBe(1);
    expect(await outboxCount(client, "sale.refund.requested", first.refund_id)).toBe(1);
    expect(await variantStock(client, input.variantId)).toBe(input.stockBefore + 1);
  });

  it("rolls back every local change when the outbox insert fails", async () => {
    await expect(callRecordRefund(client, refundWithInvalidConnection())).rejects.toThrow();
    expect(await orderRefundTotal(client, orderId)).toBe(0);
    expect(await variantStock(client, variantId)).toBe(stockBefore);
  });

  it("requires a negative disposition mapping when restock is false", () => {
    expect(() => parseRefundRequest(nonRestockRefund({ dispositionKey: null }))).toThrow(
      "non_restock_disposition_required",
    );
  });

  it("records a local-only refund without creating a Lightspeed event", async () => {
    const result = await callRecordRefund(client, localOnlyOrderRefundInput());
    expect(result.status).toBe("confirmed");
    expect(await outboxCount(client, "sale.refund.requested", result.refund_id)).toBe(0);
  });
});
~~~

- [ ] **Step 2: Run tests to verify RED**

Run:

~~~powershell
npx vitest run tests/integration/order-refund-transaction.test.ts tests/unit/modules/orders/refund-request.test.ts
~~~

Expected: FAIL because the ledger, parser, and RPC do not exist.

- [ ] **Step 3: Create the refund ledger**

Implement these core tables:

~~~sql
create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  payment_transaction_id uuid references public.payment_transactions(id) on delete restrict,
  idempotency_key text not null,
  canonical_request_hash text not null check (length(canonical_request_hash) = 64),
  refund_type text not null check (refund_type in ('full', 'product', 'custom')),
  amount_cents integer not null check (amount_cents > 0),
  shipping_subtotal_refund_cents integer not null default 0
    check (shipping_subtotal_refund_cents >= 0),
  shipping_tax_refund_cents integer not null default 0
    check (shipping_tax_refund_cents >= 0),
  restock boolean,
  non_restock_disposition_key text,
  payment_confirmation text not null
    check (payment_confirmation in ('processor_confirmed', 'recorded_externally')),
  payment_reference text,
  status text not null default 'sync_pending'
    check (status in ('confirmed', 'sync_pending', 'sync_succeeded', 'sync_needs_attention')),
  confirmed_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key),
  check (
    (restock is true and non_restock_disposition_key is null)
    or (restock is false and non_restock_disposition_key is not null)
    or (restock is null and non_restock_disposition_key is null)
  )
);

create table public.order_refund_items (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.order_refunds(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  subtotal_refund_cents integer not null check (subtotal_refund_cents >= 0),
  tax_refund_cents integer not null default 0 check (tax_refund_cents >= 0),
  check (subtotal_refund_cents + tax_refund_cents > 0),
  unique (refund_id, order_item_id)
);

alter table public.lightspeed_sync_refund_links
  add constraint lightspeed_sync_refund_links_website_refund_fkey
  foreign key (website_refund_id) references public.order_refunds(id) on delete restrict;
~~~

Add indexes on `order_refunds(order_id, created_at)` and `order_refund_items(order_item_id)`, tenant-admin read policies, and service-role mutation policies.

- [ ] **Step 4: Implement the strict refund request**

Use integer cents at the API boundary:

~~~ts
const refundAllocationSchema = z.object({
  orderItemId: z.string().uuid(),
  quantity: z.number().int().positive(),
  subtotalRefundCents: z.number().int().nonnegative(),
  taxRefundCents: z.number().int().nonnegative(),
}).strict().refine(
  (value) => value.subtotalRefundCents + value.taxRefundCents > 0,
  "refund_allocation_zero",
);

const inventoryChoiceSchema = z.discriminatedUnion("restock", [
  z.object({ restock: z.literal(true) }).strict(),
  z.object({
    restock: z.literal(false),
    dispositionKey: z.string().min(1),
  }).strict(),
]);

const refundRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  type: z.enum(["full", "product", "custom"]),
  amountCents: z.number().int().positive(),
  shippingSubtotalRefundCents: z.number().int().nonnegative(),
  shippingTaxRefundCents: z.number().int().nonnegative(),
  allocations: z.array(refundAllocationSchema),
  inventory: inventoryChoiceSchema.nullable(),
  paymentConfirmation: z.enum(["processor_confirmed", "recorded_externally"]),
  paymentReference: z.string().max(128).nullable(),
}).strict().superRefine((value, context) => {
  const shippingGross = value.shippingSubtotalRefundCents + value.shippingTaxRefundCents;
  if (value.allocations.length === 0 && shippingGross === 0) {
    context.addIssue({ code: "custom", message: "refund_allocation_required" });
  }
  if ((value.allocations.length > 0) !== (value.inventory !== null)) {
    context.addIssue({ code: "custom", message: "refund_inventory_choice_mismatch" });
  }
});
~~~

Full mode derives all remaining item/shipping subtotal and tax allocations server-side and verifies the submitted gross total. Product/custom modes verify every allocation belongs to the order, quantities and refundable subtotal/tax cents do not exceed prior refunds, and each component balances. Enforce:

~~~text
amount_cents = sum(item subtotal_refund_cents + item tax_refund_cents)
             + shipping_subtotal_refund_cents
             + shipping_tax_refund_cents
~~~

A shipping-only refund uses no item allocations and `inventory=null`. Merchandise allocations require an explicit restock/non-restock choice. No client-calculated total is trusted.

- [ ] **Step 5: Implement the transaction RPC**

`record_order_refund_and_enqueue` must:

1. lock the connection, order, latest payment transaction, selected order items, and variant rows in stable ID order;
2. compute/store SHA-256 over the server-derived canonical request and return the existing refund for the same tenant/idempotency key only when `canonical_request_hash` matches;
3. insert refund/header allocations, append the payment event, update cumulative order/item/payment summaries, and tag `set_config('rdk.sync_origin','website_refund',true)`;
4. increment local stock only when `restock=true`, once per aggregated variant; and
5. detect Lightspeed eligibility from an existing sale.completed outbox row or sale link for that connection/order; append one `sale.refund.requested` row only when eligible, otherwise leave the local-only refund status `confirmed` with no sync row.

For an eligible order, set refund status `sync_pending`. Its outbox row uses schema version 1, local revision 1, the all-zero immutable-refund hash sentinel, correlation ID `refund:{refundId}`, and operation key `refund:{refundId}`. Its payload includes both UUID `website_order_id` and `website_refund_id`, satisfying the Phase 1 discriminated event contract.

Any validation or outbox failure rolls back every change. Grant execute only to `service_role`; the application service verifies the tenant admin before calling it.

- [ ] **Step 6: Make the route and modal explicit**

The route becomes parse → authorize/tenant resolve → `recordRefund` → enqueue notification. Delete direct calls to `updateRefundSummary`, `markOrderItemsRefunded`, and `restockVariants` from the route.

The modal adds quantity/allocation controls, a Restock returned inventory switch, a required disposition selector when false, and a required confirmation that the processor refund completed or was recorded externally. It explains that Lightspeed sync may remain pending without changing the confirmed local refund.

- [ ] **Step 7: Verify and commit**

Run:

~~~powershell
npx supabase db reset
npm run gen:types:local
npx vitest run tests/integration/order-refund-transaction.test.ts tests/unit/modules/orders/refund-request.test.ts
npm run typecheck
npm run lint -- --quiet
~~~

Expected: duplicate, rollback, over-refund, allocation, restock, non-restock, and route tests pass.

~~~powershell
git add supabase/migrations/20260829141000_order_refund_ledger.sql src/types/db/database.types.ts src/modules/orders app/api/admin/orders tests/integration/order-refund-transaction.test.ts tests/unit/modules/orders/refund-request.test.ts
git commit -m "feat: record refunds transactionally with sync intent"
~~~

### Task 3: Build a Canonical Sale from Immutable Order Data

**Files:**

- Create: `src/modules/lightspeed-sync/domain/sales.ts`
- Create: `src/modules/lightspeed-sync/application/loadWebsiteSale.ts`
- Modify: `src/modules/lightspeed-sync/application/ports.ts`
- Create: `src/modules/lightspeed-sync/infrastructure/repositories/saleRepository.ts`
- Modify: `src/modules/lightspeed-sync/index.ts`
- Create: `tests/unit/modules/lightspeed-sync/sale-mapper.test.ts`
- Create: `tests/integration/lightspeed-sale-loader.test.ts`

**Interfaces:**

- Consumes the paid order, immutable item money, latest captured payment, active variant links, and tax/payment/shipping mappings.
- Produces a PII-free `CanonicalSale` and exact `LightspeedSaleCreateRequest`.
- Rejects missing mappings, unlinked/archived variants, unsupported currency, null historical allocations, and cent imbalance.

- [ ] **Step 1: Write failing canonical mapping tests**

~~~ts
describe("website order to Lightspeed sale", () => {
  it("maps nested 2026-07 source, product, pricing, tax, and payment fields", () => {
    const sale = canonicalSaleFixture();
    expect(toLightspeedSaleRequest(sale)).toEqual({
      source: {
        register_id: "register-1",
        author_id: "user-1",
        id: sale.externalSourceId,
        type: "RDK Website",
      },
      date: "2026-08-29T17:20:00Z",
      state: "closed",
      invoice_number: sale.invoiceNumber,
      note: "Website order " + sale.websiteOrderId,
      line_items: [
        {
          product: { id: "remote-product-10" },
          quantity: 1,
          pricing: { price: "194.99", discount: "0.00" },
          tax: { id: "no-tax-id", amount: "0.00" },
          status: "CONFIRMED",
        },
      ],
      payments: [
        {
          type: { config_id: "card-payment-id" },
          date: "2026-08-29T17:20:00Z",
          amount: "194.99",
        },
      ],
    });
  });

  it("adds shipping as a mapped non-inventory product line", () => {
    const request = toLightspeedSaleRequest(canonicalSaleFixture({ shippingCents: 1200 }));
    expect(request.line_items.at(-1)).toMatchObject({
      product: { id: "shipping-product-id" },
      quantity: 1,
      pricing: { price: "12.00" },
    });
  });

  it("rejects one-cent payment imbalance", () => {
    expect(() => toLightspeedSaleRequest(canonicalSaleFixture({ paymentCents: 19498 }))).toThrow(
      "sale_money_imbalance",
    );
  });
});
~~~

- [ ] **Step 2: Run tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/sale-mapper.test.ts tests/integration/lightspeed-sale-loader.test.ts
~~~

Expected: FAIL because the sale domain and loader do not exist.

- [ ] **Step 3: Define exact canonical types and invariants**

~~~ts
export interface CanonicalSaleLine {
  lineKey: string;
  kind: "merchandise" | "shipping";
  orderItemId: string | null;
  lightspeedProductId: string;
  quantity: number;
  unitPriceExcludingTaxCents: number;
  unitDiscountCents: number;
  unitTaxCents: number;
  lightspeedTaxId: string;
}

export interface CanonicalSalePayment {
  paymentTransactionId: string;
  lightspeedPaymentConfigId: string;
  paidAt: string;
  amountCents: number;
}

export interface CanonicalSale {
  websiteOrderId: string;
  connectionId: string;
  externalSourceId: string;
  invoiceNumber: string;
  completedAt: string;
  currency: string;
  registerId: string;
  authorId: string;
  lines: CanonicalSaleLine[];
  shippingLine: CanonicalSaleLine | null;
  payments: CanonicalSalePayment[];
}
~~~

Validate positive integer quantities; nonnegative integer cents; exactly two-decimal conversion; unique nonnull order-item IDs; exactly one optional shipping line; and active unique remote product IDs. Merchandise lines require `orderItemId`; the shipping line requires null. The gross total is:

~~~text
sum(quantity * (unit price - unit discount + unit tax)) + shipping gross
~~~

It must equal the payment total and `orders.total` in cents. `orders.subtotal`, item line totals, order tax, item tax, shipping, and shipping tax must also balance independently. Never read current product price/tax/stock to construct a historical sale.

- [ ] **Step 4: Implement deterministic external identity**

`externalSourceId` is `rdk-order:` plus the full website order UUID. `invoiceNumber` is `RDK-` plus the first 20 uppercase base32 characters of SHA-256 over `tenantId + ":" + orderId`. Store both in `lightspeed_sync_sale_links` before the first remote request; the database uniqueness constraints make collisions visible.

Do not send a top-level `id`. Lightspeed generates it.

- [ ] **Step 5: Implement the repository loader**

Load one consistent database snapshot containing:

1. the paid/refunded website order and all order items;
2. the latest successful payment transaction and captured amount;
3. active family/variant links for every item variant;
4. connection register/source author and the `tax`, `payment_type`, and `shipping_product` mappings; and
5. the retailer currency discovered during OAuth/capture.

Use the Phase 1 `shipping_product` mapping with local key `default`; a zero shipping amount needs no shipping product. Use payment local key `card:` plus normalized `card_type`, falling back to `card` only when that exact mapping exists. Use tax local keys stored with each checkout line; the current zero-tax checkout uses `no_tax`.

The loader returns a named eligibility failure, not a partial sale, when any dependency is missing.

- [ ] **Step 6: Verify and commit**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/sale-mapper.test.ts tests/integration/lightspeed-sale-loader.test.ts
npm run typecheck
~~~

Expected: mapping, identity, shipping, tax, currency, missing-link, archived-link, and money-balance tests pass.

~~~powershell
git add src/modules/lightspeed-sync tests/unit/modules/lightspeed-sync/sale-mapper.test.ts tests/integration/lightspeed-sale-loader.test.ts
git commit -m "feat: map paid orders to exact Lightspeed sales"
~~~

### Task 4: Create or Recover One Lightspeed Sale

**Files:**

- Create: `src/modules/lightspeed-sync/infrastructure/lightspeed/2026-07/saleSchemas.ts`
- Create: `src/modules/lightspeed-sync/infrastructure/lightspeed/2026-07/saleWriter.ts`
- Create: `tests/fixtures/lightspeed/2026-07/sale-create-response.json`
- Create: `tests/fixtures/lightspeed/2026-07/sale-search-response.json`
- Create: `tests/fixtures/lightspeed/2026-07/sale-get-response.json`
- Create: `tests/unit/modules/lightspeed-sync/sale-writer.test.ts`
- Create: `tests/integration/lightspeed-sale-operation.test.ts`

**Interfaces:**

- Produces endpoint-specific strict schemas and `LightspeedSaleWriter.createOrRecoverSale`.
- Uses `POST /api/2026-07/sales`, `GET /api/2026-07/search`, and `GET /api/2026-07/sales/{id}`.
- Stores a generated Lightspeed sale ID only after exact identity/money/line verification.

- [ ] **Step 1: Write failing create and ambiguous-timeout tests**

~~~ts
describe("Lightspeed sale writer", () => {
  it("stores the generated response ID after one successful create", async () => {
    const result = await harness.writer.createOrRecoverSale(harness.sale);
    expect(result).toEqual({ lightspeedSaleId: "sale-remote-1", outcome: "created" });
    expect(harness.http.postCalls("/api/2026-07/sales")).toHaveLength(1);
  });

  it("adopts one exact invoice search match after a create timeout", async () => {
    harness.http.timeoutAfterRemoteCommit();
    harness.http.searchResults([matchingSaleSummary()]);
    const result = await harness.writer.createOrRecoverSale(harness.sale);
    expect(result).toEqual({ lightspeedSaleId: "sale-remote-1", outcome: "recovered" });
    expect(harness.http.postCalls("/api/2026-07/sales")).toHaveLength(1);
  });

  it("stops when the invoice search is ambiguous or mismatched", async () => {
    harness.http.timeoutAfterRemoteCommit();
    harness.http.searchResults([matchingSaleSummary(), mismatchedSaleSummary()]);
    await expect(harness.writer.createOrRecoverSale(harness.sale)).rejects.toThrow(
      "ambiguous_sale_create",
    );
  });

  it("does not POST again when an unknown commit is not yet searchable", async () => {
    harness.http.timeoutAfterRequestWasSent();
    harness.http.searchResults([]);
    await expect(harness.writer.createOrRecoverSale(harness.sale)).rejects.toThrow(
      "sale_create_outcome_unknown",
    );
    expect(harness.http.postCalls("/api/2026-07/sales")).toHaveLength(1);
  });
});
~~~

- [ ] **Step 2: Run tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/sale-writer.test.ts tests/integration/lightspeed-sale-operation.test.ts
~~~

Expected: FAIL because the writer and 2026-07 schemas do not exist.

- [ ] **Step 3: Implement endpoint-specific schemas**

Required request members are:

~~~ts
export const saleCreateRequestSchema = z.object({
  source: z.object({
    register_id: z.string().min(1),
    author_id: z.string().min(1),
    id: z.string().min(1),
    type: z.literal("RDK Website"),
  }).strict(),
  date: z.iso.datetime({ offset: true }),
  state: z.literal("closed"),
  invoice_number: z.string().min(1),
  note: z.string(),
  line_items: z.array(z.object({
    product: z.object({ id: z.string().min(1) }).strict(),
    quantity: z.number().int().positive(),
    pricing: z.object({
      price: z.string().regex(/^\d+\.\d{2}$/),
      discount: z.string().regex(/^\d+\.\d{2}$/),
    }).strict(),
    tax: z.object({
      id: z.string().min(1),
      amount: z.string().regex(/^\d+\.\d{2}$/),
    }).strict(),
    status: z.literal("CONFIRMED"),
  }).strict()).min(1),
  payments: z.array(z.object({
    type: z.object({ config_id: z.string().min(1) }).strict(),
    date: z.iso.datetime({ offset: true }),
    amount: z.string().regex(/^\d+\.\d{2}$/),
  }).strict()).min(1),
}).strict();
~~~

Response schemas require `data.id`, state, source identity, invoice number, line product IDs/quantities/pricing/tax, payments, totals, and `_metadata.version`. Use passthrough only on response object boundaries. Validate the sanitized fixtures before they enter mapper tests.

- [ ] **Step 4: Implement serialized create/recovery**

Before POST, insert/claim `lightspeed_sync_operations` with key:

~~~text
sale:create:{connectionId}:{websiteOrderId}:{canonicalPayloadHash}
~~~

If `sale_link.lightspeed_sale_id` is already stored, GET and verify it; never POST again. Otherwise:

1. POST the request once and validate `data`;
2. on success, atomically store `data.id`, canonical hash, remote state/version, generated remote line IDs, and operation success;
3. on timeout/network/5xx with unknown commit, wait through bounded nonblocking recovery scheduling, then call `/api/2026-07/search?type=sales&invoice_number={encoded}&page_size=10&offset=0`;
4. GET every search result and require invoice number, `source.id`, `source.type`, product IDs, quantities, line gross, and payment total to match; and
5. adopt exactly one exact result; zero, multiple, or mismatched results after the visibility window enter `sale_create_outcome_unknown`/needs_attention without a second POST.

Retry POST automatically only when the transport records definitive `request_sent=false` (for example, local validation/connection setup failed before writing request bytes). Treat every unclassified network failure as possibly sent. Admin retry of an unknown outcome reruns search/refetch recovery; it does not override this rule.

Match response lines to the unique requested remote product ID, then persist one `lightspeed_sync_sale_line_links` row per website order item and one for shipping. Reject duplicate requested remote product IDs before POST; this prevents positional matching and makes later refunds address the exact generated return line.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/sale-writer.test.ts tests/integration/lightspeed-sale-operation.test.ts
npm run typecheck
~~~

Expected: request shape, response validation, success, replay, definitively-not-sent retry, timeout-after-commit recovery, unsearchable unknown outcome, delayed search visibility, mismatch, and ambiguity tests pass.

~~~powershell
git add src/modules/lightspeed-sync/infrastructure/lightspeed/2026-07 tests/fixtures/lightspeed/2026-07 tests/unit/modules/lightspeed-sync/sale-writer.test.ts tests/integration/lightspeed-sale-operation.test.ts
git commit -m "feat: create or recover one Lightspeed sale"
~~~

### Task 5: Process Paid Sales Without a Second Stock Movement

**Files:**

- Create: `src/modules/lightspeed-sync/application/processSale.ts`
- Modify: `src/modules/lightspeed-sync/application/processOutbox.ts`
- Modify: `src/modules/lightspeed-sync/application/processInbox.ts`
- Modify: `src/modules/lightspeed-sync/application/worker.ts`
- Modify: `src/modules/lightspeed-sync/infrastructure/repositories/outboxRepository.ts`
- Modify: `src/modules/lightspeed-sync/infrastructure/repositories/linkRepository.ts`
- Create: `tests/unit/modules/lightspeed-sync/process-sale.test.ts`
- Create: `tests/integration/lightspeed-sale-stock.test.ts`

**Interfaces:**

- Claims `sale.completed` only when every gate/dependency passes.
- Produces one remote closed sale, stores its ID, then confirms authoritative designated-outlet inventory.
- Never turns the website checkout decrement into `inventory.adjustment.requested`.

- [ ] **Step 1: Write failing gate, dependency, and stock tests**

~~~ts
describe("processSale", () => {
  it("does not claim a sale while the sales switch is off", async () => {
    await harness.run({ salesRefundsEnabled: false });
    expect(harness.saleWriter.createOrRecoverSale).not.toHaveBeenCalled();
    expect(harness.outbox.state).toBe("pending");
  });

  it("waits behind a pending product link operation", async () => {
    await harness.run({ pendingFamilyDependency: true });
    expect(harness.outbox.retryCode).toBe("catalog_dependency_pending");
    expect(harness.saleWriter.createOrRecoverSale).not.toHaveBeenCalled();
  });

  it("creates a sale and applies one authoritative inventory observation", async () => {
    await harness.runReadySale();
    expect(harness.saleWriter.createOrRecoverSale).toHaveBeenCalledTimes(1);
    expect(harness.stockAdjustmentWriter.calls).toHaveLength(0);
    expect(harness.localInventory.applied).toEqual([
      { variantId: "variant-10", quantity: 1, remoteVersion: 414 },
    ]);
  });
});
~~~

- [ ] **Step 2: Run tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/process-sale.test.ts tests/integration/lightspeed-sale-stock.test.ts
~~~

Expected: FAIL because sale events are still intentionally unclaimed by Phase 2.

- [ ] **Step 3: Add gated claiming and family dependencies**

Allow `sale.completed` only when:

1. the connection is healthy, capture is enabled, and `sales_refunds_enabled=true`;
2. the live 2026-07 sale contract evidence is recorded and not expired;
3. every merchandise product belongs to `allowlisted_product_ids` during pilot;
4. every order item has an active remote product link and no pending/needs_attention catalog operation; and
5. the order is paid/partially_refunded/refunded and has one valid captured money snapshot.

Serialize on `connectionId + websiteOrderId`. A catalog dependency returns retry_wait without consuming an external-attempt count. A missing/failed link enters needs_attention with the exact variant ID.

- [ ] **Step 4: Implement sale orchestration**

`processSale` loads the canonical sale, creates/recovers it, stores the generated ID, and marks the outbox succeeded. After remote success, fetch each involved remote product's designated-outlet inventory and call the existing versioned inbound inventory application with sync origin `lightspeed`.

The payment/customer request contains no processor reference, card data, email, or address. Only the mapped Lightspeed payment type and total are sent.

If Lightspeed is unavailable, keep the website order paid and the local checkout decrement intact. Retry only the sync operation. Do not invoke payment capture or ask the customer to pay again.

- [ ] **Step 5: Handle sale webhooks without feedback loops**

When `sale.update` refers to a stored website sale/return, record its remote state/version and schedule an inventory refresh; do not create an order, decrement stock, or create another outbox event. An unknown POS sale is diagnostic only; its inventory update/reconciliation changes local quantity.

If a `sale.update` arrives before the POST response is stored, match it only by verified `source.id`/invoice identity during the serialized recovery path. Never match on amount/date alone.

- [ ] **Step 6: Verify and commit**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/process-sale.test.ts tests/integration/lightspeed-sale-stock.test.ts
npm run test:unit
npm run typecheck
~~~

Expected: switches, allowlist, dependency, duplicate webhook, POS sale, outage, replay, and exactly-once inventory behavior pass.

~~~powershell
git add src/modules/lightspeed-sync tests/unit/modules/lightspeed-sync/process-sale.test.ts tests/integration/lightspeed-sale-stock.test.ts
git commit -m "feat: export paid sales without double stock changes"
~~~

### Task 6: Implement the Documented Parked-Return Saga

**Files:**

- Create: `src/modules/lightspeed-sync/domain/refunds.ts`
- Create: `supabase/migrations/20260829142000_lightspeed_refund_inventory_holds.sql`
- Create: `src/modules/lightspeed-sync/application/loadWebsiteRefund.ts`
- Create: `src/modules/lightspeed-sync/application/processRefund.ts`
- Modify: `src/modules/lightspeed-sync/application/processInventory.ts`
- Create: `src/modules/lightspeed-sync/infrastructure/lightspeed/2026-07/returnWriter.ts`
- Create: `tests/fixtures/lightspeed/2026-07/return-init-response.json`
- Create: `tests/fixtures/lightspeed/2026-07/return-parked-response.json`
- Create: `tests/fixtures/lightspeed/2026-07/return-closed-response.json`
- Create: `tests/unit/modules/lightspeed-sync/return-writer.test.ts`
- Create: `tests/unit/modules/lightspeed-sync/process-refund.test.ts`
- Create: `tests/integration/lightspeed-refund-stock.test.ts`

**Interfaces:**

- Consumes one confirmed local refund, the stored original Lightspeed sale/line IDs, mappings, and a refund link row.
- Produces one generated parked return, one idempotent complete close PUT, and an optional held/compensated negative adjustment.
- Persists each saga phase before advancing and resolves unknown commits by refetch, never blind retry.

- [ ] **Step 1: Write failing return, recovery, and inventory tests**

~~~ts
describe("Lightspeed return saga", () => {
  it("initializes, trims, pays, and closes one partial return", async () => {
    await harness.process(productRefund({ quantity: 1, restock: true }));
    expect(harness.http.postPaths()).toEqual([
      "/api/2026-07/sales/original-sale-1/actions/return",
    ]);
    expect(harness.http.lastPut()).toMatchObject({
      path: "/api/2026-07/sales/return-sale-1",
      body: {
        state: "closed",
        payments: [{ amount: "-194.99" }],
        line_items: [{ id: "return-line-10", quantity: -1 }],
      },
    });
  });

  it("adopts one new parked return after init times out", async () => {
    harness.initTimesOutAfterCommit();
    harness.originalReturnIdsBefore([]);
    harness.originalReturnIdsAfter(["return-sale-1"]);
    await harness.process(productRefund({ quantity: 1, restock: true }));
    expect(harness.http.initReturnCalls()).toBe(1);
    expect(harness.refundLink.remoteReturnId).toBe("return-sale-1");
  });

  it("does not initialize a second return when an unknown commit is not visible", async () => {
    harness.initTimesOutAfterRequestWasSent();
    harness.originalReturnIdsBefore([]);
    harness.originalReturnIdsAfter([]);
    await expect(harness.process(productRefund({ restock: true }))).rejects.toThrow(
      "return_init_outcome_unknown",
    );
    expect(harness.http.initReturnCalls()).toBe(1);
  });

  it("does not leave stock increased for a non-restock refund", async () => {
    await harness.process(productRefund({ restock: false, dispositionKey: "damaged" }));
    expect(harness.stockAdjustments).toEqual([
      { productId: "remote-product-10", quantity: "-1", reasonId: "damage-reason-id" },
    ]);
    expect(harness.finalInventory.quantity).toBe(harness.inventoryBefore);
  });
});
~~~

- [ ] **Step 2: Run tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/return-writer.test.ts tests/unit/modules/lightspeed-sync/process-refund.test.ts tests/integration/lightspeed-refund-stock.test.ts
~~~

Expected: FAIL because return orchestration and schemas do not exist.

- [ ] **Step 3: Load and validate the canonical refund**

`loadWebsiteRefund` requires:

1. the confirmed `order_refunds` header and every allocation;
2. a succeeded sale link with generated original sale ID;
3. a stored remote sale-line ID for every allocated order item and shipping allocation;
4. remaining refundable remote quantities/money after prior succeeded returns; and
5. payment/tax mappings plus a negative adjustment reason for non-restock.

The canonical refund contains separate integer-cent merchandise/shipping subtotal and tax components, negative wire quantities derived only in the adapter, and no customer/payment PII. Full/product/custom allocations must balance exactly to `amount_cents`. A custom merchandise allocation may reduce a returned line's unit price/discount/tax, but it must still reference a real original product and an integer returned quantity. A shipping-only refund targets the stored shipping sale line with `restock=null`; a money-only refund with neither item nor shipping allocation is ineligible and enters needs_attention.

- [ ] **Step 4: Implement return-init recovery**

Under the order aggregate lease:

1. GET the original sale and store its `return.return_sale_ids` in the refund link before mutation;
2. set phase `initializing` and POST `/api/2026-07/sales/{originalSaleId}/actions/return` with no body;
3. validate `data.id`, original-sale reference, `state=parked`, and negative cloned lines; and
4. atomically store the generated return ID and phase `parked`.

On an unknown POST outcome, refetch the original sale through the bounded visibility/recovery window. Diff current return IDs against the stored baseline. Fetch each new candidate and adopt exactly one parked return whose original sale, creation window, and cloned remote line IDs match. Zero, multiple, or nonmatching candidates enter `return_init_outcome_unknown`/needs_attention without another POST. A retry is automatic only when the transport proves the request body was never sent.

Use operation key:

~~~text
return:init:{connectionId}:{websiteRefundId}
~~~

The operation stores the baseline and generated ID as remote evidence.

- [ ] **Step 5: Build and close the complete return**

GET the parked return and construct a write DTO from validated, supported fields. Do not send the raw GET object. Include:

~~~ts
export interface ReturnCloseRequest {
  source: {
    register_id: string;
    author_id: string;
  };
  date: string;
  state: "closed";
  invoice_number: string;
  short_code: string;
  note: string;
  attributes: string[];
  line_items: Array<{
    id: string;
    product: { id: string };
    quantity: number;
    pricing: {
      price: string;
      discount: string;
      loyalty_amount: string;
    };
    tax: { id: string; amount: string };
    status: "SAVED" | "CONFIRMED";
  }>;
  payments: Array<{
    id?: string;
    type: { config_id: string };
    date: string;
    amount: string;
  }>;
}
~~~

Map GET `source.author.id` to write `source.author_id`. Website sales are created without a customer; require the parked return's customer to remain absent/null and never copy a customer object/ID into the DTO. Retain only selected cloned lines, keep their generated line `id`, set exact negative integer quantities, and add one negative payment with the mapped config ID. Include every existing retained line/payment ID so PUT updates rather than appends. PUT the full request to `/api/2026-07/sales/{returnSaleId}` with operation key:

~~~text
return:close:{connectionId}:{websiteRefundId}:{desiredPayloadHash}
~~~

After success, GET and require `state=closed`, original sale ID, exact lines, exact negative payment, totals, and generated payment ID. Store that payment ID and phase `verifying`.

On unknown PUT outcome, GET first. Exact desired closed state succeeds; unchanged parked, partial, or mismatched state enters needs_attention because a stale GET is not proof that the payment-creating PUT failed. Automatically retry only when the transport proves the request body was never sent. Any operator recovery refetches first and never omits an existing line/payment ID.

For a non-restock refund, create active inventory holds for every affected variant before this close PUT. If hold creation fails, do not close the return.

- [ ] **Step 6: Complete restock or compensate non-restock**

For `restock=true`, the return is the remote inventory increase. Emit no stock adjustment. Fetch inventory and apply the authoritative version locally without adding again; the local refund transaction already incremented once.

For a shipping-only refund with `restock=null`, close the return/payment with no inventory hold or stock adjustment.

For `restock=false`, the local refund transaction did not increment. Resolve local disposition key `non_restock:{dispositionKey}` through `reasonMappingToWire`; only a negative built-in reason or negative custom reason is valid. Create `lightspeed_sync_inventory_holds` with connection/refund/variant links, remote product ID, the pre-return baseline quantity/version, returned quantity, state `active`, timestamps, and a unique active hold per connection/product. While active, `processInventory` stores newer remote observations for audit but does not apply them locally or plan reconciliation repair for that product.

~~~sql
create table public.lightspeed_sync_inventory_holds (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.lightspeed_connections(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  refund_link_id uuid not null references public.lightspeed_sync_refund_links(id) on delete restrict,
  variant_link_id uuid not null references public.lightspeed_sync_variant_links(id) on delete restrict,
  lightspeed_product_id text not null,
  baseline_quantity integer not null check (baseline_quantity >= 0),
  baseline_remote_version bigint not null check (baseline_remote_version >= 0),
  returned_quantity integer not null check (returned_quantity > 0),
  pre_compensation_quantity integer,
  pre_compensation_version bigint,
  compensation_delta integer check (compensation_delta is null or compensation_delta < 0),
  expected_post_compensation_quantity integer
    check (expected_post_compensation_quantity is null or expected_post_compensation_quantity >= 0),
  latest_observed_quantity integer,
  latest_observed_version bigint,
  state text not null default 'active'
    check (state in ('active', 'released', 'needs_attention')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (connection_id, tenant_id)
    references public.lightspeed_connections(id, tenant_id) on delete cascade,
  foreign key (refund_link_id, connection_id, tenant_id)
    references public.lightspeed_sync_refund_links(id, connection_id, tenant_id)
    on delete restrict,
  foreign key (variant_link_id, connection_id, tenant_id)
    references public.lightspeed_sync_variant_links(id, connection_id, tenant_id)
    on delete restrict,
  check (
    (
      pre_compensation_quantity is null
      and pre_compensation_version is null
      and compensation_delta is null
      and expected_post_compensation_quantity is null
    ) or (
      pre_compensation_quantity is not null
      and pre_compensation_quantity >= 0
      and pre_compensation_version is not null
      and pre_compensation_version >= 0
      and compensation_delta is not null
      and compensation_delta = -returned_quantity
      and expected_post_compensation_quantity is not null
      and expected_post_compensation_quantity = pre_compensation_quantity + compensation_delta
    )
  )
);

create unique index lightspeed_sync_inventory_holds_active_product_key
  on public.lightspeed_sync_inventory_holds(connection_id, lightspeed_product_id)
  where state in ('active', 'needs_attention');
~~~

After the remote return closes, fetch authoritative inventory and persist that fresh quantity/version as the compensation base. Calculate one negative adjustment per returned remote product using the mapped `inventory_adjustment_reason` for the selected disposition, with `compensation_delta = -returned_quantity` and `expected_post_compensation_quantity = pre_compensation_quantity + compensation_delta`. This base deliberately includes unrelated remote movements that happened before compensation instead of incorrectly forcing inventory back to the original baseline.

Use the Phase 2 freshness/idempotency rules and an operation key containing website refund ID plus product ID. The saga succeeds only after a newer authoritative fetch confirms the expected post-compensation quantity; then atomically apply that final observation and release the hold. If another movement occurs after the compensation base was captured and the result is no longer provable, enter needs_attention without sending a second adjustment.

If compensation fails, keep the hold and refund confirmed locally, set refund sync state needs_attention, and alert on inventory drift. Never close another return to repair it. An admin retry resumes the stored compensation operation; it cannot delete or bypass the hold.

- [ ] **Step 7: Handle refund webhooks and verify**

A webhook for a stored return updates remote state/version and schedules inventory refetch. It does not create another local refund, restock again, or enqueue another return. Unknown POS returns affect the website only through authoritative inventory.

Run:

~~~powershell
npx supabase db reset
npm run gen:types:local
npx vitest run tests/unit/modules/lightspeed-sync/return-writer.test.ts tests/unit/modules/lightspeed-sync/process-refund.test.ts tests/integration/lightspeed-refund-stock.test.ts
npm run test:unit
npm run typecheck
~~~

Expected: full, product, custom/shipping allocation, repeated partial, recovered and unprovable init/close timeouts, mismatched candidate, restock, non-restock, webhook replay, and stock confirmation tests pass without duplicate POST/PUT.

~~~powershell
git add supabase/migrations/20260829142000_lightspeed_refund_inventory_holds.sql src/modules/lightspeed-sync tests/fixtures/lightspeed/2026-07 tests/unit/modules/lightspeed-sync/return-writer.test.ts tests/unit/modules/lightspeed-sync/process-refund.test.ts tests/integration/lightspeed-refund-stock.test.ts
git commit -m "feat: synchronize refunds through parked returns"
~~~

### Task 7: Add Sales/Refund Controls, State, and Kill Switches

**Files:**

- Modify: `app/api/admin/lightspeed/settings/route.ts`
- Create: `app/api/admin/lightspeed/sales/[orderId]/retry/route.ts`
- Create: `app/api/admin/lightspeed/refunds/[refundId]/retry/route.ts`
- Modify: `src/modules/lightspeed-sync/presentation/admin/LightspeedSettingsPageContent.tsx`
- Create: `src/modules/lightspeed-sync/presentation/admin/OrderSyncState.tsx`
- Create: `src/modules/lightspeed-sync/presentation/admin/RefundSyncState.tsx`
- Modify: `src/modules/orders/presentation/admin/transaction-detail/transactionDetailView.tsx`
- Modify: `src/modules/orders/presentation/admin/refund-order/RefundOrderModal.tsx`
- Create: `tests/unit/modules/lightspeed-sync/sales-controls.test.tsx`
- Create: `tests/integration/lightspeed-sales-settings.test.ts`

**Interfaces:**

- Produces guarded enable/disable controls, redacted per-order/refund state, and audited retry actions.
- Requires rollout-gate evidence rather than trusting a client checkbox.
- Disabling sales/refunds stops new claims immediately but preserves durable pending work and all remote records.

- [ ] **Step 1: Write failing control and state tests**

~~~tsx
describe("Lightspeed sales controls", () => {
  it("refuses enablement while any prerequisite gate is missing", async () => {
    const result = await updateSettings({ salesRefundsEnabled: true }, gatesMissing("returns_2026_07_contract"));
    expect(result).toEqual({ ok: false, code: "rollout_gate_missing", gate: "returns_2026_07_contract" });
  });

  it("shows generated remote IDs and a safe retry only for needs-attention work", () => {
    render(<OrderSyncState state={needsAttentionSaleState()} />);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("sale-remote-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry safe recovery" })).toBeEnabled();
  });

  it("releases the pilot checkout guard only after gated sales enablement", async () => {
    const result = await updateSettings({ salesRefundsEnabled: true }, allRequiredGatesPassing());
    expect(result).toMatchObject({ ok: true, salesRefundsEnabled: true });
    await expect(assertCheckoutAllowed(allowlistedCart())).resolves.toBeUndefined();
  });
});
~~~

- [ ] **Step 2: Run tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/sales-controls.test.tsx tests/integration/lightspeed-sales-settings.test.ts
~~~

Expected: FAIL because sales controls and state projections do not exist.

- [ ] **Step 3: Enforce server-side rollout gates**

Create/consume one current passing `lightspeed_sync_rollout_gates` row for each:

~~~text
products_2026_10_contract
capture_24h
catalog_inventory_pilot
sales_2026_07_contract
returns_2026_07_contract
~~~

Each gate stores connection, pass/fail state, sanitized evidence hash, passed timestamp, optional expiry, and approving admin. Only the service role can write evidence. Enabling sales/refunds requires all five passing, unexpired gates plus configured outlet/register/source author, retailer currency, tax/payment/shipping mappings, and negative non-restock reasons.

The settings PATCH accepts strict booleans and allowlists. Disabling a switch is always allowed. Preserve Plan 2's monotonic allowlist rule and additionally reject removal of any product referenced by pending/processing sale or refund work. Enabling returns cannot be separated from sales because every return requires a stored original remote sale.

The existing Phase 2 `assertCheckoutAllowed` guard reads this persisted switch immediately before payment. A successful gated enablement releases the allowlisted products; disabling the switch immediately blocks new payment attempts while preserving already-paid outbox work.

- [ ] **Step 4: Add redacted state projections and safe retry**

Order/refund details show pending, processing phase, succeeded, or needs_attention; last attempt; remote sale/return ID; safe error code; and last verified inventory version. Do not show raw request/response, customer details, payment reference, webhook body, or tokens.

Retry endpoints require tenant admin and an existing needs_attention operation. They run the same recovery/refetch decision before changing the outbox to retry_wait. A retry never clears remote IDs, operation evidence, baseline return IDs, or attempt history.

- [ ] **Step 5: Add operational kill switches and alerts**

The settings page offers independent outbound catalog, inventory adjustments, and sales/refunds switches with current gate status. The worker reads switches at claim time and again immediately before each external mutation. If disabled between those checks, release the event to pending without mutation; the checkout guard simultaneously blocks new allowlisted payments.

Alert summaries include connection, operation class, safe error code, age, and correlation ID. Trigger alerts for retry exhaustion, ambiguous sale/return, non-restock compensation failure, inventory drift over 60 seconds, auth pause, or a 15-minute recovery scan failure. Deduplicate alerts by operation key plus error code.

- [ ] **Step 6: Verify and commit**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/sales-controls.test.tsx tests/integration/lightspeed-sales-settings.test.ts
npm run typecheck
npm run lint -- --quiet
~~~

Expected: gate, enable, disable, allowlist, redaction, retry, mid-operation kill, and alert-deduplication tests pass.

~~~powershell
git add app/api/admin/lightspeed src/modules/lightspeed-sync/presentation src/modules/orders/presentation tests/unit/modules/lightspeed-sync/sales-controls.test.tsx tests/integration/lightspeed-sales-settings.test.ts
git commit -m "feat: gate and surface Lightspeed sales synchronization"
~~~

### Task 8: Prove the Live Sales and Returns Contracts Under Faults

**Files:**

- Create: `tests/integration/lightspeed-2026-07-sales-contract.test.ts`
- Create: `tests/integration/lightspeed-sales-fault-matrix.test.ts`
- Create: `tests/helpers/lightspeedFaultProxy.ts`
- Modify: `package.json`
- Create: `docs/runbooks/LIGHTSPEED_SALES_ROLLOUT.md`

**Interfaces:**

- Consumes a dedicated sandbox retailer, outlet, register, user, tax, payment type, shipping product, and returnable test products.
- Produces sanitized released-contract fixtures and passing rollout-gate evidence.
- Exercises failures before, during, and after every remote mutation boundary.

- [ ] **Step 1: Add opt-in live contract tests**

~~~ts
const enabled = process.env.LIGHTSPEED_SALES_CONTRACT_TESTS === "1";
const describeContract = enabled ? describe : describe.skip;

describeContract("Lightspeed 2026-07 sales and returns", () => {
  it("creates, searches, fetches, and verifies a closed sale", async () => {
    const result = await runLiveSaleContract(uniqueContractIdentity());
    expect(result.created.state).toBe("closed");
    expect(result.searchMatch.id).toBe(result.created.id);
    expect(result.inventoryVersionAfter).toBeGreaterThan(result.inventoryVersionBefore);
  });

  it("initializes, fetches, partially closes, and verifies a return", async () => {
    const result = await runLiveReturnContract(liveCreatedSaleId());
    expect(result.parked.state).toBe("parked");
    expect(result.closed.state).toBe("closed");
    expect(result.closed.return.original_sale_id).toBe(liveCreatedSaleId());
  });
});
~~~

Add this script without replacing existing scripts:

~~~json
{
  "scripts": {
    "test:lightspeed:sales-contract": "vitest run tests/integration/lightspeed-2026-07-sales-contract.test.ts"
  }
}
~~~

- [ ] **Step 2: Build the deterministic fault matrix**

The test proxy fails once at each boundary:

| Boundary | Injected outcome | Required recovery |
|---|---|---|
| Sale POST before commit | connection reset | search empty, one retry, one sale |
| Sale POST after commit | response lost | search exact, adopt, no retry POST |
| Return init before commit | connection reset | baseline unchanged, one retry, one return |
| Return init after commit | response lost | baseline diff, adopt, no second init |
| Return close before commit | connection reset | GET parked, one retry PUT |
| Return close after commit | response lost | GET exact closed state, no second payment |
| Non-restock adjustment after commit | response lost | inventory/version evidence resolves; no second delta |
| Worker crash after remote success | lease expires | stored/refetched identity resolves; one remote record |

Also test 429 Retry-After, 401 refresh once, 403 pause, 422 needs_attention, schema drift, duplicate webhook delivery, out-of-order inventory versions, and switch disable immediately before mutation.

- [ ] **Step 3: Run local verification**

Run:

~~~powershell
npm run test:unit
npx vitest run tests/integration/lightspeed-sales-fault-matrix.test.ts
npm run typecheck
npm run lint
npm run build
npx supabase db lint --local
~~~

Expected: all commands exit 0; the live contract suite remains skipped by default.

- [ ] **Step 4: Run the live sandbox contract**

Run with the dedicated contract connection:

~~~powershell
$env:LIGHTSPEED_SALES_CONTRACT_TESTS='1'
npm run test:lightspeed:sales-contract
Remove-Item Env:LIGHTSPEED_SALES_CONTRACT_TESTS
~~~

Expected: sale create/search/get, multi-line sale, shipping line, zero-tax and configured-tax cases, full return, partial return, repeated partial return, and non-restock compensation pass. Save sanitized fixtures and evidence hashes. Do not mark the sales/returns gates passed if any assertion is skipped or any unexplained inventory delta remains.

- [ ] **Step 5: Record gates and commit**

The runbook records test retailer, API versions, timestamps, commit SHA, sanitized fixture hashes, pre/post quantities/versions, generated sale/return IDs, and reviewer. Write passing `sales_2026_07_contract` and `returns_2026_07_contract` gate rows through the audited admin command.

~~~powershell
git add tests/integration/lightspeed-2026-07-sales-contract.test.ts tests/integration/lightspeed-sales-fault-matrix.test.ts tests/helpers/lightspeedFaultProxy.ts tests/fixtures/lightspeed/2026-07 package.json docs/runbooks/LIGHTSPEED_SALES_ROLLOUT.md
git commit -m "test: prove Lightspeed sales and returns contracts"
~~~

### Task 9: Roll Out Sales and Refunds with Objective Stop Gates

**Files:**

- Modify: `docs/runbooks/LIGHTSPEED_SALES_ROLLOUT.md`
- Modify: `docs/RUNBOOK.md`
- Create: `tests/e2e/lightspeed-sales-rollout.spec.ts`

**Interfaces:**

- Consumes all prior passing gates and explicit user approval for each production stage.
- Produces a completed evidence table for controlled sales, refunds, 24-hour observation, and 7-day stabilization.
- Defines immediate, reversible switch rollback without deleting remote records or local evidence.

- [ ] **Step 1: Add the production smoke test**

The authenticated E2E test uses an allowlisted production test product and asserts:

1. a paid test order shows pending then synchronized with one remote sale ID;
2. local and designated-outlet quantities each decrease exactly once and converge within 60 seconds when healthy;
3. an explicit restock refund creates one remote return and both quantities increase exactly once;
4. a non-restock refund finishes with both quantities unchanged from their post-sale value; and
5. replay/retry controls never create a second sale, return, payment, or stock adjustment.

The test does not cancel/delete production records. Label all records with the runbook test identity and retain them for audit.

- [ ] **Step 2: Execute the controlled-sale stage**

Enable `sales_refunds_enabled` for 10 allowlisted products only. Create 10 controlled paid orders covering one/multiple items, shipping/no shipping, zero stock boundary, simultaneous POS movement, worker restart, and one injected transient failure.

Pass conditions:

| Check | Pass condition |
|---|---|
| Remote identity | Exactly 10 website orders map to 10 distinct Lightspeed sale IDs |
| Money | Every remote total/payment equals the immutable website cents |
| Inventory | Zero double decrements; convergence under 60 seconds healthy, under 15 minutes with missed event |
| Delivery | Zero ambiguous or exhausted operations; replay creates zero duplicates |
| Catalog dependency | No placeholder product and no sale sent before its active link |

Any failure disables sales/refunds immediately, preserves pending work, and returns to diagnosis before another stage.

- [ ] **Step 3: Execute the controlled-refund stage**

Against controlled sales, run one full restock, one partial restock, two sequential partials, one custom allocated refund, and one non-restock with a mapped disposition.

Pass conditions: one generated return ID per refund; exact negative payment; exact retained line IDs/quantities; no duplicate return/payment; restock converges once; non-restock compensates once and converges to no net increase. An ambiguous init/close/adjustment is injected once and must recover without manual data edits.

- [ ] **Step 4: Observe for 24 hours, then stabilize for 7 days**

After the controlled stages pass, keep the product allowlist for 24 hours. Require zero unexplained managed drift, duplicate identities, unresolved operations over 15 minutes, or missing complete reconciliation scan. Then expand to all synchronized products for 7 days while retaining all kill switches and alerts.

Final acceptance requires:

| Metric | Required value |
|---|---|
| Healthy convergence | 99% within 60 seconds |
| Missed-webhook recovery | 100% within 15 minutes |
| Duplicate remote writes | 0 |
| Unexplained inventory drift | 0 |
| Money/tax/shipping cent drift | 0 |
| Irreversible product deletes | 0 |

- [ ] **Step 5: Run final repository verification**

Run fresh:

~~~powershell
npm run test:unit
npx vitest run tests/integration/lightspeed-sync-schema.test.ts tests/integration/lightspeed-catalog-outbox.test.ts tests/integration/lightspeed-inbound-apply.test.ts tests/integration/lightspeed-inventory-apply.test.ts tests/integration/order-refund-transaction.test.ts tests/integration/lightspeed-sale-operation.test.ts tests/integration/lightspeed-sale-stock.test.ts tests/integration/lightspeed-refund-stock.test.ts tests/integration/lightspeed-sales-fault-matrix.test.ts
npm run typecheck
npm run lint
npm run build
npx supabase db lint --local
~~~

Expected: every command exits 0 with no skipped non-live sync test. Separately confirm the live contract evidence remains current.

- [ ] **Step 6: Complete runbook evidence and commit**

Document dates, operator, connection, allowlists, counts, convergence percentiles, scan completeness, error/duplicate/drift counts, gate decisions, and explicit user approvals. Link sanitized audit IDs, not raw payloads.

~~~powershell
git add tests/e2e/lightspeed-sales-rollout.spec.ts docs/runbooks/LIGHTSPEED_SALES_ROLLOUT.md docs/RUNBOOK.md
git commit -m "docs: complete Lightspeed sales rollout gates"
~~~

The rebuild is complete only after all three plans, the 24-hour observation, and the 7-day stabilization meet their pass conditions. Until then, the remaining stage stays allowlisted or disabled.
