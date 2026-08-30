# Lightspeed Sync Foundation and Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Deliver a production-safe capture-only Lightspeed integration that verifies signed webhooks and stores only PII-safe trigger evidence durably, reads and normalizes the 2026-10 catalog, runs complete dry-run reconciliation, and performs zero catalog, inventory, sale, or refund writes.

**Architecture:** Add a dedicated lightspeed-sync vertical module with pure canonical domain rules, application ports, Supabase-backed durable state, and versioned X-Series adapters. Vercel cron routes claim short database leases and process bounded batches; the admin surface connects OAuth, configures mappings, and displays capture/reconciliation evidence while every mutation switch remains off.

**Tech Stack:** Next.js 16 App Router, TypeScript 5.9 strict mode, Supabase Postgres and RLS, Zod 4, Vitest 4, Node crypto, OAuth 2.0, Vercel Cron.

**Spec:** docs/superpowers/specs/2026-08-29-lightspeed-bidirectional-sync-rebuild-design.md

## Global Constraints

| Constraint | Required value |
|---|---|
| Product API | 2026-10; production mutation code remains disabled until released-contract fixtures pass |
| Inventory scope | Exactly one configured Lightspeed e-commerce outlet |
| Capture phase | inbound_apply, outbound_catalog, inventory_adjustments, and sales_refunds are false |
| Webhook | Verify X-Signature HMAC-SHA256 over the exact raw body; store its hash plus sanitized trigger identity before returning 204 within five seconds; never persist a raw sale body |
| Recovery | Complete reconciliation at least every 15 minutes; incomplete scans cannot link, unlink, archive, or apply |
| Identity | Store generated family/product IDs; normalized SKU is proposal evidence only |
| Money | Integer cents internally; validated decimal wire representation only in the adapter |
| Cost | Null and excluded when the granted API capability cannot read it; never default to zero |
| Scheduler | One-minute execution requires Vercel Pro/Enterprise or an equivalent external scheduler; fail deployment readiness if unavailable |
| Architecture | No Lightspeed HTTP, Supabase, Next.js, or React imports in domain files |

---

## Program Order

This is plan 1 of 3. Its capture-only release must be deployed and observed for 24 hours before starting:

- docs/superpowers/plans/2026-08-29-lightspeed-catalog-and-reconciliation.md
- docs/superpowers/plans/2026-08-29-lightspeed-sales-refunds-and-rollout.md

## File Structure

| Responsibility | Files |
|---|---|
| Database foundation | Create supabase/migrations/20260829120000_lightspeed_sync_identity.sql and 20260829123000_lightspeed_sync_delivery.sql; regenerate src/types/db/database.types.ts |
| Pure domain | Create src/modules/lightspeed-sync/domain/{canonical,canonicalJson,events,money,sku,merge,ownership}.ts |
| Application | Create src/modules/lightspeed-sync/application/{canonicalHash,ports,processInbox,runReconciliation,worker}.ts |
| Infrastructure | Create src/modules/lightspeed-sync/infrastructure/repositories/{connectionRepository,mappingRepository,inboxRepository,auditRepository,linkRepository,scanRepository,websiteCatalogReader,rolloutGateRepository}.ts and infrastructure/lightspeed/2026-10/{schemas,client,normalizer}.ts |
| Security/OAuth | Create infrastructure/{tokenCipher,oauth}.ts and app/api/admin/lightspeed/oauth/{start,callback}/route.ts |
| Delivery routes | Create app/api/webhooks/lightspeed/[connectionKey]/[triggerType]/route.ts and app/api/internal/lightspeed/{worker,reconcile}/route.ts |
| Admin capture UI | Create app/admin/settings/lightspeed/page.tsx and src/modules/lightspeed-sync/presentation/admin/*; modify adminSidebarNavigation.ts |
| Configuration | Modify src/config/env.ts, .env.example, both deployment workflows; create vercel.json |
| Tests | Create tests/unit/modules/lightspeed-sync/*, tests/integration/lightspeed-sync-schema.test.ts, and tests/fixtures/lightspeed/* |
| Documentation | Create docs/runbooks/LIGHTSPEED_CAPTURE.md and update docs/RUNBOOK.md |

### Task 1: Add Connection, Mapping, and Stable Identity Schema

**Files:**

- Create: supabase/migrations/20260829120000_lightspeed_sync_identity.sql
- Modify: src/types/db/database.types.ts
- Create: tests/integration/lightspeed-sync-schema.test.ts

**Interfaces:**

- Produces tables lightspeed_connections, lightspeed_sync_mappings, lightspeed_sync_family_links, and lightspeed_sync_variant_links.
- Later tasks rely on public.is_admin_for_tenant(tenant_id), partial unique remote/local ID indexes, stored retailer identity, token_version, and the four independent write switches.

- [ ] **Step 1: Write the failing schema contract test**

~~~ts
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const client = new Client({ connectionString: process.env.SUPABASE_DB_URL });

describe("Lightspeed sync identity schema", () => {
  beforeAll(async () => client.connect());
  afterAll(async () => client.end());

  it("has tenant-scoped connection, mapping, family, and variant tables", async () => {
    const result = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[]) order by table_name",
      [[
        "lightspeed_connections",
        "lightspeed_sync_family_links",
        "lightspeed_sync_mappings",
        "lightspeed_sync_variant_links",
      ]],
    );

    expect(result.rows.map((row) => row.table_name)).toEqual([
      "lightspeed_connections",
      "lightspeed_sync_family_links",
      "lightspeed_sync_mappings",
      "lightspeed_sync_variant_links",
    ]);
  });

  it("rejects duplicate active remote product links", async () => {
    const indexes = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public' and tablename = 'lightspeed_sync_variant_links'",
    );

    expect(indexes.rows.map((row) => row.indexname)).toContain(
      "lightspeed_sync_variant_links_remote_product_key",
    );
  });

  it("enforces one-to-one inbound identities but permits shared outbound targets", async () => {
    const indexes = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public' and tablename = 'lightspeed_sync_mappings'",
    );
    expect(indexes.rows.map((row) => row.indexname)).toContain(
      "lightspeed_sync_mappings_inbound_identity_key",
    );
  });

  it("rejects a sync row whose tenant does not own its connection", async () => {
    await expect(insertMappingWithMismatchedConnectionTenant(client)).rejects.toThrow();
  });
});
~~~

- [ ] **Step 2: Run the schema test to verify RED**

Run:

~~~powershell
npx vitest run tests/integration/lightspeed-sync-schema.test.ts
~~~

Expected: FAIL because lightspeed_connections does not exist.

- [ ] **Step 3: Create the identity migration**

Implement these exact tables and constraints:

~~~sql
begin;

create table public.lightspeed_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  domain_prefix text not null check (domain_prefix = lower(trim(domain_prefix))),
  retailer_id text,
  retailer_currency_code text check (retailer_currency_code ~ '^[A-Z]{3}$'),
  outlet_id text,
  register_id text,
  source_author_id text,
  size_attribute_id text,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  token_version bigint not null default 0,
  granted_scopes text[] not null default '{}',
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'paused_auth', 'needs_attention')),
  inbound_template jsonb not null default '{}'::jsonb,
  capture_enabled boolean not null default true,
  inbound_apply_enabled boolean not null default false,
  outbound_catalog_enabled boolean not null default false,
  inventory_adjustments_enabled boolean not null default false,
  sales_refunds_enabled boolean not null default false,
  allowlisted_product_ids uuid[] not null default '{}',
  allowlisted_lightspeed_family_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id),
  unique (tenant_id),
  unique (domain_prefix)
);

create table public.lightspeed_sync_mappings (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.lightspeed_connections(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in (
    'brand', 'category', 'condition_tag', 'inventory_adjustment_reason', 'model_tag',
    'payment_type', 'shipping_product', 'tax', 'variant_attribute'
  )),
  local_key text not null,
  remote_id text not null,
  remote_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, kind, local_key),
  foreign key (connection_id, tenant_id)
    references public.lightspeed_connections(id, tenant_id) on delete cascade
);

create unique index lightspeed_sync_mappings_inbound_identity_key
  on public.lightspeed_sync_mappings(connection_id, kind, remote_id)
  where kind in ('brand', 'category', 'condition_tag', 'model_tag', 'variant_attribute');

create table public.lightspeed_sync_family_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.lightspeed_connections(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  website_product_id uuid references public.products(id) on delete set null,
  lightspeed_family_id text,
  state text not null default 'proposed'
    check (state in ('proposed', 'linked', 'archived', 'needs_attention')),
  last_common_snapshot jsonb,
  last_common_snapshot_hash text
    check (last_common_snapshot_hash is null or length(last_common_snapshot_hash) = 64),
  local_revision bigint not null default 0,
  remote_revision text,
  tombstoned_at timestamptz,
  last_succeeded_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, connection_id, tenant_id),
  foreign key (connection_id, tenant_id)
    references public.lightspeed_connections(id, tenant_id) on delete cascade
);

create unique index lightspeed_sync_family_links_website_product_key
  on public.lightspeed_sync_family_links(connection_id, website_product_id)
  where website_product_id is not null;
create unique index lightspeed_sync_family_links_remote_family_key
  on public.lightspeed_sync_family_links(connection_id, lightspeed_family_id)
  where lightspeed_family_id is not null;

create table public.lightspeed_sync_variant_links (
  id uuid primary key default gen_random_uuid(),
  family_link_id uuid not null references public.lightspeed_sync_family_links(id) on delete cascade,
  connection_id uuid not null references public.lightspeed_connections(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  website_variant_id uuid references public.product_variants(id) on delete set null,
  lightspeed_product_id text,
  normalized_sku text not null,
  last_common_snapshot jsonb,
  tombstoned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, connection_id, tenant_id),
  foreign key (connection_id, tenant_id)
    references public.lightspeed_connections(id, tenant_id) on delete cascade,
  foreign key (family_link_id, connection_id, tenant_id)
    references public.lightspeed_sync_family_links(id, connection_id, tenant_id)
    on delete cascade
);

create unique index lightspeed_sync_variant_links_website_variant_key
  on public.lightspeed_sync_variant_links(connection_id, website_variant_id)
  where website_variant_id is not null;
create unique index lightspeed_sync_variant_links_remote_product_key
  on public.lightspeed_sync_variant_links(connection_id, lightspeed_product_id)
  where lightspeed_product_id is not null;

alter table public.lightspeed_connections enable row level security;
alter table public.lightspeed_sync_mappings enable row level security;
alter table public.lightspeed_sync_family_links enable row level security;
alter table public.lightspeed_sync_variant_links enable row level security;

create policy "tenant admins read lightspeed connections"
  on public.lightspeed_connections for select
  using (public.is_admin_for_tenant(tenant_id));
create policy "tenant admins read lightspeed mappings"
  on public.lightspeed_sync_mappings for select
  using (public.is_admin_for_tenant(tenant_id));
create policy "tenant admins read lightspeed family links"
  on public.lightspeed_sync_family_links for select
  using (public.is_admin_for_tenant(tenant_id));
create policy "tenant admins read lightspeed variant links"
  on public.lightspeed_sync_variant_links for select
  using (public.is_admin_for_tenant(tenant_id));

grant select (
  id, tenant_id, domain_prefix, retailer_id, retailer_currency_code,
  outlet_id, register_id, source_author_id, size_attribute_id,
  token_expires_at, token_version, granted_scopes, status, inbound_template,
  capture_enabled, inbound_apply_enabled, outbound_catalog_enabled,
  inventory_adjustments_enabled, sales_refunds_enabled,
  allowlisted_product_ids, allowlisted_lightspeed_family_ids,
  created_at, updated_at
) on public.lightspeed_connections to authenticated;
grant select on public.lightspeed_sync_mappings to authenticated;
grant select on public.lightspeed_sync_family_links to authenticated;
grant select on public.lightspeed_sync_variant_links to authenticated;
grant all on public.lightspeed_connections to service_role;
grant all on public.lightspeed_sync_mappings to service_role;
grant all on public.lightspeed_sync_family_links to service_role;
grant all on public.lightspeed_sync_variant_links to service_role;

commit;
~~~

Do not grant authenticated access to either ciphertext column and do not grant authenticated insert, update, or delete. Admin mutations go through authenticated route handlers that call module application services using the service-role client after requireAdminApi and tenant verification.

- [ ] **Step 4: Apply the migration and regenerate types**

Run:

~~~powershell
npx supabase db reset
npm run gen:types:local
npx vitest run tests/integration/lightspeed-sync-schema.test.ts
~~~

Expected: database reset succeeds, generated Database includes all four tables, and 2 tests pass.

- [ ] **Step 5: Commit**

~~~powershell
git add supabase/migrations/20260829120000_lightspeed_sync_identity.sql src/types/db/database.types.ts tests/integration/lightspeed-sync-schema.test.ts
git commit -m "feat: add Lightspeed sync identity schema"
~~~

### Task 2: Add Durable Delivery, Conflict, Audit, and Scan Schema

**Files:**

- Create: supabase/migrations/20260829123000_lightspeed_sync_delivery.sql
- Modify: src/types/db/database.types.ts
- Modify: tests/integration/lightspeed-sync-schema.test.ts

**Interfaces:**

- Produces tables lightspeed_sync_inbox, lightspeed_sync_outbox, lightspeed_sync_operations, lightspeed_sync_conflicts, lightspeed_sync_scan_runs, lightspeed_sync_scan_items, lightspeed_sync_audit_log, and lightspeed_sync_rollout_gates.
- Produces RPC functions claim_lightspeed_sync_inbox(batch_size, lease_seconds) and claim_lightspeed_sync_outbox(batch_size, lease_seconds).

- [ ] **Step 1: Extend the schema test with delivery invariants**

~~~ts
it("enforces tenant-aware inbox deduplication and operation idempotency", async () => {
  const indexes = await client.query<{ indexname: string }>(
    "select indexname from pg_indexes where schemaname = 'public' and indexname = any($1::text[]) order by indexname",
    [[
      "lightspeed_sync_inbox_dedupe_key",
      "lightspeed_sync_operations_operation_key",
    ]],
  );

  expect(indexes.rows.map((row) => row.indexname)).toEqual([
    "lightspeed_sync_inbox_dedupe_key",
    "lightspeed_sync_operations_operation_key",
  ]);
});

it("stores a webhook hash and sanitized trigger but has no raw-body column", async () => {
  const columns = await client.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'lightspeed_sync_inbox'",
  );
  const names = columns.rows.map((row) => row.column_name);
  expect(names).toContain("body_sha256");
  expect(names).toContain("sanitized_trigger");
  expect(names).not.toContain("raw_body");
});

it("exposes lease-based inbox and outbox claim functions", async () => {
  const routines = await client.query<{ routine_name: string }>(
    "select routine_name from information_schema.routines where routine_schema = 'public' and routine_name like 'claim_lightspeed_sync_%' order by routine_name",
  );

  expect(routines.rows.map((row) => row.routine_name)).toEqual([
    "claim_lightspeed_sync_inbox",
    "claim_lightspeed_sync_outbox",
  ]);
});
~~~

- [ ] **Step 2: Run the new tests to verify RED**

Run:

~~~powershell
npx vitest run tests/integration/lightspeed-sync-schema.test.ts
~~~

Expected: FAIL because the delivery indexes and claim functions do not exist.

- [ ] **Step 3: Create the delivery migration**

Use the same required base columns on every operational table: id uuid, connection_id, tenant_id, created_at, and updated_at. Every table has a composite foreign key `(connection_id, tenant_id)` to `lightspeed_connections(id, tenant_id)` in addition to any parent-specific composite key; a service-role bug cannot cross-wire tenants. Add these exact specialized columns:

| Table | Specialized columns and constraints |
|---|---|
| lightspeed_sync_inbox | dedupe_key text, body_sha256 text check length 64, sanitized_trigger jsonb, request_headers jsonb, trigger_type text, resource_id text, resource_version bigint, state, attempts, next_attempt_at, lease_until, result_snapshot jsonb, error_class/code/message; unique(connection_id, dedupe_key) |
| lightspeed_sync_outbox | event_type text, schema_version int default 1, aggregate_id text, local_revision bigint, base_snapshot_hash text, correlation_id text, payload jsonb, operation_key text, state, attempts, next_attempt_at, lease_until, error fields; unique(connection_id, operation_key) |
| lightspeed_sync_operations | operation_key text, action text, target_id text, request_fingerprint text, remote_reference jsonb, state; unique(connection_id, operation_key) |
| lightspeed_sync_conflicts | family_link_id, field_path text, base/local/remote/selected jsonb, authority text, resolution text, related_event_ids uuid[], resolved_at |
| lightspeed_sync_scan_runs | state, started_at, completed_at, cursor_state jsonb, expected_count, completed_count, completeness_proof jsonb, error_message |
| lightspeed_sync_scan_items | scan_run_id, lightspeed_family_id, website_product_id, category, canonical_snapshot jsonb, proposal jsonb; unique(scan_run_id, lightspeed_family_id, website_product_id) |
| lightspeed_sync_audit_log | correlation_id text, event_id uuid, action text, target_type/id text, request_metadata jsonb, response_metadata jsonb, result text, duration_ms int |
| lightspeed_sync_rollout_gates | gate_name text, state text check in pending/passed/failed/expired, evidence_hash text, evidence_metadata jsonb, passed_at/expires_at timestamptz, approved_by uuid; unique(connection_id, gate_name) |

Use this state check for inbox and outbox:

~~~sql
check (state in ('pending', 'processing', 'succeeded', 'retry_wait', 'needs_attention'))
~~~

Create the tenant-aware indexes:

~~~sql
create unique index lightspeed_sync_inbox_dedupe_key
  on public.lightspeed_sync_inbox(connection_id, dedupe_key);
create unique index lightspeed_sync_operations_operation_key
  on public.lightspeed_sync_operations(connection_id, operation_key);
create index lightspeed_sync_inbox_due
  on public.lightspeed_sync_inbox(next_attempt_at, created_at)
  where state in ('pending', 'retry_wait');
create index lightspeed_sync_outbox_due
  on public.lightspeed_sync_outbox(next_attempt_at, created_at)
  where state in ('pending', 'retry_wait');
~~~

Implement both claim functions with the same SKIP LOCKED pattern, substituting the table and return row type:

~~~sql
create or replace function public.claim_lightspeed_sync_inbox(
  batch_size integer,
  lease_seconds integer
)
returns setof public.lightspeed_sync_inbox
language sql
security definer
set search_path = public
as $function$
  with candidates as (
    select id
    from public.lightspeed_sync_inbox
    where (
      state in ('pending', 'retry_wait')
      and next_attempt_at <= now()
    ) or (
      state = 'processing'
      and lease_until < now()
    )
    order by created_at
    for update skip locked
    limit greatest(batch_size, 0)
  )
  update public.lightspeed_sync_inbox target
  set
    state = 'processing',
    attempts = target.attempts + 1,
    lease_until = now() + make_interval(secs => greatest(lease_seconds, 1)),
    updated_at = now()
  from candidates
  where target.id = candidates.id
  returning target.*;
$function$;
~~~

Revoke claim function execution from public, anon, and authenticated; grant it only to service_role. Apply select-only tenant-admin RLS to conflicts, scans, and audit. Inbox/outbox/operations allow service_role only because payloads may contain sensitive operational evidence. `sanitized_trigger` is constrained in application code to identifiers/version/outlet only; the migration has no column capable of retaining the unredacted raw webhook body.

- [ ] **Step 4: Apply, regenerate, and verify**

Run:

~~~powershell
npx supabase db reset
npm run gen:types:local
npx vitest run tests/integration/lightspeed-sync-schema.test.ts
npm run typecheck
~~~

Expected: schema tests pass and typecheck exits 0.

- [ ] **Step 5: Commit**

~~~powershell
git add supabase/migrations/20260829123000_lightspeed_sync_delivery.sql src/types/db/database.types.ts tests/integration/lightspeed-sync-schema.test.ts
git commit -m "feat: add durable Lightspeed delivery state"
~~~

### Task 3: Implement Canonical Value Types and Event Envelopes

**Files:**

- Create: src/modules/lightspeed-sync/domain/canonical.ts
- Create: src/modules/lightspeed-sync/domain/events.ts
- Create: src/modules/lightspeed-sync/domain/money.ts
- Create: src/modules/lightspeed-sync/domain/sku.ts
- Create: src/modules/lightspeed-sync/domain/canonicalJson.ts
- Create: src/modules/lightspeed-sync/application/canonicalHash.ts
- Create: src/modules/lightspeed-sync/index.ts
- Create: tests/unit/modules/lightspeed-sync/canonical.test.ts

**Interfaces:**

- Produces MoneyCents, normalizeSku, deterministic canonical JSON/SHA-256, CanonicalFamily, CanonicalVariant, CanonicalSyncSnapshot, SyncEventEnvelope, and parseSyncEventEnvelope.
- All later adapters convert wire values at their boundary and expose only these types.

- [ ] **Step 1: Write failing value and envelope tests**

~~~ts
import {
  centsToDecimal,
  decimalToCents,
  normalizeSku,
  parseSyncEventEnvelope,
} from "@/modules/lightspeed-sync";

describe("Lightspeed canonical primitives", () => {
  it("round-trips money without floating-point drift", () => {
    expect(decimalToCents("194.99")).toBe(19499);
    expect(centsToDecimal(19499)).toBe("194.99");
    expect(() => decimalToCents("194.999")).toThrow("more than two decimal places");
  });

  it("preserves display SKU while producing a case-folded key", () => {
    expect(normalizeSku("  RDK-AJ1-BRED-10  ")).toEqual({
      display: "RDK-AJ1-BRED-10",
      key: "rdk-aj1-bred-10",
    });
  });

  it("rejects an event without a base snapshot hash", () => {
    expect(() =>
      parseSyncEventEnvelope({
        event_id: crypto.randomUUID(),
        event_type: "catalog.family.edited",
        schema_version: 1,
        occurred_at: "2026-08-29T15:04:05Z",
        connection_id: crypto.randomUUID(),
        sync_family_id: crypto.randomUUID(),
        local_revision: 2,
        correlation_id: "corr-1",
        payload: {},
      }),
    ).toThrow();
  });

  it("hashes semantically identical families identically despite source ordering", () => {
    const first = canonicalFamilyFixture({
      managedTagKeys: ["model:aj1", "condition:new"],
      variantOrder: ["size-10.5", "size-10"],
    });
    const second = canonicalFamilyFixture({
      managedTagKeys: ["condition:new", "model:aj1"],
      variantOrder: ["size-10", "size-10.5"],
    });
    expect(hashCanonicalFamily(first)).toBe(hashCanonicalFamily(second));
  });
});
~~~

- [ ] **Step 2: Run the test to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/canonical.test.ts
~~~

Expected: FAIL because the lightspeed-sync public module does not exist.

- [ ] **Step 3: Define the canonical contracts**

~~~ts
// src/modules/lightspeed-sync/domain/canonical.ts
export type ProductCondition = "new" | "used";
export type WebsiteCategory = "sneakers" | "clothing" | "accessories" | "electronics";
export type SizeType = "shoe" | "clothing" | "custom" | "none";

export interface CanonicalImage {
  key: string;
  url: string;
  position: number;
}

export interface CanonicalInventory {
  outletId: string;
  quantity: number;
  remoteVersion: number | null;
}

export interface CanonicalVariant {
  syncVariantId: string;
  websiteVariantId: string | null;
  lightspeedProductId: string | null;
  sku: string;
  normalizedSku: string;
  sizeType: SizeType;
  sizeLabel: string;
  salePriceCents: number;
  unitCostCents: number | null;
  active: boolean;
  inventory: CanonicalInventory;
}

export interface CanonicalFamily {
  syncFamilyId: string;
  websiteProductId: string | null;
  lightspeedFamilyId: string | null;
  name: string;
  description: string | null;
  brandKey: string;
  modelKey: string;
  category: WebsiteCategory;
  condition: ProductCondition;
  images: CanonicalImage[];
  managedTagKeys: string[];
  archived: boolean;
  variants: CanonicalVariant[];
}

export interface CanonicalSyncSnapshot {
  family: CanonicalFamily;
  localRevision: number;
  remoteRevision: string | null;
  baseSnapshotHash: string;
  tombstonedAt: string | null;
}
~~~

Implement decimalToCents by validating with /^-?\d+(\.\d{1,2})?$/ and integer string arithmetic. Implement centsToDecimal with quotient/remainder arithmetic. Implement normalizeSku with Unicode NFKC normalization, trim, and toLocaleLowerCase("en-US"); reject an empty result.

`canonicalJsonString` recursively sorts object keys, rejects undefined/non-JSON values, lexically sorts set-semantics arrays such as `managedTagKeys`, and normalizes family variants by stable sync ID (falling back to normalized SKU before linking). Image order remains semantic: sort by position then image key and retain position. `hashCanonicalFamily` SHA-256 hashes that UTF-8 string. Never hash raw database row order, response order, locale-dependent formatting, or a wire DTO.

Define a strict Zod discriminated envelope schema for:

~~~ts
export type SyncEventType =
  | "catalog.family.changed"
  | "catalog.family.created"
  | "catalog.family.edited"
  | "catalog.family.archived"
  | "catalog.variant.created"
  | "catalog.variant.archived"
  | "inventory.adjustment.requested"
  | "sale.completed"
  | "sale.refund.requested";
~~~

Every event requires UUID `event_id`/`connection_id`, nonempty `aggregate_id`, schema version 1, UTC `occurred_at`, nonnegative `local_revision`, a 64-character `base_snapshot_hash`, nonempty `correlation_id`, and JSON-object payload. Catalog and inventory variants additionally require UUID `sync_family_id`. `sale.completed` instead requires UUID `website_order_id`; `sale.refund.requested` requires UUID `website_order_id` and `website_refund_id`. Their aggregate is the order, so a multi-item sale never pretends to belong to one product family. The all-zero hash is allowed only as the explicit no-common-snapshot sentinel for an unlinked create or immutable order/refund signal; linked family events use their stored common-snapshot hash.

- [ ] **Step 4: Export and verify GREEN**

Export domain-only symbols from src/modules/lightspeed-sync/index.ts. Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/canonical.test.ts
npm run typecheck
~~~

Expected: 3 tests pass and typecheck exits 0.

- [ ] **Step 5: Commit**

~~~powershell
git add src/modules/lightspeed-sync/domain src/modules/lightspeed-sync/application/canonicalHash.ts src/modules/lightspeed-sync/index.ts tests/unit/modules/lightspeed-sync/canonical.test.ts
git commit -m "feat: define canonical Lightspeed sync model"
~~~

### Task 4: Implement Field Ownership and Three-Way Merge

**Files:**

- Create: src/modules/lightspeed-sync/domain/ownership.ts
- Create: src/modules/lightspeed-sync/domain/merge.ts
- Create: tests/unit/modules/lightspeed-sync/merge.test.ts
- Modify: src/modules/lightspeed-sync/index.ts

**Interfaces:**

- Consumes CanonicalFamily and CanonicalVariant from Task 3.
- Produces ManagedFieldPath, FieldAuthority, MergeFieldInput, MergeFieldDecision, resolveManagedField, and resolveFamilyMerge.

- [ ] **Step 1: Write the failing decision-table tests**

~~~ts
import { resolveManagedField } from "@/modules/lightspeed-sync";

describe("three-way managed field merge", () => {
  it("accepts a remote-only change even when website owns conflicts", () => {
    expect(
      resolveManagedField({
        path: "family.name",
        base: "Jordan 1",
        local: "Jordan 1",
        remote: "Air Jordan 1",
        tombstoned: false,
      }),
    ).toEqual({
      kind: "apply_remote",
      selected: "Air Jordan 1",
      authority: "website",
      conflict: false,
    });
  });

  it("uses Lightspeed for a true concurrent price conflict", () => {
    expect(
      resolveManagedField({
        path: "variant.salePriceCents",
        base: 18000,
        local: 18500,
        remote: 19000,
        tombstoned: false,
      }),
    ).toEqual({
      kind: "resolve_conflict",
      selected: 19000,
      authority: "lightspeed",
      conflict: true,
    });
  });

  it("makes archive win over delayed edits", () => {
    expect(
      resolveManagedField({
        path: "family.description",
        base: "Old",
        local: "New",
        remote: "Remote",
        tombstoned: true,
      }).kind,
    ).toBe("archive");
  });
});
~~~

- [ ] **Step 2: Run the merge test to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/merge.test.ts
~~~

Expected: FAIL because resolveManagedField is not exported.

- [ ] **Step 3: Define the ownership map and resolver**

~~~ts
// src/modules/lightspeed-sync/domain/ownership.ts
export type ManagedFieldPath =
  | "family.name"
  | "family.description"
  | "family.brandKey"
  | "family.modelKey"
  | "family.category"
  | "family.condition"
  | "family.images"
  | "variant.sku"
  | "variant.sizeLabel"
  | "variant.salePriceCents"
  | "variant.unitCostCents"
  | "variant.active"
  | "variant.inventory.quantity";

export type FieldAuthority = "website" | "lightspeed";

export const FIELD_AUTHORITY: Readonly<Record<ManagedFieldPath, FieldAuthority>> = {
  "family.name": "website",
  "family.description": "website",
  "family.brandKey": "website",
  "family.modelKey": "website",
  "family.category": "website",
  "family.condition": "website",
  "family.images": "website",
  "variant.sku": "lightspeed",
  "variant.sizeLabel": "lightspeed",
  "variant.salePriceCents": "lightspeed",
  "variant.unitCostCents": "lightspeed",
  "variant.active": "lightspeed",
  "variant.inventory.quantity": "lightspeed",
};
~~~

~~~ts
// src/modules/lightspeed-sync/domain/merge.ts
import { FIELD_AUTHORITY, type ManagedFieldPath } from "./ownership";

export interface MergeFieldInput<T> {
  path: ManagedFieldPath;
  base: T;
  local: T;
  remote: T;
  tombstoned: boolean;
}

export type MergeFieldDecision<T> =
  | { kind: "unchanged"; selected: T; authority: "website" | "lightspeed"; conflict: false }
  | { kind: "apply_local"; selected: T; authority: "website" | "lightspeed"; conflict: false }
  | { kind: "apply_remote"; selected: T; authority: "website" | "lightspeed"; conflict: false }
  | { kind: "resolve_conflict"; selected: T; authority: "website" | "lightspeed"; conflict: true }
  | { kind: "archive"; selected: T; authority: "website" | "lightspeed"; conflict: false };

export function resolveManagedField<T>(input: MergeFieldInput<T>): MergeFieldDecision<T> {
  const authority = FIELD_AUTHORITY[input.path];
  if (input.tombstoned) {
    return { kind: "archive", selected: input.local, authority, conflict: false };
  }
  if (Object.is(input.local, input.remote)) {
    return { kind: "unchanged", selected: input.local, authority, conflict: false };
  }
  if (Object.is(input.local, input.base)) {
    return { kind: "apply_remote", selected: input.remote, authority, conflict: false };
  }
  if (Object.is(input.remote, input.base)) {
    return { kind: "apply_local", selected: input.local, authority, conflict: false };
  }
  return {
    kind: "resolve_conflict",
    selected: authority === "website" ? input.local : input.remote,
    authority,
    conflict: true,
  };
}
~~~

For arrays and objects, resolveFamilyMerge must pass stable normalized JSON values into resolveManagedField rather than relying on reference equality. It records B/L/R and the decision for every conflict. It omits unitCostCents entirely when the capability flag is false.

- [ ] **Step 4: Verify all decision branches**

Add tests for unchanged values, local-only edits, structural equality, missing mapping, and unavailable cost. Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/merge.test.ts
npm run typecheck
~~~

Expected: all merge tests pass and typecheck exits 0.

- [ ] **Step 5: Commit**

~~~powershell
git add src/modules/lightspeed-sync/domain src/modules/lightspeed-sync/index.ts tests/unit/modules/lightspeed-sync/merge.test.ts
git commit -m "feat: add Lightspeed field merge policy"
~~~

### Task 5: Add Encrypted Credential Storage and Connection Repositories

**Files:**

- Create: src/modules/lightspeed-sync/infrastructure/tokenCipher.ts
- Create: src/modules/lightspeed-sync/infrastructure/repositories/connectionRepository.ts
- Create: src/modules/lightspeed-sync/infrastructure/repositories/mappingRepository.ts
- Create: tests/unit/modules/lightspeed-sync/token-cipher.test.ts
- Modify: src/config/env.ts
- Modify: .env.example
- Modify: .github/workflows/staging.yml
- Modify: .github/workflows/production.yml

**Interfaces:**

- Produces encryptLightspeedSecret, decryptLightspeedSecret, LightspeedConnectionRepository, and LightspeedMappingRepository.
- OAuth and HTTP clients consume decrypted tokens only in server-side infrastructure code.

- [ ] **Step 1: Write the failing authenticated-encryption tests**

~~~ts
import {
  decryptLightspeedSecret,
  encryptLightspeedSecret,
} from "@/modules/lightspeed-sync/infrastructure/tokenCipher";

const key = Buffer.alloc(32, 7).toString("base64");

describe("Lightspeed token cipher", () => {
  it("round-trips with AES-256-GCM and a unique nonce", () => {
    const first = encryptLightspeedSecret("refresh-token", key);
    const second = encryptLightspeedSecret("refresh-token", key);

    expect(first).not.toBe(second);
    expect(decryptLightspeedSecret(first, key)).toBe("refresh-token");
    expect(decryptLightspeedSecret(second, key)).toBe("refresh-token");
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptLightspeedSecret("access-token", key);
    expect(() => decryptLightspeedSecret(encrypted + "A", key)).toThrow();
  });
});
~~~

- [ ] **Step 2: Run the cipher test to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/token-cipher.test.ts
~~~

Expected: FAIL because tokenCipher.ts does not exist.

- [ ] **Step 3: Implement AES-256-GCM with a versioned envelope**

~~~ts
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function parseKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("LIGHTSPEED_TOKEN_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

export function encryptLightspeedSecret(value: string, encodedKey: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, parseKey(encodedKey), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", nonce.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptLightspeedSecret(envelope: string, encodedKey: string): string {
  const [version, nonceText, tagText, ciphertextText] = envelope.split(".");
  if (version !== "v1" || !nonceText || !tagText || !ciphertextText) {
    throw new Error("Invalid Lightspeed credential envelope");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    parseKey(encodedKey),
    Buffer.from(nonceText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
~~~

- [ ] **Step 4: Add optional base env fields and strict feature configuration**

Add these optional fields to src/config/env.ts so unrelated builds still work while the integration is disconnected:

~~~ts
LIGHTSPEED_CLIENT_ID: z.string().min(1).optional(),
LIGHTSPEED_CLIENT_SECRET: z.string().min(1).optional(),
LIGHTSPEED_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
LIGHTSPEED_WEBHOOK_ROUTE_SECRET: z.string().min(32).optional(),
CRON_SECRET: z.string().min(16).optional(),
~~~

Add the same names to .env.example and both deployment workflow secret maps. Create a requireLightspeedServerConfig helper in tokenCipher.ts that throws a single configuration error if a connected/capture-enabled operation starts without all five server secrets. The webhook route secret is independent from the OAuth client secret so a client-secret rotation cannot silently invalidate every callback URL.

Implement repository methods with service-role Supabase:

~~~ts
export interface StoredOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  grantedScopes: string[];
  domainPrefix: string;
}

export class LightspeedConnectionRepository {
  constructor(private readonly db: AdminSupabaseClient) {}

  getByTenantId(tenantId: string): Promise<LightspeedConnectionRow | null>;
  getByDomainPrefix(domainPrefix: string): Promise<LightspeedConnectionRow | null>;
  saveOAuthTokens(tenantId: string, tokens: StoredOAuthTokens): Promise<LightspeedConnectionRow>;
  rotateOAuthTokens(
    connectionId: string,
    expectedTokenVersion: number,
    tokens: StoredOAuthTokens,
  ): Promise<boolean>;
  updateCaptureSettings(
    connectionId: string,
    tenantId: string,
    input: CaptureSettingsInput,
  ): Promise<LightspeedConnectionRow>;
}
~~~

rotateOAuthTokens must update where id and token_version both match, increment token_version, and return false on a concurrent refresh. Mapping repository methods are `listByKind`, `getByLocalKey`, `getInboundIdentityByRemoteId`, and `upsert`; every query includes connection_id and tenant_id. The remote-ID lookup accepts only the five partial-unique inbound identity kinds; payment, tax, shipping, and adjustment mappings are outbound lookups by local key and may intentionally share a remote target.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/token-cipher.test.ts
npm run typecheck
npm run lint -- --quiet
~~~

Expected: cipher tests pass; typecheck and lint exit 0.

~~~powershell
git add src/modules/lightspeed-sync/infrastructure src/config/env.ts .env.example .github/workflows/staging.yml .github/workflows/production.yml tests/unit/modules/lightspeed-sync/token-cipher.test.ts
git commit -m "feat: secure Lightspeed connection credentials"
~~~

### Task 6: Implement OAuth Connection and Rotating Refresh Tokens

**Files:**

- Create: src/modules/lightspeed-sync/infrastructure/oauth.ts
- Create: src/modules/lightspeed-sync/application/connectLightspeed.ts
- Create: app/api/admin/lightspeed/oauth/start/route.ts
- Create: app/api/admin/lightspeed/oauth/callback/route.ts
- Create: tests/unit/modules/lightspeed-sync/oauth.test.ts
- Modify: src/modules/lightspeed-sync/index.ts

**Interfaces:**

- Consumes LightspeedConnectionRepository and token cipher from Task 5.
- Produces buildLightspeedAuthorizationUrl, signOAuthState, verifyOAuthState, exchangeAuthorizationCode, and getValidAccessToken.

- [ ] **Step 1: Write failing OAuth state and scope tests**

~~~ts
import {
  buildLightspeedAuthorizationUrl,
  signOAuthState,
  verifyOAuthState,
} from "@/modules/lightspeed-sync/infrastructure/oauth";

const requiredScopes = [
  "channels:read",
  "inventory:read",
  "inventory:write",
  "outlets:read",
  "payment_types:read",
  "products:read",
  "products:write",
  "registers:read",
  "retailer:read",
  "sales:read",
  "sales:write",
  "taxes:read",
  "users:read",
  "webhooks",
];

describe("Lightspeed OAuth", () => {
  it("requests the complete least-privilege sync scope set", async () => {
    const state = await signOAuthState(
      { tenantId: crypto.randomUUID(), userId: crypto.randomUUID(), nonce: "n-1" },
      "state-secret-at-least-sixteen",
    );
    const url = buildLightspeedAuthorizationUrl({
      clientId: "client-id",
      redirectUri: "https://shop.example/api/admin/lightspeed/oauth/callback",
      state,
    });

    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(requiredScopes);
  });

  it("rejects a state token signed with another key", async () => {
    const state = await signOAuthState(
      { tenantId: crypto.randomUUID(), userId: crypto.randomUUID(), nonce: "n-2" },
      "first-state-secret",
    );
    await expect(verifyOAuthState(state, "second-state-secret")).rejects.toThrow();
  });
});
~~~

- [ ] **Step 2: Run the OAuth test to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/oauth.test.ts
~~~

Expected: FAIL because oauth.ts does not exist.

- [ ] **Step 3: Implement signed state and authorization URL**

Use jose SignJWT and jwtVerify with HS256, a 10-minute expiry, issuer rdk-webstore, and audience lightspeed-oauth. Use the exact sorted scope set in Step 1. Build:

~~~text
https://secure.retail.lightspeed.app/connect
~~~

with response_type=code, client_id, redirect_uri, state, and a space-delimited scope parameter.

The start route must:

1. call requireAdminApi;
2. resolve tenant with ensureTenantId;
3. sign tenantId, session user ID, and a random nonce;
4. store that nonce in a 10-minute `HttpOnly`, `Secure`, `SameSite=Lax` callback cookie;
5. return a 302 redirect to the authorization URL; and
6. never expose client_secret or token encryption material.

- [ ] **Step 4: Implement callback exchange and serialized refresh**

The callback requires an authenticated session for the same signed user, verifies that user still has admin access to the signed tenant, constant-time compares and clears the one-time nonce cookie, then posts form data to:

~~~text
https://{domain_prefix}.retail.lightspeed.app/api/1.0/token
~~~

Authorization-code request fields are code, client_id, client_secret, grant_type=authorization_code, and redirect_uri. Validate the response with Zod:

~~~ts
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  domain_prefix: z.string().trim().toLowerCase().min(1),
  scope: z.string(),
});
~~~

Encrypt both tokens before save. getValidAccessToken uses the current token until it is within 60 seconds of expiry. A refresh posts refresh_token, client_id, client_secret, and grant_type=refresh_token, then atomically stores both newly returned tokens using token_version. If another worker wins, reload the connection and use its token; never reuse the now-revoked refresh token.

Return the callback to /admin/settings/lightspeed?connected=1 without token query parameters.

Add tests for missing/mismatched nonce, a callback under a different user session, expired state, and successful one-time consumption. A replayed callback fails before token exchange.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/oauth.test.ts
npm run typecheck
npm run lint -- --quiet
~~~

Expected: OAuth tests pass; typecheck and lint exit 0.

~~~powershell
git add src/modules/lightspeed-sync app/api/admin/lightspeed/oauth tests/unit/modules/lightspeed-sync/oauth.test.ts
git commit -m "feat: connect Lightspeed with rotating OAuth tokens"
~~~

### Task 7: Build Strict 2026-10 Read Schemas, Client, and Normalizer

**Files:**

- Create: src/modules/lightspeed-sync/application/ports.ts
- Create: src/modules/lightspeed-sync/infrastructure/lightspeed/2026-10/schemas.ts
- Create: src/modules/lightspeed-sync/infrastructure/lightspeed/2026-10/client.ts
- Create: src/modules/lightspeed-sync/infrastructure/lightspeed/2026-10/normalizer.ts
- Create: tests/unit/modules/lightspeed-sync/lightspeed-read-adapter.test.ts
- Create: tests/fixtures/lightspeed/2026-10/product-family.json
- Create: tests/fixtures/lightspeed/2026-10/products-page.json
- Create: tests/fixtures/lightspeed/2026-10/inventory-page.json
- Create: tests/fixtures/lightspeed/2026-07/retailer.json
- Create: tests/fixtures/lightspeed/2026-07/reference-data.json

**Interfaces:**

- Consumes canonical types, mapping repository, and getValidAccessToken.
- Produces LightspeedReadGateway, LightspeedPage, RemoteFamilyBundle, RemoteReferenceData, and normalizeRemoteFamily.

- [ ] **Step 1: Save sanitized official fixtures and write failing adapter tests**

Use the released/sandbox response envelope, not handwritten partial objects, for the three fixture files. The family fixture must include classification, variant_attribute_ids, tag_ids, includes, products with codes/prices/active/version, null cost, and reordered product members.

~~~ts
import familyFixture from "../../../fixtures/lightspeed/2026-10/product-family.json";
import {
  lightspeedFamilyResponseSchema,
  normalizeRemoteFamily,
} from "@/modules/lightspeed-sync/infrastructure/lightspeed/2026-10";

describe("2026-10 Lightspeed read adapter", () => {
  it("validates the endpoint-specific family response", () => {
    expect(lightspeedFamilyResponseSchema.parse(familyFixture).data.classification).toBe(
      "VARIANT",
    );
  });

  it("maps codes, ordered Size values, cents, and one outlet", () => {
    const parsed = lightspeedFamilyResponseSchema.parse(familyFixture);
    const canonical = normalizeRemoteFamily(parsed, {
      connectionId: "connection-1",
      outletId: "outlet-1",
      sizeAttributeId: "attribute-size",
      mappings: {
        brand: { "brand-1": "jordan" },
        category: { "category-1": "sneakers" },
        conditionTag: { "tag-condition-new": "new" },
        modelTag: { "tag-model-aj1": "air-jordan-1" },
      },
      inventoryByProductId: new Map([
        ["product-10", { quantity: 2, version: 413 }],
      ]),
    });

    expect(canonical.variants[0]).toMatchObject({
      lightspeedProductId: "product-10",
      sku: "RDK-AJ1-BRED-10",
      sizeLabel: "10",
      salePriceCents: 18999,
      unitCostCents: null,
      inventory: { outletId: "outlet-1", quantity: 2, remoteVersion: 413 },
    });
  });

  it("rejects an unmapped category instead of guessing", () => {
    const parsed = lightspeedFamilyResponseSchema.parse(familyFixture);
    expect(() =>
      normalizeRemoteFamily(parsed, {
        connectionId: "connection-1",
        outletId: "outlet-1",
        sizeAttributeId: "attribute-size",
        mappings: {
          brand: { "brand-1": "jordan" },
          category: {},
          conditionTag: { "tag-condition-new": "new" },
          modelTag: { "tag-model-aj1": "air-jordan-1" },
        },
        inventoryByProductId: new Map(),
      }),
    ).toThrow("mapping_required:category:category-1");
  });
});
~~~

- [ ] **Step 2: Run the adapter test to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/lightspeed-read-adapter.test.ts
~~~

Expected: FAIL because the 2026-10 adapter does not exist.

- [ ] **Step 3: Define read ports and strict schemas**

~~~ts
// src/modules/lightspeed-sync/application/ports.ts
export interface LightspeedPage<T> {
  data: T[];
  version: { min: number | null; max: number | null };
}

export interface RemoteInventoryObservation {
  productId: string;
  outletId: string;
  quantity: number;
  version: number;
}

export interface LightspeedReadGateway {
  getReferenceData(input: {
    connectionId: string;
  }): Promise<RemoteReferenceData>;
  listProductsPage(input: {
    connectionId: string;
    after: number;
    pageSize: 200;
  }): Promise<LightspeedPage<RemoteProductSummary>>;
  getFamily(input: {
    connectionId: string;
    familyId: string;
  }): Promise<RemoteFamilyResponse>;
  getFamilyForProduct(input: {
    connectionId: string;
    productId: string;
  }): Promise<RemoteFamilyResponse>;
  getOutletInventory(input: {
    connectionId: string;
    outletId: string;
    productIds: string[];
  }): Promise<RemoteInventoryObservation[]>;
}
~~~

`RemoteReferenceData` contains retailer ID/currency, current OAuth user ID, active outlets, registers with outlet IDs, taxes, payment types, custom inventory-adjustment reasons with allowed sign, and channel IDs. Persist the validated retailer ID and uppercase currency on `lightspeed_connections.retailer_id` and `retailer_currency_code`. The settings UI may select only a register belonging to the designated outlet.

In schemas.ts, make request/query schemas strict and response schemas explicit for every consumed field. The family response must require data.id, name, classification, family_count, track_inventory, products, created_at, updated_at, and deleted_at; it must preserve null versus empty arrays. Each product requires id, family_id, active, prices, codes, version, and deleted_at. Choose a SKU from the unique CUSTOM code and assert that a returned sku, when present, normalizes to the same key.

Use `z.object(responseShape).passthrough()` only at response object boundaries so Lightspeed can add unconsumed response fields without breaking capture. Never use one all-optional DTO.

- [ ] **Step 4: Implement authenticated reads, cursor termination, and rate metadata**

The client base URL is:

~~~text
https://{domainPrefix}.retail.lightspeed.app/api
~~~

Every request sends Authorization: Bearer, Accept: application/json, and a stable RDK user agent. Use:

~~~text
GET /2026-10/products?after={cursor}&page_size=200&includes[]=families
GET /2026-10/products/{productId}/family?includes[]=brands,categories,tags,variant_attributes
GET /2026-10/product_families/{familyId}?includes[]=brands,categories,tags,variant_attributes
~~~

Parse X-RateLimit-Limit, X-RateLimit-Remaining, and Retry-After into response metadata. A page is terminal only when data is empty. Reject a non-empty page whose version.max is null or does not advance beyond after, preventing an infinite scan.

Inventory reads use the documented 2026-07 inventory endpoint until a 2026-10 inventory endpoint exists; the adapter still returns RemoteInventoryObservation. Filter to the configured outlet before normalization.

Reference discovery uses released endpoints and validates every consumed ID/name/currency/outlet relationship:

~~~text
GET /2026-07/retailer
GET /2026-07/user
GET /2026-04/outlets?after=0&page_size=200
GET /2026-01/registers?after=0&page_size=200
GET /2026-07/taxes?after=0&page_size=200
GET /2026-07/payment_types?after=0&page_size=200
GET /2026-04/custom_inventory_adjustment_reasons?after=0&page_size=100
~~~

Paginate reference collections to an empty page and exclude deleted/inactive entries. Product family includes supply brands, categories, tags, channels, and variant attributes needed for mapping; do not invent IDs from display labels.

- [ ] **Step 5: Verify fixtures, normalization, and type boundaries**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/lightspeed-read-adapter.test.ts
npm run typecheck
npm run lint -- --quiet
~~~

Expected: adapter tests pass, no type errors, and no lint errors.

- [ ] **Step 6: Commit**

~~~powershell
git add src/modules/lightspeed-sync/application/ports.ts src/modules/lightspeed-sync/infrastructure/lightspeed tests/unit/modules/lightspeed-sync/lightspeed-read-adapter.test.ts tests/fixtures/lightspeed/2026-10 tests/fixtures/lightspeed/2026-07
git commit -m "feat: add strict Lightspeed read adapter"
~~~

### Task 8: Configure, Verify, and Durably Capture Webhooks

**Files:**

- Create: src/modules/lightspeed-sync/infrastructure/lightspeed/webhook.ts
- Create: src/modules/lightspeed-sync/infrastructure/lightspeed/2026-07/webhookSubscriptions.ts
- Create: src/modules/lightspeed-sync/infrastructure/repositories/inboxRepository.ts
- Create: src/modules/lightspeed-sync/application/ingestWebhook.ts
- Create: src/modules/lightspeed-sync/application/ensureWebhookSubscriptions.ts
- Modify: src/modules/lightspeed-sync/application/connectLightspeed.ts
- Modify: app/api/admin/lightspeed/oauth/callback/route.ts
- Create: app/api/webhooks/lightspeed/[connectionKey]/[triggerType]/route.ts
- Create: tests/unit/modules/lightspeed-sync/webhook.test.ts
- Create: tests/unit/modules/lightspeed-sync/webhook-subscriptions.test.ts
- Create: tests/unit/modules/lightspeed-sync/webhook-route.test.ts
- Create: tests/fixtures/lightspeed/webhooks/product-update.form.txt
- Create: tests/fixtures/lightspeed/webhooks/inventory-update.form.txt
- Create: tests/fixtures/lightspeed/webhooks/sale-update.form.txt

**Interfaces:**

- Consumes LIGHTSPEED_CLIENT_SECRET for delivery signatures, LIGHTSPEED_WEBHOOK_ROUTE_SECRET for stable connection routing, NEXT_PUBLIC_SITE_URL, LightspeedConnectionRepository, and the 2026-07 Webhooks API.
- Produces connection-bound callback URLs, exact subscription reconciliation, verifyLightspeedSignature, parseLightspeedWebhook, ingestLightspeedWebhook, and a POST route that returns 204 only after PII-safe inbox persistence.

- [ ] **Step 1: Write failing HMAC, form, routing, and subscription tests**

~~~ts
import { createHmac } from "node:crypto";
import {
  buildWebhookConnectionKey,
  parseLightspeedWebhook,
  verifyLightspeedSignature,
} from "@/modules/lightspeed-sync/infrastructure/lightspeed/webhook";

const secret = "oauth-client-secret";
const routeSecret = "independent-webhook-route-secret-32";
const rawBody =
  "type=product.update&domain_prefix=retailer&payload=%7B%22id%22%3A%22product-10%22%2C%22retailer_id%22%3A%22retailer-1%22%2C%22version%22%3A5303657190%7D";
const digest = createHmac("sha256", secret).update(rawBody).digest("base64");
const signatureHeader = "signature=" + digest + ",algorithm=HMAC-SHA256";

describe("Lightspeed webhook verification", () => {
  it("verifies the exact raw form body with constant-time HMAC comparison", () => {
    expect(verifyLightspeedSignature(rawBody, signatureHeader, secret)).toBe(true);
  });

  it("rejects a body changed after signature creation", () => {
    expect(
      verifyLightspeedSignature(rawBody + "&changed=1", signatureHeader, secret),
    ).toBe(false);
  });

  it("keeps trigger type outside the API 1.0 entity payload", () => {
    expect(parseLightspeedWebhook(rawBody, "product.update")).toEqual({
      type: "product.update",
      domainPrefix: "retailer",
      retailerId: "retailer-1",
      resourceId: "product-10",
      resourceVersion: 5303657190,
      outletId: null,
    });
  });

  it("builds a tamper-evident connection route key", () => {
    const connectionId = crypto.randomUUID();
    expect(buildWebhookConnectionKey(connectionId, routeSecret)).toMatch(
      new RegExp("^" + connectionId + "\\.[A-Za-z0-9_-]+$"),
    );
  });
});

it("creates only the missing exact webhook subscription", async () => {
  const harness = webhookSubscriptionHarness({ existingTypes: ["product.update", "sale.update"] });
  await harness.ensure();
  expect(harness.postBodies).toEqual([{
    active: true,
    type: "inventory.update",
    url: expect.stringMatching(/\/inventory-update$/),
  }]);
});
~~~

- [ ] **Step 2: Run the tests to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/webhook.test.ts tests/unit/modules/lightspeed-sync/webhook-subscriptions.test.ts tests/unit/modules/lightspeed-sync/webhook-route.test.ts
~~~

Expected: FAIL because webhook verification, subscription reconciliation, ingestion, and route modules do not exist.

- [ ] **Step 3: Implement exact verification, connection routing, and trigger parsing**

Parse X-Signature into signature and algorithm. Accept only algorithm=HMAC-SHA256. Decode the supplied digest as base64 and compare equal-length buffers with timingSafeEqual. Reject an unsupported/missing route type, missing/duplicate payload field, invalid JSON, non-object payload, or missing id/product_id for the configured trigger type.

Supported capture types are:

~~~ts
export type LightspeedTriggerType =
  | "product.update"
  | "inventory.update"
  | "sale.update";
~~~

Map route slugs `product-update`, `inventory-update`, and `sale-update` to those types. Treat the route type as authoritative because optional delivery form fields such as `domain_prefix` are not guaranteed. If a separate `type` form field is present, require an exact match. The JSON inside `payload` is the API 1.0 entity and must not contain an invented trigger type.

Extract only:

| Type | Required sanitized fields |
|---|---|
| product.update | payload.id, optional payload.version/retailer_id |
| inventory.update | payload.product_id, payload.outlet_id, payload.version, optional payload.retailer_id |
| sale.update | payload.id, optional payload.version/retailer_id |

`buildWebhookConnectionKey` returns `{connectionId}.{base64url HMAC-SHA256("webhook-route:" + connectionId)}` using LIGHTSPEED_WEBHOOK_ROUTE_SECRET. Validate the MAC in constant time before loading the connection. This key routes a delivery; X-Signature with LIGHTSPEED_CLIENT_SECRET remains the authentication. Unknown route types return 404. Malformed or unsigned configured-type requests return 400/401 and are not inserted.

- [ ] **Step 4: Reconcile the three webhook subscriptions**

Implement strict 2026-07 schemas for:

~~~text
GET  /api/2026-07/webhooks
POST /api/2026-07/webhooks
PUT  /api/2026-07/webhooks/{webhookId}
~~~

The create/update JSON is exactly:

~~~json
{
  "active": true,
  "type": "product.update",
  "url": "https://configured-site.example/api/webhooks/lightspeed/{connectionKey}/product-update"
}
~~~

`ensureWebhookSubscriptions` lists existing subscriptions, keeps one exact active URL for each supported type, reactivates an exact inactive entry with PUT, and creates a missing entry with POST. It never deletes or rewrites an unrelated integration's webhook. Multiple active entries for one RDK type/URL enter `needs_attention` instead of guessing which to delete.

Reject a production `NEXT_PUBLIC_SITE_URL` that is not HTTPS, contains credentials/query/fragment, or points to localhost/private address space. Build callback URLs with the URL API, never string concatenation from request Host headers.

Call it after the OAuth callback has persisted tokens/reference retailer identity. Task 11 also calls it during the 15-minute reconciliation route so a removed/disabled subscription is surfaced and repaired. A subscription control-plane write is allowed in capture-only mode; it does not enable any catalog, inventory, sale, or refund mutation.

- [ ] **Step 5: Persist PII-safe evidence before acknowledging**

ingestLightspeedWebhook performs this order:

1. validate the connection route key and load that exact connection;
2. verify signature over request.text();
3. require `application/x-www-form-urlencoded`, then parse URLSearchParams and payload JSON;
4. require any delivered domain_prefix/retailer_id to match the stored connection;
5. calculate body_sha256 in memory and project only the sanitized fields above; and
6. insert inbox state=pending with selected headers and no raw body.

Use dedupe key `connection:type:resourceId:resourceVersion` when a version exists; otherwise use `connection:type:bodySha256`. The repository treats unique-key retries as success and returns the existing inbox ID. Store only content-type, x-signature algorithm, user-agent, and a provider-supplied request ID in request_headers; do not store Authorization, cookies, the signature digest, customer fields, payments, or raw body.

The route contains no after callback and no remote fetch:

~~~ts
export async function POST(
  request: Request,
  context: { params: Promise<{ connectionKey: string; triggerType: string }> },
): Promise<Response> {
  const params = await context.params;
  const rawBody = await request.text();
  const result = await ingestLightspeedWebhook({
    connectionKey: params.connectionKey,
    routeTriggerType: params.triggerType,
    rawBody,
    signatureHeader: request.headers.get("x-signature"),
    contentType: request.headers.get("content-type"),
    requestId: request.headers.get("x-request-id"),
  });
  return new Response(null, { status: result.status });
}
~~~

- [ ] **Step 6: Verify duplicate, privacy, subscription, and latency behavior; then commit**

Mock the inbox repository and assert duplicate delivery performs one durable logical insert, a persistence error returns 500, invalid HMAC returns 401, route/body mismatch returns 400, and successful persistence returns 204. Assert a realistic `sale.update` fixture containing customer/payment fields leaves none of those values in the insert. Use a fake clock to assert no read gateway method is called in the route.

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/webhook.test.ts tests/unit/modules/lightspeed-sync/webhook-subscriptions.test.ts tests/unit/modules/lightspeed-sync/webhook-route.test.ts
npm run typecheck
~~~

Expected: signature, form-shape, route-key, subscription, duplicate, privacy, and latency tests pass; typecheck exits 0.

~~~powershell
git add src/modules/lightspeed-sync app/api/admin/lightspeed/oauth/callback/route.ts app/api/webhooks/lightspeed tests/unit/modules/lightspeed-sync/webhook.test.ts tests/unit/modules/lightspeed-sync/webhook-subscriptions.test.ts tests/unit/modules/lightspeed-sync/webhook-route.test.ts tests/fixtures/lightspeed/webhooks
git commit -m "feat: configure and safely capture Lightspeed webhooks"
~~~

### Task 9: Process Inbox Events into Authoritative Capture Snapshots

**Files:**

- Create: src/modules/lightspeed-sync/application/processInbox.ts
- Create: src/modules/lightspeed-sync/application/retryPolicy.ts
- Create: src/modules/lightspeed-sync/infrastructure/repositories/auditRepository.ts
- Create: src/modules/lightspeed-sync/infrastructure/repositories/linkRepository.ts
- Modify: src/modules/lightspeed-sync/infrastructure/repositories/inboxRepository.ts
- Create: tests/unit/modules/lightspeed-sync/process-inbox.test.ts

**Interfaces:**

- Consumes LightspeedReadGateway, normalizer, mapping repository, connection repository, and inbox/audit repositories.
- Produces processInboxEvent(eventId) and processInboxBatch(limit, timeBudgetMs).

- [ ] **Step 1: Write failing authoritative-fetch and retry tests**

~~~ts
import { processInboxEvent } from "@/modules/lightspeed-sync/application/processInbox";

describe("processInboxEvent", () => {
  it("resolves a legacy product trigger through the 2026-10 family endpoint", async () => {
    const gateway = {
      getFamilyForProduct: vi.fn().mockResolvedValue(remoteFamilyFixture),
      getOutletInventory: vi.fn().mockResolvedValue(remoteInventoryFixture),
    };
    const inbox = createInboxHarness({
      triggerType: "product.update",
      resourceId: "product-10",
    });

    await processInboxEvent(inbox.event, createDependencies({ gateway, inbox }));

    expect(gateway.getFamilyForProduct).toHaveBeenCalledWith({
      connectionId: inbox.event.connection_id,
      productId: "product-10",
    });
    expect(inbox.markSucceeded).toHaveBeenCalledWith(
      inbox.event.id,
      expect.objectContaining({ lightspeedFamilyId: "family-1" }),
    );
  });

  it("uses Retry-After for a 429 without losing the inbox row", async () => {
    const inbox = createInboxHarness({ triggerType: "inventory.update" });
    const gateway = createGatewayThatRejects(
      new LightspeedHttpError(429, "rate limited", {
        retryAfter: new Date("2026-08-29T15:05:00Z"),
      }),
    );

    await processInboxEvent(inbox.event, createDependencies({ gateway, inbox }));

    expect(inbox.markRetryWait).toHaveBeenCalledWith(
      inbox.event.id,
      new Date("2026-08-29T15:05:00Z"),
      "rate_limited",
    );
  });

  it("does not create or update a website product in capture-only mode", async () => {
    const deps = createDependencies();
    await processInboxEvent(createInboxEvent(), deps);
    expect(deps.localCatalogWriter).toBeUndefined();
  });
});
~~~

- [ ] **Step 2: Run the test to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/process-inbox.test.ts
~~~

Expected: FAIL because processInbox.ts and its retry types do not exist.

- [ ] **Step 3: Implement the event resolver**

For product.update:

1. call GET /2026-10/products/{webhookProductId}/family with includes;
2. fetch designated-outlet inventory for every family product;
3. normalize the complete family;
4. store canonical result_snapshot and remote revision on the inbox row;
5. append a redacted audit success record.

For inventory.update, ignore events for a different outlet. For the configured outlet, resolve product to family and perform the same full fetch so family state and inventory are captured together. For sale.update, store the remote sale reference in audit but do not create a website order; inventory.update remains the stock signal.

If the target was deleted, a single 404 stores missing evidence and schedules reconciliation. It does not archive in capture-only mode.

- [ ] **Step 4: Implement the exact retry classifier**

~~~ts
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

export function classifySyncFailure(error: unknown, attempt: number, now: Date) {
  if (error instanceof LightspeedHttpError && error.status === 429) {
    return {
      state: "retry_wait" as const,
      nextAttemptAt: error.retryAfter ?? new Date(now.getTime() + RETRY_DELAYS_MS[0]),
      code: "rate_limited",
    };
  }
  if (
    error instanceof LightspeedHttpError &&
    [400, 403, 422].includes(error.status)
  ) {
    return {
      state: "needs_attention" as const,
      nextAttemptAt: null,
      code: error.status === 403 ? "missing_capability" : "invalid_contract",
    };
  }
  if (attempt > RETRY_DELAYS_MS.length) {
    return {
      state: "needs_attention" as const,
      nextAttemptAt: null,
      code: "retry_exhausted",
    };
  }
  return {
    state: "retry_wait" as const,
    nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[attempt - 1]),
    code: "transient_failure",
  };
}
~~~

On 401, refresh once through getValidAccessToken; a second 401 changes connection status to paused_auth and moves the event to needs_attention. On 409, refetch once. Error_message is safe operator text; raw sensitive response bodies stay out of it.

- [ ] **Step 5: Verify duplicate, reversed, deleted, and failure cases**

Add tests for duplicate inbox IDs, an older inventory version, product 404, 401 refresh success/failure, 409 refetch, 500 retry sequence, malformed response, and mapping_required. Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/process-inbox.test.ts
npm run typecheck
~~~

Expected: all inbox behavior tests pass and typecheck exits 0.

- [ ] **Step 6: Commit**

~~~powershell
git add src/modules/lightspeed-sync/application src/modules/lightspeed-sync/infrastructure/repositories tests/unit/modules/lightspeed-sync/process-inbox.test.ts
git commit -m "feat: process Lightspeed capture events"
~~~

### Task 10: Run Complete Dry-Run Reconciliation and Safe Link Proposals

**Files:**

- Create: src/modules/lightspeed-sync/application/runReconciliation.ts
- Create: src/modules/lightspeed-sync/domain/reconciliation.ts
- Create: src/modules/lightspeed-sync/infrastructure/repositories/scanRepository.ts
- Create: src/modules/lightspeed-sync/infrastructure/repositories/websiteCatalogReader.ts
- Create: tests/unit/modules/lightspeed-sync/reconciliation.test.ts
- Modify: src/modules/lightspeed-sync/index.ts

**Interfaces:**

- Consumes LightspeedReadGateway, WebsiteCatalogReader, ScanRepository, canonical normalizer, and normalizeSku.
- Produces runCompleteScan(connectionId), buildInitialLinkProposals(local, remote), and ScanOutcome.

- [ ] **Step 1: Write failing completeness and proposal tests**

~~~ts
import {
  buildInitialLinkProposals,
  runCompleteScan,
} from "@/modules/lightspeed-sync";

describe("Lightspeed reconciliation", () => {
  it("proposes only a unique exact normalized SKU match", () => {
    const proposals = buildInitialLinkProposals(
      [localVariant(" RDK-AJ1-10 ")],
      [remoteVariant("rdk-aj1-10")],
    );

    expect(proposals).toEqual([
      expect.objectContaining({
        category: "exact_unique_match",
        normalizedSku: "rdk-aj1-10",
        automaticAction: null,
      }),
    ]);
  });

  it("marks duplicate SKU candidates ambiguous", () => {
    const proposals = buildInitialLinkProposals(
      [localVariant("SKU-1"), localVariant("sku-1")],
      [remoteVariant("SKU-1")],
    );

    expect(proposals.every((proposal) => proposal.category === "ambiguous_sku")).toBe(
      true,
    );
  });

  it("keeps a partial scan diagnostic and inactive", async () => {
    const harness = createScanHarness({
      pages: [
        productPage(["product-1"], 20),
        new LightspeedHttpError(500, "page failed"),
      ],
    });

    const result = await runCompleteScan(harness.connectionId, harness.dependencies);

    expect(result.state).toBe("incomplete");
    expect(harness.scanRepository.activateRun).not.toHaveBeenCalled();
    expect(harness.scanRepository.recordArchiveProposal).not.toHaveBeenCalled();
  });
});
~~~

- [ ] **Step 2: Run the reconciliation test to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/reconciliation.test.ts
~~~

Expected: FAIL because reconciliation.ts and runReconciliation.ts do not exist.

- [ ] **Step 3: Implement bounded complete scanning**

Start cursor at 0. Call listProductsPage with pageSize 200 until an empty page. Persist cursor after each validated page. Collect unique family_id values, then hydrate families with concurrency 4. For every family, fetch all designated-outlet inventory and normalize it.

Use this bounded helper instead of Promise.all over the catalog:

~~~ts
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}
~~~

The scan completeness proof stores terminal empty cursor, product count, unique family count, hydrated family count, inventory product count, and zero failed hydration IDs. Only then may ScanRepository.activateRun run in one database transaction.

- [ ] **Step 4: Implement read-only proposal categories**

buildInitialLinkProposals returns:

~~~ts
export type ProposalCategory =
  | "exact_unique_match"
  | "ambiguous_sku"
  | "local_only"
  | "remote_only"
  | "structural_conflict"
  | "mapping_required";
~~~

An exact proposal requires one local and one remote normalized SKU, matching one-condition family structure, compatible size type/attribute, and no existing contradictory stable link. automaticAction is always null in Phase 1. A single matching member does not imply links for other family members.

For already linked families, calculate drift against managed fields only and store synchronized, repairable_drift, conflict, missing, or mapping_required. Do not enqueue outbox work or update local products.

- [ ] **Step 5: Verify page, collision, and non-destructive cases**

Add tests for cursor non-advance, empty terminal page, split family IDs across pages, hydration failure, other-outlet quantities, unavailable cost, remote-only/local-only families, case collisions, and missing linked family. Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/reconciliation.test.ts
npm run typecheck
~~~

Expected: reconciliation tests pass and typecheck exits 0.

- [ ] **Step 6: Commit**

~~~powershell
git add src/modules/lightspeed-sync tests/unit/modules/lightspeed-sync/reconciliation.test.ts
git commit -m "feat: add dry-run Lightspeed reconciliation"
~~~

### Task 11: Add Bounded Worker and Reconciliation Cron Routes

**Files:**

- Create: src/modules/lightspeed-sync/application/worker.ts
- Create: app/api/internal/lightspeed/worker/route.ts
- Create: app/api/internal/lightspeed/reconcile/route.ts
- Create: tests/unit/modules/lightspeed-sync/worker-routes.test.ts
- Create: vercel.json
- Modify: src/modules/lightspeed-sync/index.ts

**Interfaces:**

- Consumes claim_lightspeed_sync_inbox, processInboxBatch, runCompleteScan, and ensureWebhookSubscriptions.
- Produces runCaptureWorker({batchSize,timeBudgetMs}) and authenticated GET cron routes.

- [ ] **Step 1: Write failing route authentication and time-budget tests**

~~~ts
import { GET as runWorkerRoute } from "@/app/api/internal/lightspeed/worker/route";

describe("Lightspeed cron worker", () => {
  it("rejects a request without the configured bearer secret", async () => {
    const response = await runWorkerRoute(
      new Request("https://shop.example/api/internal/lightspeed/worker"),
    );
    expect(response.status).toBe(401);
  });

  it("claims another bounded batch while time remains", async () => {
    const harness = createWorkerHarness({ claimedBatchSizes: [20, 3, 0] });
    const result = await harness.runCaptureWorker({ batchSize: 20, timeBudgetMs: 45_000 });
    expect(result).toEqual({ claimed: 23, succeeded: 23, failed: 0 });
  });
});
~~~

- [ ] **Step 2: Run the worker test to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/worker-routes.test.ts
~~~

Expected: FAIL because the worker and cron routes do not exist.

- [ ] **Step 3: Implement bounded leases and route authentication**

Both GET routes require:

~~~ts
request.headers.get("authorization") === "Bearer " + env.CRON_SECRET
~~~

Return 503 when CRON_SECRET is unset, 401 when it does not match, and Cache-Control: no-store for every response. Use createSupabaseAdminClient only after authentication.

runCaptureWorker claims at most 20 rows with a 60-second lease, processes unrelated families with concurrency 4, and stops claiming when 45 seconds are consumed. An expired invocation leaves rows processing until lease recovery; it does not mark them successful.

The reconciliation route first lists/reconciles the three expected webhook subscriptions, then creates/runs a due scan only for connected capture-enabled connections. It refuses overlapping active scans for the same connection. A subscription ambiguity marks the connection needs_attention and does not delete anything.

- [ ] **Step 4: Register production schedules**

~~~json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/internal/lightspeed/worker",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/internal/lightspeed/reconcile",
      "schedule": "*/15 * * * *"
    }
  ]
}
~~~

Add a deployment readiness assertion documenting that minute schedules require Vercel Pro/Enterprise or an equivalent scheduler. Vercel Cron sends CRON_SECRET as Bearer authorization and does not retry failed invocations; durable leases provide recovery.

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/worker-routes.test.ts
npm run typecheck
npm run lint -- --quiet
~~~

Expected: worker tests pass; typecheck and lint exit 0.

~~~powershell
git add src/modules/lightspeed-sync/application/worker.ts src/modules/lightspeed-sync/index.ts app/api/internal/lightspeed tests/unit/modules/lightspeed-sync/worker-routes.test.ts vercel.json
git commit -m "feat: schedule durable Lightspeed capture workers"
~~~

### Task 12: Add Capture Settings and Reconciliation Evidence UI

**Files:**

- Create: app/admin/settings/lightspeed/page.tsx
- Create: app/api/admin/lightspeed/settings/route.ts
- Create: app/api/admin/lightspeed/status/route.ts
- Create: app/api/admin/lightspeed/reconciliation/route.ts
- Create: src/modules/lightspeed-sync/presentation/admin/LightspeedSettingsPageContent.tsx
- Create: src/modules/lightspeed-sync/presentation/admin/LightspeedConnectionCard.tsx
- Create: src/modules/lightspeed-sync/presentation/admin/LightspeedCaptureStatus.tsx
- Create: src/modules/lightspeed-sync/presentation/admin/LightspeedProposalTable.tsx
- Create: src/modules/lightspeed-sync/presentation/admin/lightspeedSettingsRequests.ts
- Create: tests/unit/modules/lightspeed-sync/admin-settings.test.tsx
- Modify: src/modules/shared/presentation/admin/shell/adminSidebarNavigation.ts

**Interfaces:**

- Consumes connection, mapping, scan, inbox, and audit repositories through application query services.
- Produces admin-only settings/status APIs and a capture-only settings page.

- [ ] **Step 1: Write failing route and page tests**

~~~tsx
import { render, screen } from "@testing-library/react";
import { LightspeedSettingsPageContent } from "@/modules/lightspeed-sync/presentation/admin/LightspeedSettingsPageContent";

describe("Lightspeed capture settings", () => {
  it("shows every mutation switch locked off during Phase 1", async () => {
    render(
      <LightspeedSettingsPageContent
        initialState={captureSettingsFixture({
          connected: true,
          captureEnabled: true,
        })}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Inbound apply" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Outbound catalog" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Inventory adjustments" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Sales and refunds" })).toBeDisabled();
  });

  it("labels exact SKU matches as proposals with no automatic action", () => {
    render(
      <LightspeedSettingsPageContent
        initialState={captureSettingsFixture({
          proposals: [exactSkuProposalFixture()],
        })}
      />,
    );
    expect(screen.getByText("Exact unique match")).toBeInTheDocument();
    expect(screen.getByText("Review required")).toBeInTheDocument();
  });
});
~~~

- [ ] **Step 2: Run the UI test to verify RED**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/admin-settings.test.tsx
~~~

Expected: FAIL because the settings presentation does not exist.

- [ ] **Step 3: Implement thin authenticated APIs**

Every route calls requireAdminApi, createSupabaseServerClient for tenant resolution, then a lightspeed-sync application service with the service-role repository scoped to that tenant.

GET settings returns redacted connection data, outlet/register choices, mappings, inbound template, granted scopes, and switches. PATCH accepts only:

~~~ts
const captureSettingsSchema = z.object({
  outletId: z.string().min(1),
  registerId: z.string().min(1).nullable(),
  sourceAuthorId: z.string().min(1).nullable(),
  sizeAttributeId: z.string().min(1),
  captureEnabled: z.boolean(),
  inboundTemplate: z.object({
    shippingPriceCents: z.number().int().nonnegative().nullable(),
    publishMode: z.literal("immediate_when_valid"),
    defaultTags: z.array(z.string().min(1)),
  }),
  mappingUpserts: z.array(z.object({
    kind: z.enum([
      "brand",
      "category",
      "condition_tag",
      "inventory_adjustment_reason",
      "model_tag",
      "payment_type",
      "shipping_product",
      "tax",
      "variant_attribute",
    ]),
    localKey: z.string().min(1),
    remoteId: z.string().min(1),
    remoteLabel: z.string().min(1),
  }).strict()).max(500),
}).strict();
~~~

The service validates every submitted remote ID against current reference data or a complete scan snapshot before upsert; it never accepts a typed display label as identity. For `inventory_adjustment_reason`, `remoteId` is either a discovered custom-reason UUID or one validated token `builtin:DAMAGE`, `builtin:EXPIRY`, `builtin:INTERNAL_USE`, `builtin:THEFT`, `builtin:DONATION`, `builtin:STOCK_FOUND`, or `builtin:SAMPLE_FOR_SALE`; the service also stores/validates the allowed sign. Mapping upserts are audited with admin, kind, local key, old/new remote IDs, and timestamp. The API always returns all four mutation switches false in Phase 1 and rejects any unknown switch field. POST reconciliation creates a pending dry-run record; it does not run the full scan in the request.

- [ ] **Step 4: Implement the settings page**

The page includes Connect/Reconnect, capture enabled, designated outlet, register/source author, Size attribute, inbound defaults, editable explicit mapping rows, required mapping counts, webhook/inbox health, last complete scan, and proposal categories. It never renders encrypted tokens, raw webhook bodies, customer data, or payment references.

Add Lightspeed under the existing Settings sidebar group. Keep app/admin/settings/lightspeed/page.tsx thin:

~~~tsx
import { LightspeedSettingsPageContent } from "@/modules/lightspeed-sync/presentation/admin/LightspeedSettingsPageContent";

export default function LightspeedSettingsPage() {
  return <LightspeedSettingsPageContent />;
}
~~~

- [ ] **Step 5: Verify and commit**

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/admin-settings.test.tsx
npm run typecheck
npm run lint -- --quiet
~~~

Expected: settings tests pass; typecheck and lint exit 0.

~~~powershell
git add app/admin/settings/lightspeed app/api/admin/lightspeed src/modules/lightspeed-sync/presentation src/modules/shared/presentation/admin/shell/adminSidebarNavigation.ts tests/unit/modules/lightspeed-sync/admin-settings.test.tsx
git commit -m "feat: add Lightspeed capture dashboard"
~~~

### Task 13: Prove the 2026-10 Contract Gate and Run Capture-Only for 24 Hours

**Files:**

- Create: tests/integration/lightspeed-2026-10-contract.test.ts
- Create: tests/integration/lightspeed-webhook-contract.test.ts
- Create: src/modules/lightspeed-sync/application/recordRolloutGate.ts
- Create: src/modules/lightspeed-sync/infrastructure/repositories/rolloutGateRepository.ts
- Create: tests/unit/modules/lightspeed-sync/rollout-gate.test.ts
- Create: docs/runbooks/LIGHTSPEED_CAPTURE.md
- Modify: package.json
- Modify: docs/RUNBOOK.md

**Interfaces:**

- Consumes a dedicated Lightspeed sandbox/test retailer connection.
- Produces sanitized fixtures that replace Task 7's provisional fixtures and an operator checklist with objective pass/fail evidence.

- [ ] **Step 1: Add opt-in live contract tests**

~~~ts
const enabled = process.env.LIGHTSPEED_CONTRACT_TESTS === "1";
const describeContract = enabled ? describe : describe.skip;

describeContract("Lightspeed 2026-10 released contract", () => {
  it("reads a family and validates every consumed field", async () => {
    const gateway = createContractGatewayFromEnvironment();
    const family = await gateway.getFamily({
      connectionId: requiredEnv("LIGHTSPEED_CONTRACT_CONNECTION_ID"),
      familyId: requiredEnv("LIGHTSPEED_CONTRACT_FAMILY_ID"),
    });
    expect(family.data.products.length).toBeGreaterThan(0);
  });

  it("paginates until an empty page with an advancing version cursor", async () => {
    const gateway = createContractGatewayFromEnvironment();
    const first = await gateway.listProductsPage({
      connectionId: requiredEnv("LIGHTSPEED_CONTRACT_CONNECTION_ID"),
      after: 0,
      pageSize: 200,
    });
    expect(first.version.max).not.toBeNull();
  });
});

describeContract("Lightspeed 2026-07 webhook contract", () => {
  it("lists and strictly validates the three configured subscription shapes", async () => {
    const subscriptions = await createContractGatewayFromEnvironment().listWebhooks();
    expect(
      subscriptions.filter((item) => item.url.includes("/api/webhooks/lightspeed/"))
        .map((item) => item.type)
        .sort(),
    ).toEqual(["inventory.update", "product.update", "sale.update"]);
  });
});
~~~

Add:

~~~json
{
  "scripts": {
    "test:lightspeed:contract": "vitest run tests/integration/lightspeed-2026-10-contract.test.ts tests/integration/lightspeed-webhook-contract.test.ts"
  }
}
~~~

Merge this script into the existing scripts object; do not replace other scripts.

- [ ] **Step 2: Run local verification**

Run:

~~~powershell
npm run test:unit
npm run typecheck
npm run lint
npm run build
npx supabase db lint --local
~~~

Expected: all commands exit 0. Contract tests remain skipped unless LIGHTSPEED_CONTRACT_TESTS=1.

- [ ] **Step 3: Run the live read-only contract suite**

Run with sandbox credentials:

~~~powershell
$env:LIGHTSPEED_CONTRACT_TESTS='1'
npm run test:lightspeed:contract
Remove-Item Env:LIGHTSPEED_CONTRACT_TESTS
~~~

Expected: all contract tests pass. Save sanitized response fixtures with IDs, domains, tokens, customer data, and payment references replaced. Run the unit adapter tests again against those fixtures.

- [ ] **Step 4: Write and execute the capture runbook**

LIGHTSPEED_CAPTURE.md must require:

| Checkpoint | Pass condition |
|---|---|
| OAuth/scopes | Connected; exact granted scope set recorded; tokens refresh once with rotation |
| Webhooks | Exactly three expected active callback URLs; valid signatures accepted under five seconds; invalid signatures rejected; duplicates deduplicated; raw sale/customer data absent from storage |
| Scans | At least 96 complete 15-minute scans in 24 hours; zero activated incomplete scans |
| Data conversion | Twenty designated products normalize without guessed mappings or cent drift |
| Safety | All four business mutation switches remain false; zero catalog/inventory/sale/refund mutation actions; only audited webhook-subscription control-plane writes allowed |

Document stop conditions: repeated 401, incomplete scans for 30 minutes, rate-limit exhaustion, signature failures over 1 percent, any attempted mutation, or an unexplained managed-field conversion.

- [ ] **Step 5: Record immutable rollout-gate evidence**

After the released contract suite passes, call `recordRolloutGate` for `products_2026_10_contract` with the sanitized fixture-set SHA-256, API version, test commit, run timestamp, and approving admin. After the complete 24-hour evidence table passes, record `capture_24h` with the runbook evidence SHA-256. The application service rejects a passed gate without a nonempty evidence hash and audit row; only service-role persistence may update gate rows.

Run:

~~~powershell
npx vitest run tests/unit/modules/lightspeed-sync/rollout-gate.test.ts
~~~

Expected: missing evidence/admin/contract assertions fail closed; valid evidence creates one audited gate row.

- [ ] **Step 6: Commit the verified gate and runbook**

~~~powershell
git add tests/integration/lightspeed-2026-10-contract.test.ts tests/integration/lightspeed-webhook-contract.test.ts tests/fixtures/lightspeed src/modules/lightspeed-sync/application/recordRolloutGate.ts src/modules/lightspeed-sync/infrastructure/repositories/rolloutGateRepository.ts tests/unit/modules/lightspeed-sync/rollout-gate.test.ts package.json docs/runbooks/LIGHTSPEED_CAPTURE.md docs/RUNBOOK.md
git commit -m "test: gate Lightspeed sync on capture contract"
~~~

Do not begin plan 2 until the 24-hour evidence table passes and the user approves proceeding.
