# Lightspeed Catalog and Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add allowlisted, idempotent two-way catalog and designated-outlet inventory synchronization on top of the verified capture foundation, while keeping Lightspeed sales and refunds disabled.

**Architecture:** Database triggers capture every local catalog mutation into the existing outbox in the same transaction. Pure planners compare canonical local, remote, and base snapshots; versioned adapters perform explicit family/product/image/stock operations; one aggregate lease serializes each family. Inbound changes apply through one transaction-scoped RPC that suppresses echo events and preserves website-only fields.

**Tech Stack:** Next.js 16, TypeScript 5.9, Supabase Postgres triggers/RPC/RLS, Zod 4, Vitest 4, Lightspeed 2026-10 Products API and 2026-07 Stock Adjustments.

**Spec:** docs/superpowers/specs/2026-08-29-lightspeed-bidirectional-sync-rebuild-design.md

## Global Constraints

| Constraint | Required value |
|---|---|
| Prerequisite | Plan 1 contract suite passes and capture-only evidence runs clean for 24 hours |
| Activation | Catalog/inventory writes require released-contract gate, product allowlist, and their independent switch |
| Sales/refunds | sale.completed may be captured durably, but sales_refunds_enabled remains false throughout this plan |
| Identity | Generated remote IDs are linked after refetch by unique CUSTOM code plus ordered attributes |
| Delete | Patch products inactive and retain tombstones; never call Lightspeed DELETE |
| Conflict | Either side's ordinary edit propagates; true concurrent conflict uses the approved field authority |
| Inventory | One outlet only; website checkout stock changes are sale-origin and never become manual stock adjustments |
| Pilot checkout | A Phase 2 allowlisted product is rejected server-side at checkout while sales_refunds_enabled is false; otherwise the pilot cannot remain 1:1 |
| Collections | tag_ids, codes, and other replacement arrays preserve fetched unmanaged values |
| Images | Use dedicated family/product image endpoints; a failed fetch never becomes an erase |
| Cost | Capability-gated and nullable; no product scope means it is excluded from comparison and writes |

---

## File Structure

| Responsibility | Files |
|---|---|
| Transactional capture | Create supabase/migrations/20260829130000_lightspeed_catalog_outbox.sql |
| Inbound transaction | Create supabase/migrations/20260829133000_lightspeed_inbound_apply.sql |
| Pure planning | Create domain/catalogOperations.ts and application/loadWebsiteFamily.ts |
| Write adapters | Create infrastructure/lightspeed/2026-10/catalogSchemas.ts and catalogWriter.ts |
| Outbound orchestration | Create application/processOutbox.ts and infrastructure/repositories/{outbox,operation,aggregateLease}Repository.ts |
| Inventory | Create domain/inventoryOperations.ts and application/processInventory.ts |
| Reconciliation apply | Create application/{approveLinks,activateReconciliation,resolveConflict}.ts |
| Admin APIs/UI | Create app/api/admin/lightspeed/reconciliation/* and presentation sync-state components |
| Existing integration points | Modify src/services/product-service.ts, orders-repo SQL function, inventory presentation, and worker.ts |
| Tests | Create focused unit/integration tests under tests/unit/modules/lightspeed-sync and tests/integration |

### Task 1: Capture Local Catalog and Paid-Order Origins Transactionally

**Files:**

- Create: supabase/migrations/20260829130000_lightspeed_catalog_outbox.sql
- Modify: src/types/db/database.types.ts
- Modify: src/modules/orders/application/order-status-helpers.ts
- Create: src/modules/lightspeed-sync/application/assertCheckoutAllowed.ts
- Modify: app/api/checkout/init-checkout/route.ts
- Modify: app/api/checkout/create-checkout/route.ts
- Modify: app/api/cart/validate/route.ts
- Modify: tests/integration/lightspeed-sync-schema.test.ts
- Create: tests/integration/lightspeed-catalog-outbox.test.ts
- Create: tests/integration/lightspeed-pilot-checkout-guard.test.ts
- Create: tests/unit/modules/orders/order-status-reconciliation.test.ts

**Interfaces:**

- Produces lightspeed_sync_revision on products and lightspeed_sync_aggregate_leases.
- Produces trigger function capture_lightspeed_catalog_change and an updated mark_order_paid_and_decrement that tags website_sale origin and appends sale.completed once.
- Removes the captured-payment fallback that marks an order paid without a successful all-variant inventory commit.
- Blocks checkout of Phase 2 allowlisted products until the gated sales/refunds switch is enabled.
- Replaces claim_lightspeed_sync_outbox with a backward-compatible allowed_event_types parameter defaulting to null.

- [ ] **Step 1: Write failing transactional capture tests**

~~~ts
describe("transactional catalog outbox", () => {
  it("commits a product mutation and catalog event together", async () => {
    const product = await insertProduct(client, { name: "Jordan 1" });
    const events = await client.query(
      "select event_type, aggregate_id, payload->>'sync_family_id' as sync_family_id from lightspeed_sync_outbox where aggregate_id = $1",
      [product.id],
    );
    expect(events.rows).toEqual([
      {
        event_type: "catalog.family.changed",
        aggregate_id: product.id,
        sync_family_id: expect.stringMatching(uuidPattern),
      },
    ]);
  });

  it("captures a paid order but does not convert its stock decrement into an adjustment", async () => {
    const fixture = await insertPayableOrder(client, { everyProductAllowlisted: true });
    await client.query(
      "select mark_order_paid_and_decrement($1, $2, $3::jsonb)",
      [fixture.orderId, "payment-reference", JSON.stringify(fixture.items)],
    );

    const events = await client.query(
      "select event_type from lightspeed_sync_outbox where aggregate_id = any($1::text[]) order by event_type",
      [[fixture.orderId, fixture.productId]],
    );
    expect(events.rows).toEqual([{ event_type: "sale.completed" }]);
  });

  it("keeps a wholly local-only order out of the Lightspeed outbox", async () => {
    const fixture = await insertPayableOrder(client, { noProductsAllowlisted: true });
    await callMarkPaid(client, fixture);
    expect(await outboxCount(client, "sale.completed", fixture.orderId)).toBe(0);
  });

  it("rejects a mixed synced/local-only cart before payment", async () => {
    const fixture = await insertMixedPilotCart(client);
    const response = await createCheckoutRequest(fixture.cart, fixture);
    expect(response.status).toBe(409);
    expect(await paymentAttemptCountForTenant(client, fixture.tenantId)).toBe(0);
  });

  it("blocks an allowlisted pilot product before payment while sale export is disabled", async () => {
    const fixture = await insertCatalogPilotConnection(client, {
      salesRefundsEnabled: false,
      allowlistedProductIds: [productId],
    });
    const response = await createCheckoutRequest({ productId, variantId, quantity: 1 }, fixture);
    expect(response.status).toBe(409);
    expect(await paymentAttemptCountForTenant(client, fixture.tenantId)).toBe(0);
  });

  it("does not mark paid, partially decrement, or enqueue when any variant is insufficient", async () => {
    const fixture = await insertPayableOrderWithOneInsufficientVariant(client);
    await expect(callMarkPaid(client, fixture)).rejects.toThrow("paid_inventory_commit_conflict");
    expect(await orderStatus(client, fixture.orderId)).toBe("processing");
    expect(await variantStocks(client, fixture.variantIds)).toEqual(fixture.stocksBefore);
    expect(await outboxCount(client, "sale.completed", fixture.orderId)).toBe(0);
  });

  it("does not emit an outbox row when the enclosing transaction rolls back", async () => {
    await expect(runRolledBackProductUpdate(client)).rejects.toThrow();
    const count = await client.query(
      "select count(*)::int as count from lightspeed_sync_outbox where payload->>'test_marker' = 'rolled-back'",
    );
    expect(count.rows[0].count).toBe(0);
  });
});
~~~

- [ ] **Step 2: Run the integration test to verify RED**

Run:

~~~powershell
npx vitest run tests/integration/lightspeed-catalog-outbox.test.ts tests/integration/lightspeed-pilot-checkout-guard.test.ts tests/unit/modules/orders/order-status-reconciliation.test.ts
~~~

Expected: FAIL because catalog triggers/aggregate leases do not exist and captured-payment reconciliation still has the unsafe direct-paid fallback.

- [ ] **Step 3: Add revision, aggregate lease, and capture trigger**

~~~sql
alter table public.products
  add column if not exists lightspeed_sync_revision bigint not null default 0;

create table public.lightspeed_sync_aggregate_leases (
  connection_id uuid not null references public.lightspeed_connections(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  aggregate_id text not null,
  owner_id uuid not null,
  lease_until timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, aggregate_id),
  foreign key (connection_id, tenant_id)
    references public.lightspeed_connections(id, tenant_id) on delete cascade
);

create or replace function public.enqueue_lightspeed_catalog_change(
  target_tenant_id uuid,
  target_product_id uuid,
  change_reason text,
  changed_row_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  connection record;
  family_link record;
  next_revision bigint;
  event_id uuid := gen_random_uuid();
begin
  if current_setting('rdk.sync_origin', true) in ('lightspeed', 'website_sale', 'website_refund') then
    return;
  end if;

  select * into connection
  from public.lightspeed_connections
  where tenant_id = target_tenant_id
    and capture_enabled = true;

  if connection.id is null then
    return;
  end if;

  if not exists (
    select 1 from public.products
    where id = target_product_id and tenant_id = target_tenant_id
  ) then
    raise exception 'lightspeed_catalog_target_tenant_mismatch';
  end if;

  insert into public.lightspeed_sync_family_links (
    connection_id, tenant_id, website_product_id, state
  ) values (
    connection.id, target_tenant_id, target_product_id, 'proposed'
  )
  on conflict (connection_id, website_product_id)
    where website_product_id is not null
  do update set updated_at = excluded.updated_at
  returning id, last_common_snapshot_hash into family_link;

  update public.products
  set lightspeed_sync_revision = lightspeed_sync_revision + 1
  where id = target_product_id
  returning lightspeed_sync_revision into next_revision;

  insert into public.lightspeed_sync_outbox (
    id, connection_id, tenant_id, event_type, schema_version, aggregate_id,
    local_revision, base_snapshot_hash, correlation_id, payload, operation_key, state,
    attempts, next_attempt_at
  ) values (
    event_id, connection.id, target_tenant_id, 'catalog.family.changed', 1,
    target_product_id::text, next_revision,
    coalesce(family_link.last_common_snapshot_hash, repeat('0', 64)),
    'catalog:' || event_id::text,
    jsonb_build_object(
      'sync_family_id', family_link.id,
      'website_product_id', target_product_id,
      'reason', change_reason,
      'changed_row_id', changed_row_id
    ),
    'catalog-dirty:' || target_product_id::text || ':' || next_revision::text,
    'pending', 0, now() + interval '5 seconds'
  )
  on conflict (connection_id, operation_key) do nothing;
end;
$function$;
~~~

Create AFTER triggers on products, product_variants, product_images, and product_tags. For child rows, derive tenant/product from NEW or OLD and call the function; use `tag_id` as `changed_row_id` for the composite-key product_tags table. Prevent recursion by making the products trigger ignore updates where only lightspeed_sync_revision, updated_at, or is_out_of_stock changed.

Enable RLS on `lightspeed_sync_aggregate_leases`, grant it only to service_role, and revoke direct execution of the helper/wrapper trigger functions from public, anon, and authenticated. The triggers still execute under their defined owner; clients cannot call the SECURITY DEFINER helper with arbitrary tenant/product IDs.

The outbox repository materializes the Plan 1 envelope by lifting `payload.sync_family_id` into the envelope's required `sync_family_id` field. The five-second next_attempt_at coalesces the current multi-statement ProductService write; the worker always reloads final current state.

- [ ] **Step 4: Make the paid-order RPC all-or-nothing and preserve sale origin**

Recreate the latest mark_order_paid_and_decrement signature. Aggregate positive item quantities, lock every referenced variant in stable UUID order, and require exactly one row per aggregate with stock at least the requested quantity. After the decrement, require the affected-row count to equal the aggregate count. Raise `paid_inventory_commit_conflict` on any missing/insufficient row so the order transition, every decrement, and the outbox insert all roll back instead of committing a partial checkout.

In the same transaction, classify the order's distinct nonnull product IDs against `allowlisted_product_ids` for its connection:

1. zero allowlisted products means a local-only order: commit paid/inventory but emit no Lightspeed sale event;
2. every product allowlisted means a synced order: append exactly one sale.completed event; and
3. a nonzero partial intersection raises `lightspeed_mixed_sync_cart` before the paid transition.

At the start of the successful transaction execute:

~~~sql
perform set_config('rdk.sync_origin', 'website_sale', true);
~~~

After the order transition and local stock decrement, insert one outbox event only for the all-allowlisted case:

~~~sql
insert into public.lightspeed_sync_outbox (
  connection_id, tenant_id, event_type, schema_version, aggregate_id,
  local_revision, base_snapshot_hash, correlation_id, payload, operation_key, state,
  attempts, next_attempt_at
)
select
  connection.id,
  orders.tenant_id,
  'sale.completed',
  1,
  orders.id::text,
  1,
  repeat('0', 64),
  'sale:' || orders.id::text,
  jsonb_build_object('website_order_id', orders.id),
  'sale:' || orders.id::text,
  'pending',
  0,
  now()
from public.orders
join public.lightspeed_connections connection
  on connection.tenant_id = orders.tenant_id
 and connection.capture_enabled = true
where orders.id = p_order_id
  and exists (
    select 1 from public.order_items oi
    where oi.order_id = orders.id
      and oi.product_id = any(connection.allowlisted_product_ids)
  )
  and not exists (
    select 1 from public.order_items oi
    where oi.order_id = orders.id
      and (
        oi.product_id is null
        or not (oi.product_id = any(connection.allowlisted_product_ids))
      )
  )
on conflict (connection_id, operation_key) do nothing;
~~~

Update `order-status-helpers.ts` to remove the current fallback that directly marks a captured-payment order paid after the RPC fails. On `paid_inventory_commit_conflict`, leave the order processing with its captured payment transaction intact, insert/deduplicate an admin-visible `payment_captured_inventory_commit_failed` order event, and alert for manual fulfill/refund resolution. A retry uses the same RPC; it never bypasses inventory or creates a sale intent without the local decrement.

`assertCheckoutAllowed` reads the current connection immediately before any payment attempt/order finalization and classifies the cart the same way as the RPC. If any catalog/inventory sync switch is active and the cart partially intersects `allowlisted_product_ids`, return `409 lightspeed_mixed_sync_cart`. If it is wholly allowlisted while `sales_refunds_enabled` is false, return `409 lightspeed_pilot_checkout_blocked`. A cart with zero allowlisted products remains a local-only checkout. Call the guard from cart validation for early UX and from both checkout init/create routes for enforcement. Once Plan 3 enables sales/refunds, wholly allowlisted carts become purchasable without a separate mutable override; turning the sales kill switch off blocks new synced payment attempts again.

Do not claim sale.completed in this plan. Replace claim_lightspeed_sync_outbox with a third parameter allowed_event_types text[] default null and filter when it is non-null.

- [ ] **Step 5: Apply, regenerate, and verify**

Run:

~~~powershell
npx supabase db reset
npm run gen:types:local
npx vitest run tests/integration/lightspeed-sync-schema.test.ts tests/integration/lightspeed-catalog-outbox.test.ts tests/integration/lightspeed-pilot-checkout-guard.test.ts tests/unit/modules/orders/order-status-reconciliation.test.ts
npm run typecheck
~~~

Expected: transactional tests pass; paid checkout produces one sale event and no catalog stock-adjustment event.

- [ ] **Step 6: Commit**

~~~powershell
git add supabase/migrations/20260829130000_lightspeed_catalog_outbox.sql src/types/db/database.types.ts src/modules/orders/application/order-status-helpers.ts src/modules/lightspeed-sync/application/assertCheckoutAllowed.ts app/api/checkout app/api/cart/validate/route.ts tests/integration/lightspeed-sync-schema.test.ts tests/integration/lightspeed-catalog-outbox.test.ts tests/integration/lightspeed-pilot-checkout-guard.test.ts tests/unit/modules/orders/order-status-reconciliation.test.ts
git commit -m "feat: capture catalog and sale origins transactionally"
~~~

### Task 2: Load Website Canonical State and Plan Explicit Catalog Operations

**Files:**

- Create: src/modules/lightspeed-sync/application/loadWebsiteFamily.ts
- Create: src/modules/lightspeed-sync/domain/catalogOperations.ts
- Modify: src/modules/lightspeed-sync/infrastructure/repositories/websiteCatalogReader.ts
- Create: tests/unit/modules/lightspeed-sync/catalog-operations.test.ts
- Modify: src/modules/lightspeed-sync/index.ts

**Interfaces:**

- Consumes WebsiteCatalogReader, mappings, family/variant links, and CanonicalFamily.
- Produces loadWebsiteCanonicalFamily(productId, connectionId) and planCatalogOperations({base,local,remote,links,capabilities}).

- [ ] **Step 1: Write failing planner tests**

~~~ts
import { planCatalogOperations } from "@/modules/lightspeed-sync";

describe("catalog operation planner", () => {
  it("creates one family for an unlinked active local product", () => {
    const operations = planCatalogOperations({
      base: null,
      local: localFamilyFixture(),
      remote: null,
      links: emptyLinks(),
      capabilities: noCostCapability(),
    });
    expect(operations.map((operation) => operation.kind)).toEqual([
      "create_family",
      "set_initial_inventory",
      "sync_family_images",
    ]);
  });

  it("splits family and product patches", () => {
    const operations = planCatalogOperations({
      base: canonicalFamilyFixture(),
      local: canonicalFamilyFixture({
        name: "Website Name",
        variantPrice: 19499,
      }),
      remote: canonicalFamilyFixture(),
      links: linkedFixture(),
      capabilities: noCostCapability(),
    });
    expect(operations).toEqual([
      expect.objectContaining({ kind: "patch_family", fields: ["name"] }),
      expect.objectContaining({
        kind: "patch_product",
        fields: ["salePriceCents"],
      }),
    ]);
  });

  it("never treats local-only publishing fields as remote drift", () => {
    const operations = planCatalogOperations(
      fixtureWithOnlyGoLiveAndShippingChanged(),
    );
    expect(operations).toEqual([]);
  });
});
~~~

- [ ] **Step 2: Run the planner tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/catalog-operations.test.ts
~~~

Expected: FAIL because catalogOperations.ts does not exist.

- [ ] **Step 3: Implement the website canonical reader**

WebsiteCatalogReader loads in one query graph:

~~~ts
export interface WebsiteFamilyRecord {
  product: {
    id: string;
    tenantId: string;
    name: string;
    description: string | null;
    brand: string;
    model: string | null;
    category: "sneakers" | "clothing" | "accessories" | "electronics";
    condition: "new" | "used";
    sizeType: "shoe" | "clothing" | "custom" | "none";
    archivedAt: string | null;
    syncRevision: number;
  };
  variants: Array<{
    id: string;
    sku: string;
    sizeLabel: string;
    salePriceCents: number;
    unitCostCents: number;
    stock: number;
    sortOrder: number;
  }>;
  images: Array<{ id: string; url: string; sortOrder: number }>;
}
~~~

Map brand/model/category/condition through persisted connection mappings. Reject missing mappings with mapping_required. Shipping price, go_live_at, excluded_auto_tag_keys, and local merchandising tags do not enter CanonicalFamily.

- [ ] **Step 4: Implement the operation union and planner**

~~~ts
export type CatalogOperation =
  | { kind: "create_family"; family: CanonicalFamily }
  | { kind: "patch_family"; familyId: string; fields: FamilyPatchField[] }
  | { kind: "patch_product"; productId: string; fields: ProductPatchField[] }
  | { kind: "add_variant"; familyId: string; variant: CanonicalVariant }
  | { kind: "archive_variant"; productId: string }
  | { kind: "archive_family"; familyId: string; productIds: string[] }
  | { kind: "sync_family_images"; familyId: string | null; images: CanonicalImage[] }
  | { kind: "set_initial_inventory"; variants: InitialInventoryTarget[] }
  | { kind: "request_inventory_adjustment"; target: InventoryAdjustmentTarget };
~~~

Use the three-way merge from Plan 1. New local family creates. A linked tombstone archives. New local variants add. Missing local variants archive only when the website explicitly archived/removed them; a failed read cannot produce archive. Cost fields are absent when capability is false.

Sort operations create/add, family patch, product patch, images, inventory, archive. A family archive supersedes later edit operations.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/catalog-operations.test.ts
npm run typecheck
~~~

Expected: planner tests pass and typecheck exits 0.

~~~powershell
git add src/modules/lightspeed-sync/application/loadWebsiteFamily.ts src/modules/lightspeed-sync/domain/catalogOperations.ts src/modules/lightspeed-sync/infrastructure/repositories/websiteCatalogReader.ts src/modules/lightspeed-sync/index.ts tests/unit/modules/lightspeed-sync/catalog-operations.test.ts
git commit -m "feat: plan canonical Lightspeed catalog operations"
~~~

### Task 3: Implement Idempotent Family Creation and Stable ID Linking

**Files:**

- Create: src/modules/lightspeed-sync/infrastructure/lightspeed/2026-10/catalogSchemas.ts
- Create: src/modules/lightspeed-sync/infrastructure/lightspeed/2026-10/catalogWriter.ts
- Create: src/modules/lightspeed-sync/infrastructure/repositories/operationRepository.ts
- Create: tests/unit/modules/lightspeed-sync/catalog-create-adapter.test.ts
- Create: tests/fixtures/lightspeed/2026-10/create-family-response.json
- Modify: src/modules/lightspeed-sync/application/ports.ts

**Interfaces:**

- Consumes create_family operation, mapping IDs, OAuth client, and operation repository.
- Produces LightspeedCatalogWriteGateway.createFamily(input) and CreatedFamilyLinkResult.

- [ ] **Step 1: Write failing request and ambiguous-timeout tests**

~~~ts
describe("2026-10 family create adapter", () => {
  it("emits ordered attributes, CUSTOM codes, nested prices, and tag IDs", async () => {
    const http = createHttpHarness([
      response(201, createFamilyResponseFixture()),
      response(200, createdFamilyFixtureWithReorderedProducts()),
    ]);
    const writer = createCatalogWriter(http);

    const result = await writer.createFamily(createFamilyInputFixture());

    expect(http.requests[0].json).toEqual({
      name: "Air Jordan 1 Retro High OG",
      description: "Black and red high-top sneaker.",
      classification: "VARIANT",
      brand_id: "brand-jordan",
      category_id: "category-sneakers",
      track_inventory: true,
      variant_attribute_ids: ["attribute-size"],
      tag_ids: ["tag-condition-new", "tag-model-aj1"],
      products: [
        {
          variant_attributes: ["10"],
          codes: [{ type: "CUSTOM", code: "RDK-AJ1-BRED-10" }],
          prices: { price_including_tax: "189.99" },
          active: { in_store: true, ecwid: true },
        },
      ],
    });
    expect(result.variantLinks).toEqual([
      {
        syncVariantId: "sync-variant-10",
        lightspeedProductId: "remote-product-10",
      },
    ]);
  });

  it("adopts an already-created matching family after a timeout", async () => {
    const writer = createCatalogWriter(
      createTimeoutThenSkuLookupHarness(existingMatchingFamilyFixture()),
    );
    const result = await writer.createFamily(createFamilyInputFixture());
    expect(result.recoveredFromAmbiguousCommit).toBe(true);
  });

  it("stops on a partial ambiguous match instead of creating again", async () => {
    const writer = createCatalogWriter(
      createTimeoutThenSkuLookupHarness(partialFamilyFixture()),
    );
    await expect(writer.createFamily(twoVariantCreateInput())).rejects.toThrow(
      "ambiguous_create_outcome",
    );
  });

  it("does not POST again when an unknown create has no visible SKU result", async () => {
    const writer = createCatalogWriter(createTimeoutThenSkuLookupHarness(null));
    await expect(writer.createFamily(createFamilyInputFixture())).rejects.toThrow(
      "create_outcome_unknown",
    );
    expect(writer.postCount()).toBe(1);
  });
});
~~~

- [ ] **Step 2: Run the adapter tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/catalog-create-adapter.test.ts
~~~

Expected: FAIL because the catalog writer does not exist.

- [ ] **Step 3: Define exact create request/response schemas**

The strict request schema requires name, classification, track_inventory, products, and:

~~~ts
const createProductSchema = z.object({
  variant_attributes: z.array(z.string()).max(3),
  codes: z.array(
    z.object({
      type: z.enum(["CUSTOM", "EAN", "ISBN", "ITF", "JAN", "UPC"]),
      code: z.string().trim().min(1),
    }).strict(),
  ).min(1),
  prices: z.union([
    z.object({ price_including_tax: decimalMoneySchema }).strict(),
    z.object({ price_excluding_tax: decimalMoneySchema }).strict(),
  ]),
  active: z.object({
    in_store: z.boolean(),
    ecwid: z.boolean(),
  }).strict(),
}).strict();
~~~

Require classification VARIANT when more than one variant or size_type is not none. Require variant_attribute_ids count to equal every variant_attributes count. The response schema is:

~~~ts
z.object({
  data: z.object({
    product_family_id: z.string().min(1),
    product_ids: z.array(z.string().min(1)).min(1),
  }).strict(),
}).strict();
~~~

- [ ] **Step 4: Implement create, refetch, and matching**

POST /api/2026-10/product_families, then GET the returned family ID. Match each local variant to exactly one remote product using normalized CUSTOM code and the expected ordered variant_attributes. Assert the matched IDs are contained in product_ids and that no response product is reused.

Persist the operation row before the first request with action=create_family and a SHA-256 request fingerprint. On a timeout/network failure:

1. query GET /api/2026-10/products?sku={each expected code};
2. require all expected codes to resolve to the same family;
3. refetch that family and compare all managed create fields;
4. adopt it only on an exact match;
5. otherwise mark `create_outcome_unknown`/`ambiguous_create_outcome` without retrying POST; only a transport result that proves request bytes were never sent may retry automatically.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/catalog-create-adapter.test.ts
npm run typecheck
~~~

Expected: creation, reordering, exact recovery, duplicate code, and partial ambiguity tests pass.

~~~powershell
git add src/modules/lightspeed-sync/infrastructure/lightspeed/2026-10 src/modules/lightspeed-sync/infrastructure/repositories/operationRepository.ts src/modules/lightspeed-sync/application/ports.ts tests/unit/modules/lightspeed-sync/catalog-create-adapter.test.ts tests/fixtures/lightspeed/2026-10/create-family-response.json
git commit -m "feat: create and link Lightspeed product families"
~~~

### Task 4: Replace Local Variant Deletion with Retained Tombstones

**Files:**

- Create: supabase/migrations/20260829131500_product_variant_archive.sql
- Modify: src/types/db/database.types.ts
- Modify: src/services/product-service.ts
- Modify: src/repositories/product-repo.ts
- Modify: src/repositories/product-repo-selects.ts
- Modify: src/modules/lightspeed-sync/infrastructure/repositories/websiteCatalogReader.ts
- Create: tests/unit/product-variant-archive-service.test.ts
- Create: tests/integration/product-variant-archive.test.ts

**Interfaces:**

- Produces product_variants.archived_at and ProductRepository.archiveVariant/restoreVariant/findArchivedVariant.
- ProductService.updateProduct archives omitted variants and restores a matching tombstone instead of deleting or inserting a duplicate.

- [ ] **Step 1: Write failing service and query tests**

~~~ts
describe("variant archive lifecycle", () => {
  it("archives a removed variant without deleting its row or order references", async () => {
    const harness = createProductServiceHarness({
      variants: [variant("10"), variant("10.5")],
    });
    await harness.service.updateProduct(
      harness.productId,
      updateInputWithSizes(["10"]),
      harness.context,
    );

    expect(harness.repo.deleteVariant).not.toHaveBeenCalled();
    expect(harness.repo.archiveVariant).toHaveBeenCalledWith(
      harness.variantIdForSize("10.5"),
      expect.any(String),
    );
  });

  it("restores the same stable variant row when its size is added again", async () => {
    const harness = createProductServiceHarness({
      archivedVariants: [variant("10.5", { sku: "RDK-AJ1-10.5" })],
    });
    await harness.service.updateProduct(
      harness.productId,
      updateInputWithSizes(["10.5"]),
      harness.context,
    );

    expect(harness.repo.restoreVariant).toHaveBeenCalledWith(
      harness.variantIdForSize("10.5"),
      expect.objectContaining({ archived_at: null }),
    );
    expect(harness.repo.createVariant).not.toHaveBeenCalled();
  });

  it("keeps an archived variant in the sync projection as active=false", async () => {
    const record = await websiteCatalogReader.loadFamily(productWithArchivedVariantId);
    expect(record.variants).toContainEqual(
      expect.objectContaining({ id: archivedVariantId, archivedAt: expect.any(String) }),
    );
    expect(toCanonicalFamily(record).variants).toContainEqual(
      expect.objectContaining({ websiteVariantId: archivedVariantId, active: false }),
    );
  });
});
~~~

- [ ] **Step 2: Run tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/product-variant-archive-service.test.ts tests/integration/product-variant-archive.test.ts
~~~

Expected: FAIL because product_variants.archived_at and repository lifecycle methods do not exist.

- [ ] **Step 3: Add schema and active-query rules**

~~~sql
alter table public.product_variants
  add column if not exists archived_at timestamptz;

create index if not exists product_variants_active_product_sort
  on public.product_variants(product_id, sort_order)
  where archived_at is null;
~~~

Keep the existing tenant SKU and product/size uniqueness constraints so a tombstoned identity cannot be silently replaced. Public/storefront and ordinary admin product projections add archived_at is null. The edit service uses a dedicated repository read that includes archived variants for restoration matching. Update WebsiteCatalogReader to include archived variants and map them to canonical `active=false`; a synchronized archive must remain visible to the planner even though storefront queries hide it.

- [ ] **Step 4: Change ProductService removal and reactivation**

Replace deleteAbandonedOrderItems, referenced-order blocking, and deleteVariant in the removal branch with archiveVariant(id, now). When an incoming new variant matches one archived row by normalized size label, restore that row and update its price, stock, cost, sort order, and preserved SKU. Reject multiple archived matches as data corruption.

Hard-delete repository methods remain only for an explicit maintenance path and are not called by normal product create/edit/archive routes.

- [ ] **Step 5: Apply and verify**

Run:

~~~powershell
npx supabase db reset
npm run gen:types:local
npx vitest run tests/unit/product-variant-archive-service.test.ts tests/integration/product-variant-archive.test.ts
npm run test:unit
npm run typecheck
~~~

Expected: archive lifecycle tests and existing product tests pass; typecheck exits 0.

- [ ] **Step 6: Commit**

~~~powershell
git add supabase/migrations/20260829131500_product_variant_archive.sql src/types/db/database.types.ts src/services/product-service.ts src/repositories/product-repo.ts src/repositories/product-repo-selects.ts src/modules/lightspeed-sync/infrastructure/repositories/websiteCatalogReader.ts tests/unit/product-variant-archive-service.test.ts tests/integration/product-variant-archive.test.ts
git commit -m "feat: retain archived product variants"
~~~

### Task 5: Implement Family/Product Edits, Variant Adds, Images, and Archive

**Files:**

- Create: supabase/migrations/20260829132000_lightspeed_image_links.sql
- Modify: src/types/db/database.types.ts
- Modify: src/modules/lightspeed-sync/infrastructure/lightspeed/2026-10/catalogSchemas.ts
- Modify: src/modules/lightspeed-sync/infrastructure/lightspeed/2026-10/catalogWriter.ts
- Create: src/modules/lightspeed-sync/infrastructure/lightspeed/2026-10/imageWriter.ts
- Create: tests/unit/modules/lightspeed-sync/catalog-update-adapter.test.ts
- Create: tests/unit/modules/lightspeed-sync/image-sync.test.ts
- Create: tests/integration/lightspeed-image-links.test.ts
- Create: tests/fixtures/lightspeed/2026-10/add-products-response.json

**Interfaces:**

- Extends LightspeedCatalogWriteGateway with patchFamily, patchProduct, addVariants, syncFamilyImages, archiveProducts, and refetchForVerification.
- Persists stable local content keys to generated/adopted remote image IDs so replacement writes never infer ownership from array position or current URL alone.
- Consumes explicit CatalogOperation values from Task 2.

- [ ] **Step 1: Write failing update and replacement-collection tests**

~~~ts
describe("2026-10 catalog updates", () => {
  it("preserves unmanaged tag IDs in a family patch", async () => {
    const writer = createCatalogWriterWithRemoteFamily({
      tag_ids: ["tag-unmanaged", "tag-old-managed"],
    });
    await writer.patchFamily({
      familyId: "family-1",
      patch: {
        name: "Air Jordan 1",
        managedTagIds: ["tag-condition-new", "tag-model-aj1"],
      },
      managedRemoteTagIds: new Set(["tag-old-managed", "tag-condition-new", "tag-model-aj1"]),
    });

    expect(writer.lastRequestJson()).toEqual({
      name: "Air Jordan 1",
      tag_ids: ["tag-unmanaged", "tag-condition-new", "tag-model-aj1"],
    });
  });

  it("patches nested prices without sending family fields", async () => {
    const writer = createCatalogWriter();
    await writer.patchProduct({
      productId: "product-10",
      patch: { salePriceCents: 19499, taxMode: "inclusive" },
    });
    expect(writer.lastRequestJson()).toEqual({
      prices: { price_including_tax: "194.99" },
    });
  });

  it("archives by active channel patch and never DELETE", async () => {
    const writer = createCatalogWriter();
    await writer.archiveProducts({
      productIds: ["product-10", "product-10-5"],
      activeChannels: { in_store: false, ecwid: false },
    });
    expect(writer.requestMethods()).toEqual(["PATCH", "PATCH"]);
  });

  it("deletes only an image ID recorded as managed for that family", async () => {
    const links = await insertImageLinks(client, {
      managed: ["remote-image-managed"],
      unmanagedRemote: ["remote-image-unmanaged"],
    });
    await syncImages({ desiredKeys: [], links });
    expect(imageDeleteIds()).toEqual(["remote-image-managed"]);
  });
});
~~~

- [ ] **Step 2: Run update tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/catalog-update-adapter.test.ts tests/unit/modules/lightspeed-sync/image-sync.test.ts tests/integration/lightspeed-image-links.test.ts
~~~

Expected: FAIL because update/image methods do not exist.

- [ ] **Step 3: Add persistent image identity and strict patch schemas**

Create:

~~~sql
create table public.lightspeed_sync_image_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.lightspeed_connections(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  family_link_id uuid not null references public.lightspeed_sync_family_links(id) on delete cascade,
  local_image_key text not null check (length(local_image_key) = 64),
  lightspeed_image_id text not null,
  management_origin text not null
    check (management_origin in ('website_created', 'remote_created', 'initial_adopted')),
  state text not null default 'active'
    check (state in ('active', 'tombstoned', 'needs_attention')),
  last_seen_url text,
  tombstoned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_link_id, local_image_key),
  unique (connection_id, lightspeed_image_id),
  foreign key (connection_id, tenant_id)
    references public.lightspeed_connections(id, tenant_id) on delete cascade,
  foreign key (family_link_id, connection_id, tenant_id)
    references public.lightspeed_sync_family_links(id, connection_id, tenant_id)
    on delete cascade
);

alter table public.lightspeed_sync_image_links enable row level security;
grant select on public.lightspeed_sync_image_links to authenticated;
grant all on public.lightspeed_sync_image_links to service_role;
~~~

Add a tenant-admin SELECT policy through `family_link_id`/tenant and no authenticated mutation policy. `local_image_key` is SHA-256 over the normalized stable source/content identity, never array position. Reject duplicate active keys in one desired family. Tombstones retain ownership history while the audit/operation row retains any replaced remote ID.

Family patch accepts only name, description, brand_id, category_id, track_inventory, tag_ids, and variant_attribute_ids. Product patch accepts only active, prices, codes, and variant_attributes. Omit untouched keys. Preserve null versus omission exactly. Reject an empty patch before HTTP.

Before sending replacement tag_ids or codes, refetch current state and merge:

~~~ts
export function preserveUnmanagedIds(input: {
  currentIds: readonly string[];
  allManagedIds: ReadonlySet<string>;
  nextManagedIds: readonly string[];
}): string[] {
  const unmanaged = input.currentIds.filter((id) => !input.allManagedIds.has(id));
  return Array.from(new Set([...unmanaged, ...input.nextManagedIds]));
}
~~~

For codes, preserve every non-CUSTOM code and every CUSTOM code whose normalized value differs from the variant link's stored `normalized_sku`; replace only that previously managed CUSTOM value, then update the link after verification. A product must retain at least one code.

Do not rewrite `variant_attribute_ids`/`variant_attributes` for a family containing unmodeled remote attributes. Mark it `structural_conflict` for explicit mapping/migration; an ordinary name/price edit may not collapse a multi-attribute family into the website's Size-only model.

- [ ] **Step 4: Implement add, archive, and image operations**

addVariants posts an array to /api/2026-10/product_families/{familyId}/products, validates returned product_ids, refetches, and matches by unique CUSTOM code plus ordered attributes.

archiveProducts PATCHes each /api/2026-10/products/{productId} with configured active flags false and verifies the refetched products are unsellable. Reactivation verifies tombstones and current remote existence before PATCHing configured flags true.

syncFamilyImages:

1. refetches remote family images successfully or stops;
2. calculates stable URL/content-key additions and removals;
3. POSTs each addition to /api/2026-10/product_families/{familyId}/images and stores the generated ID as website_created;
4. DELETEs only active IDs present in lightspeed_sync_image_links and now absent, then tombstones those links;
5. refetches, matches by stored remote ID/content key, and stores final remote image IDs/order.

It never deletes an unmanaged image and never interprets a failed image read as an empty collection. Initial reconciliation creates `initial_adopted` rows only for explicitly approved matches. After a common snapshot exists, a genuinely new remote image ID becomes `remote_created` and may propagate normally in either direction.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
npx supabase db reset
npm run gen:types:local
npx vitest run tests/unit/modules/lightspeed-sync/catalog-update-adapter.test.ts tests/unit/modules/lightspeed-sync/image-sync.test.ts tests/integration/lightspeed-image-links.test.ts
npm run typecheck
~~~

Expected: family/product/add/archive/image tests pass, including persistent managed IDs, reordered responses, and failed image fetch.

~~~powershell
git add supabase/migrations/20260829132000_lightspeed_image_links.sql src/types/db/database.types.ts src/modules/lightspeed-sync/infrastructure/lightspeed/2026-10 tests/unit/modules/lightspeed-sync/catalog-update-adapter.test.ts tests/unit/modules/lightspeed-sync/image-sync.test.ts tests/integration/lightspeed-image-links.test.ts tests/fixtures/lightspeed/2026-10/add-products-response.json
git commit -m "feat: update and archive Lightspeed catalog families"
~~~

### Task 6: Process Outbox with Aggregate Leases and Operation Idempotency

**Files:**

- Create: src/modules/lightspeed-sync/application/processOutbox.ts
- Create: src/modules/lightspeed-sync/infrastructure/repositories/outboxRepository.ts
- Create: src/modules/lightspeed-sync/infrastructure/repositories/aggregateLeaseRepository.ts
- Modify: src/modules/lightspeed-sync/infrastructure/repositories/linkRepository.ts
- Modify: src/modules/lightspeed-sync/application/worker.ts
- Modify: app/api/internal/lightspeed/worker/route.ts
- Create: tests/unit/modules/lightspeed-sync/process-outbox.test.ts

**Interfaces:**

- Consumes website canonical loader, operation planner, read/write gateways, links, operations, outbox, leases, and retry policy.
- Produces processOutboxEvent and processCatalogOutboxBatch.

- [ ] **Step 1: Write failing switch, allowlist, lease, and coalescing tests**

~~~ts
describe("catalog outbox processor", () => {
  it("does not claim catalog work when the catalog switch is off", async () => {
    const harness = createOutboxHarness({ outboundCatalogEnabled: false });
    await harness.runBatch();
    expect(harness.outbox.claim).not.toHaveBeenCalled();
    expect(harness.gateway.requests).toEqual([]);
  });

  it("leaves a non-allowlisted family pending during pilot", async () => {
    const harness = createOutboxHarness({
      outboundCatalogEnabled: true,
      allowlistedProductIds: ["product-allowed"],
      eventProductId: "product-not-allowed",
    });
    await harness.runBatch();
    expect(harness.outbox.deferWithoutAttempt).toHaveBeenCalled();
    expect(harness.gateway.requests).toEqual([]);
  });

  it("serializes and coalesces one family to its highest revision", async () => {
    const harness = createOutboxHarness({
      pendingRevisions: [7, 8, 9],
      leaseAvailable: true,
    });
    await harness.runBatch();
    expect(harness.loader).toHaveBeenCalledTimes(1);
    expect(harness.outbox.markSuperseded).toHaveBeenCalledWith([7, 8]);
    expect(harness.processedRevision()).toBe(9);
  });
});
~~~

- [ ] **Step 2: Run outbox tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/process-outbox.test.ts
~~~

Expected: FAIL because processOutbox.ts and aggregate lease repository do not exist.

- [ ] **Step 3: Implement durable aggregate leases**

acquire(connectionId, aggregateId, ownerId, leaseSeconds=120) inserts or updates only when the existing lease expired or owner matches. renew and release require the same ownerId. If lease acquisition fails, return the claimed event to retry_wait after five seconds without incrementing its business retry count.

Claim only these event types in this plan:

~~~ts
const CATALOG_EVENT_TYPES = [
  "catalog.family.changed",
  "catalog.family.archived",
  "inventory.adjustment.requested",
] as const;
~~~

sale.completed and sale.refund.requested remain pending and unclaimed.

- [ ] **Step 4: Implement operation execution and final verification**

For the highest family revision:

1. acquire aggregate lease;
2. load current local, remote, links, and base snapshot;
3. plan field-level operations and persist conflict records;
4. execute each operation through an operation_key unique row;
5. refetch authoritative family/inventory;
6. update generated ID links and last_common_snapshot;
7. mark all coalesced events succeeded and release lease.

If timeout occurs after PATCH/POST, refetch and compare the intended managed fields. Mark success when observed. Repeat an idempotent patch only after verified unchanged state; never repeat a create/image POST unless the transport proves request bytes were not sent. Any other absence/ambiguity enters needs_attention. Archive and image failures stop later operations for that family.

- [ ] **Step 5: Verify failure classes and worker integration**

Add tests for 429 Retry-After, 500 schedule, 400/422 needs_attention, 401 refresh/pause, 403 capability pause, 404 direct verification, 409 replan, lease expiry recovery, operation replay, and tombstone-delayed edit.

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/process-outbox.test.ts
npm run typecheck
~~~

Expected: outbox tests pass and typecheck exits 0.

- [ ] **Step 6: Commit**

~~~powershell
git add src/modules/lightspeed-sync/application src/modules/lightspeed-sync/infrastructure/repositories app/api/internal/lightspeed/worker/route.ts tests/unit/modules/lightspeed-sync/process-outbox.test.ts
git commit -m "feat: process idempotent Lightspeed catalog outbox"
~~~

### Task 7: Apply Remote Families Locally in One Echo-Suppressed Transaction

**Files:**

- Create: supabase/migrations/20260829133000_lightspeed_inbound_apply.sql
- Modify: src/types/db/database.types.ts
- Create: src/modules/lightspeed-sync/application/applyRemoteFamily.ts
- Modify: src/modules/lightspeed-sync/application/processInbox.ts
- Create: tests/integration/lightspeed-inbound-apply.test.ts
- Create: tests/unit/modules/lightspeed-sync/apply-remote-family.test.ts

**Interfaces:**

- Produces RPC apply_lightspeed_family_snapshot(connection_id, projection, variants, images, snapshot, remote_revision).
- Consumes normalized remote family, three-way merge, inbound template, mappings, and stable links.

- [ ] **Step 1: Write failing transaction and echo-suppression tests**

~~~ts
describe("apply_lightspeed_family_snapshot", () => {
  it("creates product, variants, links, and snapshot atomically", async () => {
    const result = await callInboundApplyRpc(client, completeInboundProjection());
    expect(result.website_product_id).toMatch(uuidPattern);
    expect(await countRows(client, "products", result.website_product_id)).toBe(1);
    expect(await countLinkedVariants(client, result.website_product_id)).toBe(2);
    expect(await countCatalogOutboxRows(client, result.website_product_id)).toBe(0);
  });

  it("preserves website-only fields on a remote edit", async () => {
    const fixture = await insertLinkedWebsiteProduct(client, {
      shipping_price_cents: 1500,
      go_live_at: "2026-09-01T14:00:00Z",
      excluded_auto_tag_keys: ["featured"],
    });
    await callInboundApplyRpc(client, remoteNameAndPriceUpdate(fixture));
    const product = await loadProduct(client, fixture.productId);
    expect(product).toMatchObject({
      shipping_price_cents: 1500,
      go_live_at: "2026-09-01T14:00:00+00:00",
      excluded_auto_tag_keys: ["featured"],
    });
  });

  it("rolls back all rows when one variant violates a constraint", async () => {
    await expect(
      callInboundApplyRpc(client, projectionWithDuplicateSku()),
    ).rejects.toThrow();
    expect(await countProductsNamed(client, "Invalid Remote Family")).toBe(0);
  });
});
~~~

- [ ] **Step 2: Run inbound tests to verify RED**

Run:

~~~powershell
npx vitest run tests/integration/lightspeed-inbound-apply.test.ts tests/unit/modules/lightspeed-sync/apply-remote-family.test.ts
~~~

Expected: FAIL because the RPC and application use case do not exist.

- [ ] **Step 3: Implement the transaction input contract**

~~~ts
export interface LocalFamilyProjection {
  websiteProductId: string | null;
  lightspeedFamilyId: string;
  name: string;
  description: string | null;
  brandLabel: string;
  modelLabel: string | null;
  category: "sneakers" | "clothing" | "accessories" | "electronics";
  condition: "new" | "used";
  sizeType: "shoe" | "clothing" | "custom" | "none";
  archivedAt: string | null;
  createDefaults: {
    shippingPriceCents: number | null;
    goLiveAt: string;
    excludedAutoTagKeys: string[];
  } | null;
}

export interface LocalVariantProjection {
  websiteVariantId: string | null;
  lightspeedProductId: string;
  sku: string;
  sizeLabel: string;
  salePriceCents: number;
  unitCostCents: number | null;
  stock: number;
  sortOrder: number;
  archivedAt: string | null;
}

export interface LocalImageProjection {
  localImageKey: string;
  url: string;
  sortOrder: number;
  lightspeedImageId: string | null;
  managementDecision: "already_managed" | "new_remote_change" | "initial_approved" | "unmanaged";
}
~~~

applyRemoteFamily refuses to call the RPC until every required mapping and inbound create default exists. It passes only selected values from the merge decision, not raw remote JSON.

- [ ] **Step 4: Implement the security-definer RPC**

The RPC:

1. resolves connection tenant and rejects mismatched existing local IDs;
2. performs set_config('rdk.sync_origin','lightspeed',true);
3. inserts or updates products without overwriting shipping_price_cents, go_live_at, excluded_auto_tag_keys, or local merchandising tags on existing products;
4. inserts/updates/restores/archives variants by stable link, never by array position;
5. replaces only the website's synchronized image projection after a successful supplied image fetch;
6. upserts `lightspeed_sync_image_links` for generated IDs, remote IDs proven new relative to the last common snapshot, or explicitly approved initial matches; unknown pre-link remote images remain unmanaged;
7. upserts family/variant links and last_common_snapshot; and
8. returns website_product_id and website_variant_id mapping.

Grant execute only to service_role. Validate every JSON member and raise a named exception on duplicate remote IDs, duplicate normalized SKU, mixed condition, unknown linked variant, or missing create defaults.

- [ ] **Step 5: Enable inbound apply behind switch and allowlist**

processInbox keeps its existing capture result. It calls applyRemoteFamily only when inbound_apply_enabled is true and the linked/local product is allowlisted. Remote-only create requires an explicit remote-family allowlist entry stored in the connection settings; otherwise it remains a proposal.

Remote all-inactive or confirmed hard-deleted families map to local archived_at plus tombstone. A delayed active webhook cannot clear the tombstone.

- [ ] **Step 6: Apply, verify, and commit**

Run:

~~~powershell
npx supabase db reset
npm run gen:types:local
npx vitest run tests/integration/lightspeed-inbound-apply.test.ts tests/unit/modules/lightspeed-sync/apply-remote-family.test.ts
npm run test:unit
npm run typecheck
~~~

Expected: inbound atomicity, preservation, mapping, archive, and echo-suppression tests pass.

~~~powershell
git add supabase/migrations/20260829133000_lightspeed_inbound_apply.sql src/types/db/database.types.ts src/modules/lightspeed-sync tests/integration/lightspeed-inbound-apply.test.ts tests/unit/modules/lightspeed-sync/apply-remote-family.test.ts
git commit -m "feat: apply Lightspeed families atomically"
~~~

### Task 8: Apply Versioned Inventory and Send Guarded Delta Adjustments

**Files:**

- Create: supabase/migrations/20260829134500_lightspeed_inventory_versions.sql
- Modify: src/types/db/database.types.ts
- Create: src/modules/lightspeed-sync/domain/inventoryOperations.ts
- Create: src/modules/lightspeed-sync/application/processInventory.ts
- Create: src/modules/lightspeed-sync/infrastructure/lightspeed/2026-07/inventoryWriter.ts
- Modify: src/modules/lightspeed-sync/application/processInbox.ts
- Modify: src/modules/lightspeed-sync/application/processOutbox.ts
- Create: tests/unit/modules/lightspeed-sync/inventory-operations.test.ts
- Create: tests/integration/lightspeed-inventory-apply.test.ts

**Interfaces:**

- Produces remote_inventory_version/quantity on variant links and RPC apply_lightspeed_inventory_observation.
- Produces planInventoryAdjustment and LightspeedInventoryWriteGateway.adjustStock.

- [ ] **Step 1: Write failing version and delta tests**

~~~ts
describe("designated-outlet inventory", () => {
  it("ignores a duplicate or older remote version", async () => {
    const link = await insertVariantLink(client, {
      remoteInventoryVersion: 413,
      remoteInventoryQuantity: 2,
    });
    const result = await applyInventoryObservation(client, link, {
      quantity: 9,
      version: 412,
    });
    expect(result.applied).toBe(false);
    expect(await loadLocalStock(client, link.websiteVariantId)).toBe(2);
  });

  it("sets local stock from a newer authoritative observation without echo", async () => {
    const link = await insertVariantLink(client, {
      remoteInventoryVersion: 413,
      remoteInventoryQuantity: 2,
    });
    const result = await applyInventoryObservation(client, link, {
      quantity: 1,
      version: 414,
    });
    expect(result.applied).toBe(true);
    expect(await loadLocalStock(client, link.websiteVariantId)).toBe(1);
    expect(await countCatalogOutboxRows(client, link.websiteProductId)).toBe(0);
  });

  it("calculates a delta only from a fresh observed version", () => {
    expect(
      planInventoryAdjustment({
        observedQuantity: 1,
        desiredQuantity: 3,
        observedVersion: 413,
        currentRemoteQuantity: 1,
        currentRemoteVersion: 413,
      }),
    ).toEqual({ kind: "adjust", delta: 2, baseVersion: 413 });
  });
});
~~~

- [ ] **Step 2: Run inventory tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/inventory-operations.test.ts tests/integration/lightspeed-inventory-apply.test.ts
~~~

Expected: FAIL because inventory version columns, planner, writer, and RPC do not exist.

- [ ] **Step 3: Add monotonic local apply**

Add remote_inventory_version bigint and remote_inventory_quantity integer to lightspeed_sync_variant_links. The service-role-only RPC accepts connection_id, lightspeed_product_id, outlet_id, quantity, and version.

The RPC rejects another outlet, returns applied=false for version less than or equal to the stored version, sets rdk.sync_origin=lightspeed, updates product_variants.stock, updates the stored remote version/quantity, recalculates product is_out_of_stock, and returns applied=true in one transaction.

A version gap greater than one is allowed only after processInbox performs an authoritative inventory fetch; mark the audit reason as version_gap_refetch.

- [ ] **Step 4: Implement guarded adjustment request**

Use this strict body:

~~~json
{
  "stock_adjustments": [
    {
      "outlet_id": "outlet-1",
      "product_id": "product-10",
      "quantity": "2",
      "reason": "CUSTOM",
      "custom_inventory_adjustment_reason_id": "reason-increase-id"
    }
  ]
}
~~~

The configured mapping kind `inventory_adjustment_reason` has local keys `increase` and `decrease`. `reasonMappingToWire` turns a validated `builtin:REASON` token into `reason: REASON` with no custom ID, or a discovered custom UUID into `reason: CUSTOM` plus `custom_inventory_adjustment_reason_id`. It rejects a sign that conflicts with the chosen reason. Initial positive stock may use `STOCK_FOUND`. Zero emits no request. The batch contains 1–1000 entries and posts to `/api/2026-07/stock_adjustments`.

Before sending, refetch the designated outlet and compare quantity/version to the intent's observation. Replan against the fresh base only when policy permits. On an ambiguous timeout:

- desired quantity already observed: mark success;
- original quantity/version still observed: retry once through the operation row;
- any other movement: needs_attention, no automatic second delta.

- [ ] **Step 5: Wire initial stock, admin adjustments, and inbound events**

After a new family/variant is linked, initial stock fetches current quantity/version and requests desired minus observed. An admin website stock edit becomes `inventory.adjustment.requested` only when its origin is ordinary catalog editing. `website_sale`, `website_refund`, and `lightspeed` origins never produce adjustment intents.

inventory.update for another outlet is an audited no-op. The configured outlet refetches authoritative inventory and calls the monotonic RPC. It sets/confirms local quantity; it never adds or subtracts the webhook value.

- [ ] **Step 6: Apply, verify, and commit**

Run:

~~~powershell
npx supabase db reset
npm run gen:types:local
npx vitest run tests/unit/modules/lightspeed-sync/inventory-operations.test.ts tests/integration/lightspeed-inventory-apply.test.ts
npm run typecheck
~~~

Expected: version, outlet, delta, timeout, initial stock, and echo-suppression tests pass.

~~~powershell
git add supabase/migrations/20260829134500_lightspeed_inventory_versions.sql src/types/db/database.types.ts src/modules/lightspeed-sync tests/unit/modules/lightspeed-sync/inventory-operations.test.ts tests/integration/lightspeed-inventory-apply.test.ts
git commit -m "feat: synchronize versioned Lightspeed inventory"
~~~

### Task 9: Approve Initial Links and Activate Reconciliation Repairs Safely

**Files:**

- Create: src/modules/lightspeed-sync/application/approveLinks.ts
- Create: src/modules/lightspeed-sync/application/activateReconciliation.ts
- Create: src/modules/lightspeed-sync/application/resolveConflict.ts
- Create: app/api/admin/lightspeed/reconciliation/[runId]/approve/route.ts
- Create: app/api/admin/lightspeed/reconciliation/[runId]/activate/route.ts
- Create: app/api/admin/lightspeed/conflicts/[conflictId]/route.ts
- Modify: app/api/admin/lightspeed/settings/route.ts
- Modify: src/modules/lightspeed-sync/presentation/admin/LightspeedSettingsPageContent.tsx
- Modify: src/modules/lightspeed-sync/infrastructure/repositories/scanRepository.ts
- Modify: src/modules/lightspeed-sync/infrastructure/repositories/linkRepository.ts
- Create: tests/unit/modules/lightspeed-sync/reconciliation-activation.test.ts

**Interfaces:**

- Consumes complete scan proposals, current local/remote snapshots, and tenant-admin identity.
- Produces approveProposals, activateApprovedRun, and resolveConflict with audited new outbox intents.

- [ ] **Step 1: Write failing approval and stale-scan tests**

~~~ts
describe("reconciliation activation", () => {
  it("writes stable links and a common base without enqueueing repair on approval", async () => {
    const harness = createActivationHarness(completeExactMatchRun());
    await harness.approveProposals(["scan-item-1"], harness.adminContext);
    expect(harness.links.createStableLinks).toHaveBeenCalled();
    expect(harness.outbox.insert).not.toHaveBeenCalled();
  });

  it("rejects activation of an incomplete or superseded run", async () => {
    const harness = createActivationHarness(incompleteRun());
    await expect(
      harness.activateApprovedRun(harness.runId, harness.adminContext),
    ).rejects.toThrow("scan_not_complete");
  });

  it("revalidates current snapshots before enqueueing repair", async () => {
    const harness = createActivationHarness(runWhoseLocalRevisionChanged());
    await expect(
      harness.activateApprovedRun(harness.runId, harness.adminContext),
    ).rejects.toThrow("scan_stale");
    expect(harness.outbox.insert).not.toHaveBeenCalled();
  });
});
~~~

- [ ] **Step 2: Run activation tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/reconciliation-activation.test.ts
~~~

Expected: FAIL because approval/activation use cases do not exist.

- [ ] **Step 3: Implement approval transaction**

approveProposals accepts only exact_unique_match item IDs from a complete active run. It reloads both sides and rechecks unique normalized SKU, family membership, condition, Size attribute, mappings, and absence of conflicting links. In one repository transaction it creates family/variant links and stores the current canonical state as `last_common_snapshot` plus its canonical SHA-256 `last_common_snapshot_hash`.

For images, approval displays one-to-one normalized content/URL matches separately. Only image pairs explicitly checked by the admin create `initial_adopted` image links; every unmatched pre-existing remote image stays unmanaged and cannot be deleted by website replacement logic.

Approval records admin user, run/item IDs, local/remote identities, snapshot hash, and timestamp. It performs zero local or remote mutation.

- [ ] **Step 4: Implement explicit activation and conflicts**

activateApprovedRun reloads each approved link. If snapshot hashes changed since approval, mark stale and require a new scan. Otherwise enqueue one catalog.family.changed event per selected family with operation key:

~~~text
reconcile:{scanRunId}:{familyLinkId}:{currentSnapshotHash}
~~~

Archive repair requires both a complete scan and a direct authoritative fetch confirming inactive/deleted. List absence alone cannot enqueue archive.

resolveConflict accepts use_website, use_lightspeed, map_value, retry, or archive. It stores the selected value/resolution and creates a new event against the latest base; it never edits the old audit record.

- [ ] **Step 5: Add authenticated routes and guarded Phase 2 settings**

Each route validates UUID params, requireAdminApi, tenant ownership, and a strict body. Return 409 for stale scan/conflict and 422 for mapping/structural errors.

Extend the settings PATCH with strict `allowlistedProductIds`, `allowlistedLightspeedFamilyIds`, `inboundApplyEnabled`, `outboundCatalogEnabled`, and `inventoryAdjustmentsEnabled`. Enabling any Phase 2 switch requires passing `products_2026_10_contract` and `capture_24h` rollout gates plus a current complete reconciliation scan. Disabling is always allowed. Reject `salesRefundsEnabled=true` throughout this plan. The settings page exposes the three switches, both allowlists, missing-gate reasons, and a confirmation that writes affect only the designated outlet/products.

While any business sync switch is active, `allowlistedProductIds` is monotonic: additions are allowed, but removing a linked product is rejected. An explicit deactivation workflow must first block checkout, drain/resolve its outbox, archive both representations, pass a complete scan, and turn its write scope off; only then may the ID be removed. This prevents an already-synchronized product from silently becoming a local-only sale and drifting remote inventory.

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/reconciliation-activation.test.ts
npm run typecheck
npm run lint -- --quiet
~~~

Expected: approval, activation, stale, archive evidence, duplicate link, and conflict tests pass.

- [ ] **Step 6: Commit**

~~~powershell
git add src/modules/lightspeed-sync app/api/admin/lightspeed/reconciliation app/api/admin/lightspeed/conflicts tests/unit/modules/lightspeed-sync/reconciliation-activation.test.ts
git commit -m "feat: approve and activate Lightspeed reconciliation"
~~~

### Task 10: Surface Product Sync State and Conflict Resolution

**Files:**

- Create: src/modules/lightspeed-sync/presentation/admin/ProductSyncBadge.tsx
- Create: src/modules/lightspeed-sync/presentation/admin/ProductSyncDetailsPanel.tsx
- Create: src/modules/lightspeed-sync/presentation/admin/ConflictResolutionPanel.tsx
- Modify: src/modules/catalog/presentation/admin/inventory/listing/inventoryClientContracts.ts
- Modify: src/modules/catalog/presentation/admin/inventory/listing/products/InventoryProductTableRow.tsx
- Modify: src/modules/catalog/presentation/admin/inventory/listing/products/InventoryProductMobileCards.tsx
- Modify: src/modules/catalog/presentation/admin/inventory/listing/details/InventoryProductDetailsModal.tsx
- Modify: src/modules/lightspeed-sync/presentation/admin/LightspeedProposalTable.tsx
- Create: tests/unit/modules/lightspeed-sync/product-sync-ui.test.tsx

**Interfaces:**

- Consumes a redacted SyncProductSummary projection.
- Produces pending, synchronized, and needs_attention badges plus bounded conflict actions.

- [ ] **Step 1: Write failing accessible-state tests**

~~~tsx
describe("product sync state UI", () => {
  it.each([
    ["pending", "Pending Lightspeed sync"],
    ["synchronized", "Synchronized with Lightspeed"],
    ["needs_attention", "Lightspeed sync needs attention"],
  ] as const)("renders %s with an accessible label", (state, label) => {
    render(<ProductSyncBadge state={state} />);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it("shows only safe conflict choices", () => {
    render(<ConflictResolutionPanel conflict={priceConflictFixture()} />);
    expect(screen.getByRole("button", { name: "Use website value" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Use Lightspeed value" })).toBeVisible();
    expect(screen.queryByText(/raw response/i)).not.toBeInTheDocument();
  });
});
~~~

- [ ] **Step 2: Run UI tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/product-sync-ui.test.tsx
~~~

Expected: FAIL because sync state components do not exist.

- [ ] **Step 3: Add the redacted projection**

~~~ts
export interface SyncProductSummary {
  state: "pending" | "synchronized" | "needs_attention";
  lastSuccessfulAt: string | null;
  pendingAction: string | null;
  retryCount: number;
  designatedOutletId: string | null;
  lightspeedFamilyId: string | null;
  conflicts: Array<{
    id: string;
    fieldPath: string;
    websiteValue: unknown;
    lightspeedValue: unknown;
    authority: "website" | "lightspeed";
  }>;
}
~~~

Extend the admin inventory query through the lightspeed-sync public application query, not by importing its infrastructure repository into catalog presentation. Batch summaries by visible product IDs to avoid N+1 reads.

- [ ] **Step 4: Implement details and actions**

Table/mobile rows show the compact badge. The details modal shows last success, pending action, retry count, remote IDs, designated outlet, and conflicts. Conflict actions call the API from Task 9 and refresh the affected product.

Do not show credentials, raw bodies, payment references, complete remote responses, or customer details. Display unavailable cost as Not available from granted Lightspeed scopes.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/product-sync-ui.test.tsx
npm run test:unit
npm run typecheck
~~~

Expected: sync UI and existing inventory tests pass; typecheck exits 0.

~~~powershell
git add src/modules/lightspeed-sync/presentation src/modules/catalog/presentation/admin/inventory tests/unit/modules/lightspeed-sync/product-sync-ui.test.tsx
git commit -m "feat: show Lightspeed product sync state"
~~~

### Task 11: Pass Catalog/Inventory Contract Tests and Run the 10-Product Pilot

**Files:**

- Modify: tests/integration/lightspeed-2026-10-contract.test.ts
- Create: tests/integration/lightspeed-catalog-faults.test.ts
- Create: docs/runbooks/LIGHTSPEED_CATALOG_PILOT.md
- Modify: docs/RUNBOOK.md

**Interfaces:**

- Consumes 20 designated test products and the Plan 1 sandbox connection.
- Produces verified create/edit/add/archive/image/stock fixtures and the Phase 2 operational evidence.

- [ ] **Step 1: Extend opt-in live contract coverage**

Add live tests for:

| Contract | Assertion |
|---|---|
| Create/refetch | generated family/product IDs map by code/ordered attributes; no position assumption |
| Family/product PATCH | nested price field matches retailer tax mode; replacement collections preserve unmanaged values |
| Variant/image | add returns generated IDs; image POST/DELETE round-trips |
| Archive | active channel flags become false; no DELETE request is issued |
| Inventory | stock_adjustments body and signed reason are accepted; observed quantity converges without duplicate delta |

Every live test creates uniquely prefixed test data, records generated IDs, archives rather than deletes in cleanup, and saves sanitized fixtures.

- [ ] **Step 2: Run fault and replay tests**

tests/integration/lightspeed-catalog-faults.test.ts injects duplicate/reversed events, timeout after create/PATCH/stock commit, 429/500/401/403/409 responses, cursor repetition, partial scans, split families, image fetch failure, simultaneous local/remote edits, and worker lease expiry.

Run:

~~~powershell
npx vitest run tests/integration/lightspeed-catalog-faults.test.ts
npm run test:unit
npm run typecheck
npm run lint
npm run build
~~~

Expected: all commands exit 0; replay produces no duplicate remote family, product, image deletion, or stock movement.

- [ ] **Step 3: Execute controlled test set**

With mutation switches on only for the test allowlist, exercise 20 products covering standard/variant families, zero stock, multiple images, category/model mappings, create in both directions, edit in both directions, variant add/archive/reactivate, family archive, manual stock increase/decrease, and conflicts.

Pass condition: every managed value converges, every generated ID is linked, and every needs_attention item has evidence and a safe resolution.

- [ ] **Step 4: Execute 24-hour 10-product catalog pilot**

Enable inbound_apply, outbound_catalog, and inventory_adjustments only for 10 real allowlisted products. Keep sales_refunds false. Confirm:

- 99 percent healthy catalog/inventory changes converge within 60 seconds;
- missed webhook recovery converges within 15 minutes;
- zero unexplained managed drift over 24 hours;
- zero incomplete-scan archives and zero DELETE calls;
- pilot-product checkout attempts are rejected before payment and produce zero sale.completed events while sales_refunds is false.

Stop on any duplicate family/product, ambiguous stock movement, incorrect archive, data loss, or payment-order regression.

- [ ] **Step 5: Record the catalog pilot rollout gate**

After every controlled and 24-hour pass condition is satisfied, call `recordRolloutGate` for `catalog_inventory_pilot` with the sanitized runbook SHA-256, test commit, allowlist, observation window, convergence percentiles, and approving admin. A failed or incomplete condition records a failed gate and leaves sales/refunds disabled.

- [ ] **Step 6: Commit evidence/runbook**

~~~powershell
git add tests/integration/lightspeed-2026-10-contract.test.ts tests/integration/lightspeed-catalog-faults.test.ts tests/fixtures/lightspeed docs/runbooks/LIGHTSPEED_CATALOG_PILOT.md docs/RUNBOOK.md
git commit -m "test: verify Lightspeed catalog pilot readiness"
~~~

Do not begin plan 3 until the 24-hour pilot passes and the user approves sales/refund work.
