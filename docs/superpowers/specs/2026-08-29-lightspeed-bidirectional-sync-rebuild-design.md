# Lightspeed Bidirectional Inventory Sync Rebuild

| Metadata | Value |
|---|---|
| Date | 2026-08-29 |
| Status | Approved design; implementation not started |
| Target | Lightspeed Retail X-Series Product API 2026-10, with production activation gated on the released contract |

## 1. Executive decision

Replace the removed synchronization implementation with a clean integration boundary built around:

1. a canonical product-family model;
2. durable inbound and outbound work queues;
3. stable Lightspeed identifiers rather than SKU-based ongoing identity;
4. explicit field ownership and revision-aware conflict handling; and
5. complete, non-destructive reconciliation before any write is allowed.

The website and one configured Lightspeed e-commerce outlet must converge on the same sellable variants and quantities. “Matching 1:1” means the fields intentionally shared by both systems match exactly. Website-only publishing, merchandising, and SEO data remain local and are not treated as drift.

A paid website order creates a real Lightspeed sale. That sale is the single remote mechanism that decrements inventory. The integration must never create the sale and also issue a second stock adjustment for the same purchase.

## 2. Why this replaces the old design

This document supersedes the synchronization behavior described in:

- 2026-06-05-lightspeed-two-way-sync-design.md;
- 2026-06-10-lightspeed-reconciliation-and-full-sync-design.md;
- 2026-06-12-website-to-lightspeed-family-sync-design.md; and
- 2026-06-17-lightspeed-category-override-reconciliation-design.md.

Those documents remain useful historical context, but their last-write-wins rules, synchronous rollback, hard-delete behavior, direct absolute-stock assumptions, and API-era payloads are not implementation requirements.

The active branch contains no live Lightspeed integration: commit 0b14e6e removed the routes, services, tests, scripts, and related tables. Commit 0e9f4b1 is the final pre-removal reference inspected during this audit. Historical code may explain prior behavior, but it is not the rebuild baseline.

## 3. Audit conclusions

The prior code did not fail because of one conversion bug. It lacked a stable contract between two materially different domain models.

| Area | Observed failure | Required correction |
|---|---|---|
| Remote DTOs | One large optional object mixed API 1.0 webhook data, several REST versions, CSV rows, and internal fields | Use strict endpoint-specific wire schemas and convert immediately to canonical types |
| Identity | SKU was used as both bootstrap identity and permanent identity; family creation also relied on response ordering | Store product-family and product IDs; use normalized SKU only for approved initial linking |
| Product create | The implementation expected an extra family ID and could shift parent/variant mappings | Use the returned family ID, refetch, and match generated product IDs by unique code plus ordered attributes |
| Product edit | Price/cost changes, variant addition/removal, and collection-replacement semantics were incomplete | Issue endpoint-specific family and product patches and preserve unmanaged collections |
| Delete | Remote family deletion was incomplete and irreversible behavior was not modeled | Archive products on both sides and retain a tombstone |
| Inventory | Outlet quantities were sometimes summed and sometimes overwritten; zero and failed fetches were conflated | Track one configured outlet, distinguish unknown from zero, and consume versioned inventory events |
| Reconciliation | Partial pages and failed hydration could appear to be missing products; unsynchronized fields caused false positives | Stage a complete scan, compare only managed fields, and never archive from incomplete evidence |
| Delivery | Webhook work ran after the response without durable ownership; polling recovery was absent | Verify the exact body, persist a PII-safe trigger envelope before acknowledging, and run scheduled recovery polling |
| Webhook privacy | `sale.update` can contain the API 1.0 sale/customer object; storing the raw body would retain customer and payment data that processing does not need | Store the body SHA-256 plus only type, resource ID/version, outlet, and retailer identifiers; fetch authoritative data by ID |
| Checkout transaction | The current paid-order RPC can transition an order to paid even when only a subset of variant decrements succeeded; reconciliation can then fall back to marking paid without decrementing anything | Lock/aggregate variants, require the affected-row count to match exactly, roll back local order/inventory/outbox on mismatch, and leave an externally captured payment in processing/alerted state rather than bypass inventory |
| Refund transaction | The current refund route performs payment, order, item, and restock writes sequentially and treats some failures as nonfatal | Record one immutable refund ledger and its outbox intent through one idempotent database transaction |
| Remote transactions | Local rollback attempted to compensate for remote success; checkout could fail after a captured payment | Use local transactions plus an outbox; remote work is asynchronous and idempotent |
| Data loss | Category/model were guessed, tags/images were rebuilt destructively, and cost could silently become zero | Preserve unknowns, use explicit mappings, and make capability-gated fields nullable |

## 4. Goals and non-goals

### Goals

1. Create, edit, archive, inventory, sale, refund, and reconciliation paths are explicit and testable.
2. Normal changes converge within 60 seconds; missed webhook delivery converges within 15 minutes.
3. Duplicate, delayed, and reversed events do not corrupt state.
4. Every write is traceable from local intent through remote result.
5. Operators can stop individual write categories without disabling observation.

### Non-goals

1. Mirroring every Lightspeed field into the website.
2. Treating SKU as a permanent cross-system primary key.
3. Supporting mixed conditions inside one Lightspeed family.
4. Hard-deleting synchronized products during normal operation.
5. Enabling production writes before the Lightspeed 2026-10 contract gate passes.

## 5. Confirmed business rules

| Decision | Rule |
|---|---|
| Inventory scope | Website available stock equals the quantity at one configured Lightspeed e-commerce outlet |
| Sales | A paid website order creates a Lightspeed sale; the sale owns its stock decrement |
| Family condition | Every product in a Lightspeed family has one condition; mixed-condition input is rejected or split deliberately |
| Ordinary edits | Either side may initiate an ordinary edit |
| Concurrent conflict | The field ownership matrix decides only when both sides changed the same managed value from the same base |
| Equality | Managed shared fields must match; local-only fields are excluded from drift |
| Removal | Archive both representations and retain identity/tombstone records |
| Initial link | Dry-run proposals require unique exact normalized SKU matches and human approval before writes |

## 6. External API constraints

The implementation must encode these Lightspeed constraints rather than relying on developer memory:

1. Product webhooks are form-encoded API 1.0 trigger payloads, not authoritative product snapshots. The entity JSON is inside the form field named `payload`; trigger type and retailer/domain data, when delivered, are separate form fields rather than members invented inside that entity. OAuth application deliveries use X-Signature with HMAC-SHA256 over the exact request body and the application client_secret. Because `domain_prefix` is not guaranteed, each configured subscription uses a connection-bound callback route. The receiver has roughly five seconds to acknowledge, delivery is not guaranteed, and recovery polling is required. See [Webhooks](https://x-series-api.lightspeedhq.com/v2026.04/docs/webhooks), [example payloads](https://x-series-api.lightspeedhq.com/docs/webhooks_example_payloads), and the [2026-07 webhook API](https://x-series-api.lightspeedhq.com/reference/get-webhooks).
2. The 2026-10 product model makes product families explicit and separates family and product mutations. Creation, family updates, product updates, adding products, and irreversible deletes have different contracts. See the [2026-10 migration guide](https://x-series-api.lightspeedhq.com/v1.0/docs/2026_10_products_migration_guide) and [updating variant families](https://x-series-api.lightspeedhq.com/v1.0/docs/product_families_updating_variant_families).
3. Stock adjustments are delta operations scoped to an outlet and product. They are not an absolute inventory setter, and versioned inventory updates must be applied in order. See [Create stock adjustments](https://x-series-api.lightspeedhq.com/reference/createstockadjustments) and [Inventory updates](https://x-series-api.lightspeedhq.com/v1.0/docs/inventory_updates).
4. Sale creation generates the Lightspeed sale ID. The request can carry the website identity in `source.id` and `source.type`; recovery after an ambiguous create uses a deterministic, searchable `invoice_number`, then stores the generated Lightspeed ID. See [Create a sale](https://x-series-api.lightspeedhq.com/reference/createsale) and [Search](https://x-series-api.lightspeedhq.com/reference/search-1).
5. Public product scopes may not expose cost. Cost synchronization is therefore capability-gated, nullable, and never defaulted to zero. See [Scopes](https://x-series-api.lightspeedhq.com/v2026.04/docs/scopes).

The migration guide describes monetary wire values as quoted decimal strings, while another 2026-10 update example uses numeric values. Internally all money is integer cents. The adapter's exact wire encoding remains provisional until recorded requests against the released API pass contract tests.

## 7. Architecture

### 7.1 Components

| Component | Responsibility |
|---|---|
| Website domain | Own local product editing, checkout, publishing, and local-only metadata |
| Sync intent service | Validate a local change, update local state, and append an outbox event in one transaction |
| Outbox worker | Serialize work per family, call Lightspeed, refetch authoritative state, and update links/revisions |
| Webhook receiver | Verify authenticity, store a body hash plus minimal sanitized trigger identity in the inbox, and acknowledge without doing remote work |
| Inbox worker | Deduplicate triggers, fetch authoritative remote data, normalize it, and apply a canonical change |
| Lightspeed adapters | Validate endpoint-specific requests/responses and isolate API version details |
| Canonical comparator | Compare only managed fields, calculate conflicts, and generate explicit operations |
| Reconciler | Stage complete remote/local snapshots, propose links, and repair drift safely |
| Sync ledger | Store identities, observed versions, operation keys, tombstones, conflicts, and audit results |

### 7.2 Local-to-Lightspeed flow

1. A local transaction writes the website change and a canonical outbox intent.
2. The worker claims the event and the family serialization lock.
3. It loads current local state, the identity link, and the latest known remote base.
4. It computes endpoint-specific operations, sends each with a deterministic idempotency key where supported, and refetches the authoritative family.
5. It records the remote IDs/version, updates the canonical snapshot, marks success, and exposes “synchronized.”

The website transaction never waits for Lightspeed. A failed remote request leaves a retryable intent, not a rolled-back customer action.

### 7.3 Lightspeed-to-local flow

1. The receiver verifies the exact raw request in memory, stores its SHA-256 plus sanitized trigger identifiers and selected headers, and returns success within five seconds.
2. The inbox worker extracts the trigger resource ID and event type; it does not trust the trigger as full state.
3. It fetches the complete 2026-10 product family and designated-outlet inventory.
4. It converts those responses into the canonical model and compares them to the last common snapshot.
5. It applies non-conflicting changes, records conflicts, and advances the observed remote revision.

### 7.4 Sales flow

1. Checkout completes local payment and atomically commits the website order, every required local stock decrement, and a Lightspeed-sale outbox intent; any missing/insufficient variant row aborts the entire transaction.
2. Before the first request, the sale worker stores a deterministic external source ID and searchable invoice number for the website order.
3. It creates the Lightspeed sale and stores the generated `data.id` plus generated line IDs.
4. Lightspeed's sale decrements inventory at the configured register/outlet.
5. The resulting inventory event or recovery poll updates the website quantity.
6. A timeout after the request may have been sent is resolved by invoice search plus exact source/line/total verification; absence from an eventually consistent search is not proof of non-creation and never authorizes an automatic second POST.

## 8. Canonical model

The canonical model is the only shape used by conflict detection, reconciliation, and policy. Wire payloads never leak beyond their adapter.

~~~json
{
  "family": {
    "sync_family_id": "sf_01...",
    "website_product_id": "wp_01...",
    "lightspeed_family_id": "uuid-or-null",
    "name": "Air Jordan 1 Retro High OG",
    "description": "Canonical plain or sanitized rich text",
    "brand": {
      "website_brand_id": "brand_01...",
      "lightspeed_brand_id": "uuid-or-null",
      "name": "Jordan"
    },
    "model": {
      "website_model_id": "model_01...",
      "name": "Air Jordan 1"
    },
    "category": {
      "website_category": "sneakers",
      "lightspeed_category_id": "uuid-or-null"
    },
    "condition": "new",
    "images": [
      {
        "sync_image_key": "sha256-or-remote-id",
        "url": "https://...",
        "position": 0
      }
    ],
    "managed_tags": ["rdk:condition:new", "rdk:model:air-jordan-1"],
    "archived": false
  },
  "variants": [
    {
      "sync_variant_id": "sv_01...",
      "website_variant_id": "wv_01...",
      "lightspeed_product_id": "uuid-or-null",
      "sku": "RDK-AJ1-BRED-10",
      "size": {
        "type": "shoe",
        "label": "10",
        "attribute_name": "Size"
      },
      "sale_price_cents": 18999,
      "unit_cost_cents": null,
      "active": true,
      "inventory": {
        "outlet_id": "configured-outlet-uuid",
        "quantity": 1,
        "remote_version": 412
      }
    }
  ],
  "sync": {
    "local_revision": 27,
    "remote_revision": "etag-version-or-observed-token",
    "base_snapshot_hash": "sha256...",
    "tombstoned_at": null
  }
}
~~~

### 8.1 Representation rules

| Type | Internal rule | Wire rule |
|---|---|---|
| Money | Integer cents; null means unknown/unavailable | Adapter emits the released API's validated decimal representation |
| Quantity | Integer for the designated outlet only | Stock adjustment sends a signed decimal quantity string if required |
| IDs | Opaque strings; never parse semantic meaning | Use endpoint-specific UUID fields |
| Time | UTC instant with original event metadata retained | RFC 3339 at adapter boundary |
| Empty value | Null, empty string, zero, and missing are distinct | Omit only when endpoint semantics require omission |
| SKU | Unicode-trimmed, case-folded comparison key plus preserved display value | Send preserved display value |
| Tags | RDK-managed namespace merged with unmanaged remote tags | Replacement lists include preserved unmanaged values |
| Images | Stable image key and explicit position | Never erase because an image fetch failed |

Category and model mapping must be explicit, persisted, and reversible. Unknown remote values produce a mapping-required state; they are never guessed from product names. A failed or unauthorized cost read produces null and exclusion from comparison, never zero.

Snapshot equality/hashing uses deterministic canonical JSON: object keys are sorted; set-semantics fields such as managed tags are sorted; linked variants are ordered by stable sync identity (normalized SKU only before linking); and images are ordered by explicit position/key because their order is meaningful. Raw database row order, API response order, locale formatting, and wire DTOs never enter a base hash. This removes formatting-only false drift.

## 9. Field ownership and conflict resolution

Ownership does not prevent an ordinary edit from either system. It resolves a true concurrent conflict.

| Managed field | Concurrent-conflict authority | Notes |
|---|---|---|
| Family name and description | Website | Remote-only edits still flow inward |
| Brand, model, category, condition | Website | Requires an explicit mapping; mixed condition is invalid |
| Managed images | Website | Unmanaged remote image data is preserved when possible |
| SKU, size/variant attribute, price, active | Lightspeed | Website-only edits still flow outward |
| Unit cost | Lightspeed, capability-gated | Excluded when scope or endpoint cannot provide it |
| Designated-outlet quantity | Lightspeed | Website sales affect it through a Lightspeed sale |
| Archive/tombstone | Archive wins | Re-creation requires an explicit operator action |
| Local publishing, SEO, go-live, excluded tags | Website only | Never sent or compared |

### 9.1 Three-way merge

For each managed field, the comparator uses:

- B: value in the last acknowledged common snapshot;
- L: current normalized website value; and
- R: current normalized Lightspeed value.

The decision table is:

| Condition | Result |
|---|---|
| L equals B and R differs from B | Accept R and apply it locally |
| R equals B and L differs from B | Accept L and send it remotely |
| L equals R | Advance the common snapshot without a conflict |
| L and R both differ from B and from each other | Apply the field's authority and record a conflict resolution |
| Either side is tombstoned | Archive both sides; do not resurrect automatically |
| Required value is unknown because a fetch/mapping failed | Stop that family in needs_attention; do not synthesize a default |

Conflicts are field-level, not whole-product last-write-wins. The resolution record stores B, L, R, the selected value, authority rule, triggering event IDs, and timestamps. A manual override creates a new explicit intent; it does not rewrite audit history.

## 10. Persistent integration state

Names are conceptual and may be adapted to the project's database conventions. The invariants are mandatory.

### 10.1 Identity tables

**sync_family_links**

| Column | Requirement |
|---|---|
| sync_family_id | Stable internal primary key |
| website_product_id | Unique when not null |
| lightspeed_family_id | Unique when not null |
| state | proposed, linked, archived, needs_attention |
| last_common_snapshot | Canonical managed family JSON |
| local_revision / remote_revision | Last acknowledged revisions |
| tombstoned_at | Retained on normal archive |

**sync_variant_links**

| Column | Requirement |
|---|---|
| sync_variant_id | Stable internal primary key |
| sync_family_id | Required parent |
| website_variant_id | Unique when not null |
| lightspeed_product_id | Unique when not null |
| normalized_sku | Indexed bootstrap/review aid, not identity |
| last_common_snapshot | Canonical managed variant JSON |
| tombstoned_at | Retained on archive |

**sync_image_links**

| Column | Requirement |
|---|---|
| sync_family_id | Required parent |
| local_image_key | Stable normalized content/URL hash, unique within family |
| lightspeed_image_id | Generated/adopted remote ID, unique within connection |
| management_origin | website_created, remote_created after linking, or explicitly initial_adopted |
| state / tombstoned_at | Retains image ownership after removal |

Database constraints must prevent two website records from linking to one remote ID and prevent one website record from holding multiple active remote links. Image deletion may target only an ID present in the managed image-link table; URL similarity alone is never delete authority. Null behavior must be handled with partial unique indexes or an equivalent database-specific constraint.

### 10.2 Delivery tables

| Table | Required contents |
|---|---|
| sync_outbox | Event ID, aggregate ID, intent type, canonical payload, local revision, operation key, state, attempts, next attempt, error class |
| sync_inbox | Delivery/dedupe key, body SHA-256, sanitized trigger identifiers, selected headers, received time, state, attempts |
| sync_operations | Deterministic operation key, endpoint/action, request fingerprint, remote result/reference, terminal state |
| sync_conflicts | Field path, B/L/R values, authority, resolution, related events, resolved time |
| sync_scan_runs | Cursor/checkpoint, expected/completed counts, completeness proof, staged result, activation status |
| sync_audit_log | Redacted request/response metadata, actor, timing, correlation IDs, result |

Inbox deduplication must include retailer/connection identity plus Lightspeed delivery identity when available. A raw-body hash is a fallback, not the only tenant-independent key.

## 11. Integration event envelope

Every outbox event uses a versioned envelope:

~~~json
{
  "event_id": "evt_01...",
  "event_type": "catalog.family.created",
  "schema_version": 1,
  "occurred_at": "2026-08-29T15:04:05Z",
  "connection_id": "ls_conn_01...",
  "sync_family_id": "sf_01...",
  "local_revision": 27,
  "base_snapshot_hash": "sha256...",
  "correlation_id": "corr_01...",
  "payload": {}
}
~~~

The payload contains canonical intent, not a copied REST request. The worker builds the request from current state, the last common snapshot, and the adapter version in use. This prevents a queued event from replaying a stale wire format after a safe adapter migration.

## 12. Action contracts and JSON transformations

All JSON below is a contract illustration for the target API version. The released 2026-10 OpenAPI/schema and recorded sandbox responses are authoritative. The production gate fails if property names, required fields, types, collection semantics, or response shapes differ.

### 12.1 Website creates a product family

The website command is validated and stored first:

~~~json
{
  "name": "Air Jordan 1 Retro High OG",
  "brand_override_id": "brand_jordan",
  "model_override_id": "model_aj1",
  "category": "sneakers",
  "condition": "new",
  "description": "Black and red high-top sneaker.",
  "shipping_price_cents": 1500,
  "go_live_at": "2026-09-01T14:00:00Z",
  "tags": ["featured"],
  "variants": [
    {
      "id": "wv_10",
      "sku": "RDK-AJ1-BRED-10",
      "size": "10",
      "sale_price_cents": 18999,
      "stock": 1,
      "unit_cost_cents": 12000,
      "sort_order": 0
    }
  ],
  "images": [
    {
      "url": "https://cdn.example.com/aj1-bred-front.jpg",
      "position": 0
    }
  ]
}
~~~

The local transaction emits canonical intent. Website-only fields such as shipping price, go-live time, and merchandising tags are intentionally absent:

~~~json
{
  "event_type": "catalog.family.created",
  "payload": {
    "family": {
      "name": "Air Jordan 1 Retro High OG",
      "description": "Black and red high-top sneaker.",
      "brand_name": "Jordan",
      "category_mapping_key": "sneakers",
      "condition": "new",
      "images": [
        {
          "url": "https://cdn.example.com/aj1-bred-front.jpg",
          "position": 0
        }
      ]
    },
    "variants": [
      {
        "sync_variant_id": "sv_10",
        "sku": "RDK-AJ1-BRED-10",
        "attribute_name": "Size",
        "attribute_value": "10",
        "sale_price_cents": 18999,
        "initial_quantity": 1
      }
    ]
  }
}
~~~

The locally supplied unit cost is also retained locally unless the authenticated Lightspeed contract explicitly allows cost writes and reads. Without that capability, cost is outside the shared comparison contract rather than silently emitted, overwritten, or changed to zero.

The adapter resolves the Lightspeed Size variant-attribute ID and the IDs of the managed Lightspeed tags, then builds a family request similar to:

~~~json
{
  "name": "Air Jordan 1 Retro High OG",
  "description": "Black and red high-top sneaker.",
  "classification": "VARIANT",
  "brand_id": "mapped-lightspeed-brand-uuid",
  "category_id": "mapped-lightspeed-category-uuid",
  "track_inventory": true,
  "variant_attribute_ids": [
    "mapped-lightspeed-size-attribute-uuid"
  ],
  "tag_ids": [
    "mapped-rdk-condition-tag-uuid",
    "mapped-rdk-model-tag-uuid"
  ],
  "products": [
    {
      "variant_attributes": [
        "10"
      ],
      "codes": [
        {
          "type": "CUSTOM",
          "code": "RDK-AJ1-BRED-10"
        }
      ],
      "prices": {
        "price_including_tax": "189.99"
      },
      "active": {
        "in_store": true,
        "ecwid": true
      }
    }
  ]
}
~~~

The request is sent to POST /api/2026-10/product_families. A VARIANT family requires one to three ordered variant_attribute_ids, and every product supplies the same number of ordered variant_attributes. Every product also requires at least one unique code. Price field selection depends on the retailer's tax configuration and the released contract; the example assumes a tax-inclusive configuration. Channel-active values come from connection configuration rather than being hard-coded.

Creation returns generated IDs rather than the created resources:

~~~json
{
  "data": {
    "product_family_id": "5f2d8f8d-9ee4-4ed5-89f5-9ace2de13a4e",
    "product_ids": [
      "f451a2a2-7ac8-48c6-9032-199d91dfb1ce"
    ]
  }
}
~~~

The worker refetches that family and maps each generated product ID to the unique expected CUSTOM code plus its ordered variant attributes. It never assumes that response array position identifies the corresponding website variant. Family images are synchronized after creation through POST /api/2026-10/product_families/{family_id}/images; image removal uses the dedicated image DELETE endpoint rather than a family patch.

Initial quantity is a separate delta adjustment after family creation and verification. The worker first fetches the new product's designated-outlet quantity and version, then calculates desired quantity minus observed quantity. The following example assumes the observed quantity is zero:

~~~json
{
  "stock_adjustments": [
    {
      "outlet_id": "configured-ecommerce-outlet-uuid",
      "product_id": "f451a2a2-7ac8-48c6-9032-199d91dfb1ce",
      "quantity": "1",
      "reason": "STOCK_FOUND"
    }
  ]
}
~~~

The operation targets POST /api/2026-07/stock_adjustments. Before retrying after an ambiguous timeout, the worker refetches inventory and examines the stored before-value/version plus any operation evidence. If the desired quantity is already observed, it marks success. If intervening movement makes the result ambiguous, it enters needs_attention instead of blindly applying the delta twice.

### 12.2 Lightspeed creates a product family

The webhook request is `application/x-www-form-urlencoded`. A decoded diagnostic view resembles:

~~~text
type=product.update&domain_prefix=retailer&payload={"id":"legacy-product-resource-id","version":5303657190,...}
~~~

`payload` is the API 1.0 entity object; it does not gain an invented `type` member. The callback URL already identifies the configured connection and trigger type, because optional form fields such as `domain_prefix` cannot be the routing key. When `type`, `domain_prefix`, or `retailer_id` is present, it must agree with that route and stored connection.

The receiver verifies the exact encoded body, then stores only its SHA-256 and sanitized fields such as resource ID, version, retailer ID, product ID, and outlet ID. It never persists the raw `sale.update` body because that entity may contain customer/payment data. The legacy resource ID must not be assumed to be a 2026-10 family ID. The stored inbox evidence is:

~~~json
{
  "trigger_type": "product.update",
  "resource_id": "legacy-product-resource-id",
  "resource_version": 5303657190,
  "body_sha256": "64-lowercase-hex-characters",
  "sanitized_trigger": {
    "retailer_id": "configured-retailer-uuid",
    "product_id": "legacy-product-resource-id",
    "outlet_id": null
  }
}
~~~

The inbox worker resolves the trigger product/resource to its current family, then fetches that complete family and inventory. This authoritative fetch, not the trigger envelope, supplies product fields. A representative normalized fetch result is:

~~~json
{
  "data": {
    "id": "5f2d8f8d-9ee4-4ed5-89f5-9ace2de13a4e",
    "name": "Air Jordan 1 Retro High OG",
    "description": "Black and red high-top sneaker.",
    "classification": "VARIANT",
    "brand_id": "mapped-lightspeed-brand-uuid",
    "category_id": "mapped-lightspeed-category-uuid",
    "track_inventory": true,
    "variant_attribute_ids": [
      "mapped-lightspeed-size-attribute-uuid"
    ],
    "tag_ids": [
      "mapped-rdk-condition-tag-uuid",
      "mapped-rdk-model-tag-uuid",
      "unmanaged-lightspeed-tag-uuid"
    ],
    "images": [
      {
        "id": "lightspeed-image-uuid",
        "url": "https://cdn.example.com/aj1-bred-front.jpg"
      }
    ],
    "products": [
      {
        "id": "f451a2a2-7ac8-48c6-9032-199d91dfb1ce",
        "family_id": "5f2d8f8d-9ee4-4ed5-89f5-9ace2de13a4e",
        "variant_name": "10",
        "sku": "RDK-AJ1-BRED-10",
        "variant_attributes": [
          "10"
        ],
        "prices": {
          "price_excluding_tax": null,
          "price_including_tax": "189.99",
          "tax": null,
          "loyalty_amount": null
        },
        "active": {
          "in_store": true,
          "ecwid": true
        },
        "codes": [
          {
            "type": "CUSTOM",
            "code": "RDK-AJ1-BRED-10"
          }
        ],
        "version": 27561014304,
        "deleted_at": null
      }
    ]
  },
  "inventory": [
    {
      "outlet_id": "configured-ecommerce-outlet-uuid",
      "product_id": "f451a2a2-7ac8-48c6-9032-199d91dfb1ce",
      "quantity": 1,
      "version": 412
    }
  ]
}
~~~

After strict validation and mapping, the local command is explicit:

~~~json
{
  "command": "upsert_synchronized_family",
  "source": "lightspeed",
  "lightspeed_family_id": "5f2d8f8d-9ee4-4ed5-89f5-9ace2de13a4e",
  "expected_remote_revision": "observed-token",
  "product": {
    "name": "Air Jordan 1 Retro High OG",
    "description": "Black and red high-top sneaker.",
    "brand_override_id": "brand_jordan",
    "model_override_id": "model_aj1",
    "category": "sneakers",
    "condition": "new"
  },
  "variants": [
    {
      "lightspeed_product_id": "f451a2a2-7ac8-48c6-9032-199d91dfb1ce",
      "sku": "RDK-AJ1-BRED-10",
      "size_type": "shoe",
      "size": "10",
      "sale_price_cents": 18999,
      "stock": 1
    }
  ]
}
~~~

If category, model, tax mode, condition, or variant definition cannot be mapped without guessing, no incomplete website product is published. The family enters needs_attention with the authoritative remote snapshot intact.

When all shared fields map successfully, website-only required values come from a versioned inbound-product template on the connection. That template supplies shipping defaults, local merchandising defaults, and an immediate-when-valid publication policy so a valid Lightspeed create is actually posted to the website. A missing required template value produces needs_attention rather than an invented default.

### 12.3 Either side edits a family or variant

A website edit emits changed canonical fields and the base snapshot hash:

~~~json
{
  "event_type": "catalog.family.edited",
  "base_snapshot_hash": "sha256-of-last-common-state",
  "payload": {
    "family_changes": {
      "name": "Air Jordan 1 Retro High OG Bred",
      "description": "Updated description."
    },
    "variant_changes": [
      {
        "sync_variant_id": "sv_10",
        "sale_price_cents": 19499
      }
    ]
  }
}
~~~

The worker first refetches the current remote family. If the three-way merge permits the website values, it separates family and product operations:

~~~json
{
  "family_patch": {
    "name": "Air Jordan 1 Retro High OG Bred",
    "description": "Updated description.",
    "tag_ids": [
      "unmanaged-lightspeed-tag-uuid",
      "mapped-rdk-condition-tag-uuid",
      "mapped-rdk-model-tag-uuid"
    ]
  },
  "product_patches": [
    {
      "id": "f451a2a2-7ac8-48c6-9032-199d91dfb1ce",
      "prices": {
        "price_including_tax": "194.99"
      }
    }
  ]
}
~~~

The family patch targets PATCH /api/2026-10/product_families/{family_id}; each product patch targets PATCH /api/2026-10/products/{product_id}. The adapter sends only supported fields unless the endpoint defines replacement semantics. When a collection is replaced, it includes currently fetched unmanaged values so an RDK edit does not erase Lightspeed-owned tags, codes, channels, images, or attributes.

An inbound product.update trigger follows the same authoritative-fetch and three-way-merge path. Remote-only changes are applied locally even for fields whose conflict authority is the website. A concurrent conflict is resolved per field and written to sync_conflicts.

### 12.4 Add, archive, or reactivate a variant

Adding a website variant emits:

~~~json
{
  "event_type": "catalog.variant.created",
  "payload": {
    "sync_variant_id": "sv_105",
    "sku": "RDK-AJ1-BRED-10.5",
    "attribute_values": [
      {
        "name": "Size",
        "value": "10.5"
      }
    ],
    "sale_price_cents": 19499,
    "initial_quantity": 1
  }
}
~~~

The adapter converts that intent into this product array:

~~~json
[
  {
    "variant_attributes": [
      "10.5"
    ],
    "codes": [
      {
        "type": "CUSTOM",
        "code": "RDK-AJ1-BRED-10.5"
      }
    ],
    "prices": {
      "price_including_tax": "194.99"
    },
    "active": {
      "in_store": true,
      "ecwid": true
    }
  }
]
~~~

The worker sends the array to POST /api/2026-10/product_families/{family_id}/products. The response contains generated product_ids only. It refetches the family, matches the new product by unique CUSTOM code plus attributes, stores the generated ID link, then applies initial stock as a separate guarded delta. A SKU/code collision with any active local or remote product stops the operation before writing.

Removing a variant does not call the irreversible DELETE operation. It patches that product's configured channel-active flags to false, archives the website variant, and retains its link/tombstone. Reactivation is a new explicit intent that verifies the old remote product still exists before clearing the tombstone.

### 12.5 Manual inventory edit

Lightspeed is the inventory authority, but an authorized website operator may request a stock change. The command is an intent to adjust Lightspeed, not a local absolute overwrite:

~~~json
{
  "event_type": "inventory.adjustment.requested",
  "payload": {
    "sync_variant_id": "sv_10",
    "outlet_id": "configured-ecommerce-outlet-uuid",
    "observed_quantity": 1,
    "desired_quantity": 3,
    "observed_remote_version": 412,
    "reason": "inventory_count"
  }
}
~~~

The worker refetches the designated outlet. If quantity/version still equal the observed values, it sends a +2 stock adjustment. If they changed, it recalculates only after presenting the fresh value to the conflict policy; it never sends a stale absolute value. Local stock updates only from the authoritative post-adjustment fetch or a newer inventory event.

An inventory.update event is accepted only for the configured outlet:

~~~json
{
  "product_id": "f451a2a2-7ac8-48c6-9032-199d91dfb1ce",
  "outlet_id": "configured-ecommerce-outlet-uuid",
  "quantity": 3,
  "version": 413
}
~~~

Events at or below the stored version are idempotent no-ops. A version gap triggers an authoritative fetch. Quantities from other outlets are recorded only as diagnostic metadata and never summed into website availability.

### 12.6 Archive from either side

The website archive intent is:

~~~json
{
  "event_type": "catalog.family.archived",
  "payload": {
    "sync_family_id": "sf_01...",
    "reason": "operator_archive",
    "archived_at": "2026-08-29T16:00:00Z"
  }
}
~~~

The worker patches every linked Lightspeed product inactive for the configured channels, verifies the family is no longer sellable there, then writes the remote observation to the tombstone. It does not use DELETE.

If Lightspeed makes all family products inactive, the inbound canonical command is:

~~~json
{
  "command": "archive_synchronized_family",
  "source": "lightspeed",
  "lightspeed_family_id": "5f2d8f8d-9ee4-4ed5-89f5-9ace2de13a4e",
  "product_ids": [
    "f451a2a2-7ac8-48c6-9032-199d91dfb1ce"
  ],
  "observed_at": "2026-08-29T16:00:02Z"
}
~~~

A remote hard deletion also maps to a local archive only after a direct not-found confirmation and a complete reconciliation scan. Any later delayed edit event is ignored by the tombstone. Restoring a family requires an operator-reviewed reactivation or re-link action.

### 12.7 Website sale

Before payment, checkout classifies the cart against the active sync scope. A wholly local-only cart remains outside Lightspeed; a wholly synchronized cart is eligible; a mixed cart is rejected because one payment cannot safely become a partial remote sale. During the catalog-only pilot, synchronized carts are blocked until sale export passes its gates.

After payment succeeds for an eligible cart, the website transaction commits the order, every local inventory decrement, and an outbox row containing only the immutable website order ID. The outbox row's existence is immutable proof that every product was in scope at commit time. When the row is claimed, the worker loads the order/item/payment snapshots and produces this canonical sale intent:

~~~json
{
  "event_type": "sale.completed",
  "payload": {
    "website_order_id": "550e8400-e29b-41d4-a716-446655440000",
    "external_sale_id": "rdk-order:550e8400-e29b-41d4-a716-446655440000",
    "invoice_number": "RDK-JBSWY3DPEHPK3PXP6K5S",
    "completed_at": "2026-08-29T17:20:00Z",
    "currency": "USD",
    "shipping_cents": 0,
    "lines": [
      {
        "sync_variant_id": "sv_10",
        "quantity": 1,
        "unit_price_cents": 19499,
        "discount_cents": 0,
        "tax_cents": 1170
      }
    ],
    "payments": [
      {
        "payment_reference": "processor-reference-redacted",
        "amount_cents": 20669,
        "method_mapping_key": "card"
      }
    ]
  }
}
~~~

The adapter resolves remote product, outlet, register, source author, tax, and payment-type mappings. It creates a request similar to:

~~~json
{
  "source": {
    "register_id": "configured-register-uuid",
    "author_id": "configured-source-author-uuid",
    "id": "rdk-order:550e8400-e29b-41d4-a716-446655440000",
    "type": "RDK Website"
  },
  "date": "2026-08-29T17:20:00Z",
  "state": "closed",
  "invoice_number": "RDK-JBSWY3DPEHPK3PXP6K5S",
  "note": "Website order 550e8400-e29b-41d4-a716-446655440000",
  "line_items": [
    {
      "product": {
        "id": "f451a2a2-7ac8-48c6-9032-199d91dfb1ce"
      },
      "quantity": 1,
      "pricing": {
        "price": "194.99",
        "discount": "0.00"
      },
      "tax": {
        "id": "mapped-sales-tax-uuid",
        "amount": "11.70"
      },
      "status": "CONFIRMED"
    }
  ],
  "payments": [
    {
      "type": {
        "config_id": "mapped-card-payment-type-uuid"
      },
      "date": "2026-08-29T17:20:00Z",
      "amount": "206.69"
    }
  ]
}
~~~

The request targets POST /api/2026-07/sales. `pricing.price` and `tax.amount` are unit, tax-exclusive amounts in this example. A nonzero shipping charge is represented by a configured non-inventory Lightspeed shipping product line with its own tax mapping; it is never folded into a merchandise unit price. The contract suite verifies the retailer's tax mode and the full request/response shape.

Lightspeed generates the sale `data.id`; the worker stores it in the vendor-specific sale link for that website order before acknowledging the outbox event. If the POST times out, the worker searches for the deterministic `invoice_number`, verifies `source.id`, source type, totals, and line identities, and adopts exactly one match. No match after the visibility window remains recovery_pending/needs_attention because search absence is not proof that the create failed. Multiple or non-identical matches also enter needs_attention. A second POST is automatic only when the transport can prove the first request body was never sent.

There is no stock adjustment for this order. The local checkout decrement represents the website side of the sale; Lightspeed's sale represents the remote side. When the authoritative inventory update returns, the website sets/confirms that outlet quantity and does not subtract the sale a second time. The website order remains paid and successful if Lightspeed is temporarily unavailable; its sync state becomes pending or needs_attention without asking the customer to pay again.

Every sale line must have an active Lightspeed product link. If a newly created product's link operation is still pending, the sale waits behind that family dependency. A failed product sync surfaces the paid order for operator attention but never invents a product ID or creates a duplicate placeholder.

### 12.8 Refund and cancellation

A refund transaction always stores its local immutable ledger. It stores a separate `sale.refund.requested` outbox row containing only the website order/refund IDs when the original order has a Lightspeed sale intent/link; a wholly local-only order creates no Lightspeed refund work. The worker loads an eligible ledger into a canonical intent keyed to the original order, stored Lightspeed sale ID, website refund ID, returned quantities, money movement, restock choice, and—when not restocking—an explicit negative inventory-disposition reason.

The documented date-versioned workflow is a three-step saga:

1. fetch the original closed sale and store its current `return.return_sale_ids` as the baseline;
2. POST /api/2026-07/sales/{sale_id}/actions/return with no body, then store the generated parked return `data.id`; and
3. GET that parked return, retain only the requested negative line quantities, add a negative payment using the mapped `type.config_id`, and PUT the complete sale to /api/2026-07/sales/{return_sale_id} with `state` set to `closed`.

The final PUT preserves every retained line and its server-generated line `id`; omitting an existing line deletes it, while omitting an existing line/payment `id` appends a duplicate. A representative minimal change to the fetched parked-return body is:

~~~json
{
  "state": "closed",
  "payments": [
    {
      "type": {
        "config_id": "mapped-card-payment-type-uuid"
      },
      "date": "2026-08-30T14:10:00Z",
      "amount": "-206.69"
    }
  ],
  "line_items": [
    {
      "id": "server-generated-return-line-id",
      "product": {
        "id": "f451a2a2-7ac8-48c6-9032-199d91dfb1ce"
      },
      "quantity": -1,
      "pricing": {
        "price": "194.99",
        "discount": "0.00"
      },
      "tax": {
        "id": "mapped-sales-tax-uuid",
        "amount": "11.70"
      },
      "status": "SAVED"
    }
  ]
}
~~~

The actual PUT is built from the complete validated GET response, not only the excerpt above. A partial refund adjusts negative line quantities and the negative payment to the exact website refund.

If initiating the return times out, the worker refetches the original sale and compares its new `return_sale_ids` against the stored baseline. It adopts exactly one new parked candidate only after its original-sale reference and lines match; zero or multiple candidates after the visibility window enter needs_attention unless the transport proves the request was never sent. An ambiguous final PUT is resolved by fetching the return and comparing its state, retained line IDs/quantities, and payment IDs/amounts. It is never repeated merely because one fetch still looks parked; stale reads could otherwise append a second negative payment.

Closing product return lines is expected to restore their inventory. A `restock: false` refund therefore creates an inventory hold, closes the matching return, and then sends a compensating negative stock adjustment using the operator-selected mapped disposition reason. While the hold is active, intermediate remote observations are audited but not applied to website availability. The refund saga remains processing until the authoritative inventory fetch confirms the final quantity and releases the hold. This behavior must be proved in the retailer sandbox contract suite; until it is, automated refunds remain disabled.

The following invariants are non-negotiable:

1. one website refund stores exactly one generated Lightspeed return ID;
2. the negative payment and any compensating non-restock adjustment have independent durable operation records;
3. only a refund explicitly marked restock may leave the designated outlet quantity increased;
4. retrying after a timeout may not duplicate money or stock movement; and
5. a refund cannot enter the production sales pilot until create, partial, non-restock, timeout-recovery, and duplicate-prevention contract tests pass.

### 12.9 Lightspeed/POS sale

A sale initiated in Lightspeed does not create a synthetic website customer order. Lightspeed owns the sale and its stock movement. The resulting inventory.update event, or the 15-minute recovery fetch if that event is missed, applies the new designated-outlet quantity to the linked website variant. An optional reporting projection may retain the remote sale reference, but it is outside the ecommerce order domain and cannot trigger another inventory write.

## 13. Ordering, idempotency, and delivery state

Work is serialized by connection plus sync_family_id. Sale events additionally serialize by website_order_id. Different families may run concurrently within bounded worker concurrency.

### 13.1 State machine

~~~text
pending -> processing -> succeeded
                    -> retry_wait -> processing
                    -> needs_attention
~~~

Worker claims use database locking/leases so a crashed worker can be recovered. A lease expiration does not imply the remote request failed; ambiguous operations are resolved by operation identity and refetch before retry.

### 13.2 Operation keys

| Operation | Deterministic key input |
|---|---|
| Create family | connection + sync_family_id + create generation |
| Patch family/product | connection + target ID + local revision + normalized patch hash |
| Stock adjustment | connection + variant ID + requested adjustment ID |
| Sale | connection + website order ID |
| Refund | connection + website refund ID |

The sync_operations unique constraint prevents two workers from issuing the same logical operation. When Lightspeed supports a caller-provided ID, that ID is derived/stored before the first request.

## 14. Error policy

Safely repeatable transient operations retry after 5 seconds, 15 seconds, 45 seconds, 2 minutes, and 5 minutes. A non-idempotent operation with an unknown remote commit stays in recovery observation and is not sent again unless the transport proves no request bytes were written. Exhaustion moves the event to needs_attention while scheduled reconciliation continues observation.

| Response/failure | Handling |
|---|---|
| Timeout/network/429/5xx | Resolve possible remote commit by deterministic ID/refetch; retry only repeatable operations or requests proven unsent |
| 400/422 | Do not retry unchanged payload; record validation details and enter needs_attention |
| 401 | Refresh once; if still unauthorized, pause that connection's writes |
| 403 | Record missing permission/capability and pause the affected operation class |
| 404 | Refetch parent/direct resource; archive only after confirmed absence rules pass |
| 409/version conflict | Refetch, rebuild three-way merge, and retry only the newly valid operation |

Webhook ingestion returns 204 after durable storage and within five seconds. Invalid authentication returns the appropriate rejection without entering the inbox. Business processing never runs in the request lifecycle.

## 15. Reconciliation

Reconciliation is both the initial migration mechanism and the permanent missed-event safety net. It runs at least every 15 minutes and may be triggered manually.

### 15.1 Complete-scan rule

1. Create a scan run and stage every remote family page, product-family continuation, and designated-outlet inventory page.
2. Validate every page and hydrate every linked resource required for comparison.
3. Record cursors, counts, duplicate IDs, and API errors; merge family members split across pages.
4. Mark the scan complete only when all required streams reach a valid terminal cursor.
5. Activate comparison results atomically; an incomplete scan remains diagnostic and cannot archive or unlink anything.

Rate limits are handled with bounded concurrency and checkpointed pagination. The implementation must not use unbounded Promise.all over a catalog.

### 15.2 Initial linking

Initial reconciliation is read-only. It produces proposals in these categories:

| Category | Meaning | Allowed automatic action |
|---|---|---|
| Exact unique match | One local variant and one remote product share the same normalized non-empty SKU, with no family contradiction | Propose only |
| Ambiguous SKU | Duplicate/case-folded collision on either side | None |
| Local only | Website record has no candidate | Propose future remote create |
| Remote only | Lightspeed record has no candidate | Propose future local create |
| Structural conflict | Candidate variants imply inconsistent family, condition, size, or category mapping | None |

An operator reviews and approves proposals. Approval writes stable family/product links and a common base snapshot; only a later explicit activation may enqueue repairs. A single matching SKU can never silently link every member of a family.

### 15.3 Ongoing comparison

For linked records, reconciliation compares normalized managed fields only. It excludes local publishing fields, unavailable cost, other outlets, and preserved unmanaged remote metadata. Results are:

- synchronized: no managed difference;
- repairable drift: one side changed from the base;
- conflict: both sides changed differently;
- missing/archived: absence or inactive state needs confirmation; or
- mapping required: a value cannot be converted without guessing.

Missing evidence is deliberately strict. A list omission alone never archives. Normal archive requires either an explicit inactive state from an authoritative family fetch or both a complete scan and a direct resource fetch confirming absence. A transient hydration failure is an error, not a deletion.

## 16. Operator experience

Each synchronized product exposes one primary sync state:

| State | User-visible meaning |
|---|---|
| pending | The local action is saved and waiting for Lightspeed |
| synchronized | Managed fields match the latest acknowledged remote state |
| needs_attention | Automatic progress stopped; the UI shows the field/operation and safe resolution choices |

The detail view shows the last successful sync time, pending action, retry count, remote IDs, designated outlet, and field-level conflicts. Raw credentials, full payment references, and unredacted customer data never appear.

Conflict resolution choices are bounded: use website value, use Lightspeed value, map a missing value, retry after correcting configuration, or archive. Choosing a value creates a new audited intent against the latest snapshots.

## 17. Security and observability

1. Store tokens encrypted, scope every record and operation to a connection/retailer, and never fall back to a global tenant when context is missing.
2. Verify webhook authenticity from the exact raw request required by the documented scheme before parsing or acknowledging it.
3. Redact authorization, customer details, processor references, and sensitive response bodies from logs while retaining correlation and remote request IDs.
4. Emit metrics for inbox age, outbox age, success/error rates, retries, conflicts, scan completeness, webhook latency, convergence latency, and inventory drift.
5. Alert on paused authentication, oldest work beyond the SLO, repeated contract validation failures, incomplete scans, and any duplicate sale/refund identity.

Audit retention must be long enough to trace catalog and inventory changes through the business's operational dispute window. Tombstones and identity links outlive ordinary product archival.

## 18. Testing strategy

### 18.1 Transformation tests

Fixture tests cover every endpoint-specific wire schema in both directions:

- webhook form/envelope to trigger;
- 2026-10 family/product responses to canonical state;
- canonical create/edit/archive operations to wire requests;
- inventory versions and delta adjustments; and
- sale/refund money, tax, payment, and outlet mappings.

Fixtures include missing optional fields, explicit null, empty string, zero money, zero/negative quantity where allowed, Unicode/case SKU differences, reordered arrays, unknown tags, multiple images, and unavailable cost.

### 18.2 Behavior matrix

| Scenario | Required assertion |
|---|---|
| Website create | One family, correct stable variant links, one guarded initial stock delta |
| Lightspeed create | Full authoritative fetch, exact mappings, no guessed/defaulted published product |
| Website/remote edit | Remote-only and local-only edits propagate; concurrent fields use authority |
| Add/archive variant | Stable ID mapping; no irreversible delete; tombstone blocks delayed resurrection |
| Family archive | Both sides become unsellable and retain links |
| Website sale | One remote sale UUID, no second stock write, eventual authoritative quantity |
| Refund/cancel | Exactly one money action; stock changes only according to explicit restock policy |
| Reconciliation | Only managed fields drift; incomplete scans cannot archive |

### 18.3 Fault and ordering tests

Tests inject duplicate and reversed webhooks, stale inventory versions, worker crashes, timeout after remote commit, 429/500 responses, expired credentials, permission loss, cursor repetition, partial pages, split family pages, duplicate SKU, and simultaneous local/remote edits.

Every mutation test verifies idempotent replay. Checkout tests verify a captured payment remains a successful website order while its Lightspeed sale is pending.

### 18.4 2026-10 production contract gate

Production writes remain disabled until all of the following pass against the released target environment:

1. schema validation for create, fetch, family patch, product patch, add product, and active/channel behavior;
2. money and tax round trips for the retailer's configuration without cent drift;
3. sale, payment, refund, and inventory side effects with deterministic identities;
4. webhook authentication, content type, trigger parsing, and sub-five-second durable acknowledgement; and
5. required OAuth scopes, pagination behavior, rate-limit handling, and unavailable-cost behavior.

Recorded sanitized request/response fixtures from this gate become regression fixtures. If the released 2026-10 contract differs, only adapters and fixtures change unless the canonical semantics also changed.

## 19. Rollout

### Phase 1: capture-only for 24 hours

Create/reconcile only the three required webhook subscriptions (`product.update`, `inventory.update`, and `sale.update`), then enable verification/inbox storage, remote reads, canonical normalization, and reconciliation reports. Disable every business-data sync write. Confirm complete scans and measure proposed drift without changing either inventory; webhook subscription control-plane writes are the only Phase 1 remote mutations.

### Phase 2: controlled test set

Use 20 designated test products across simple and multi-variant families, plus 10 test sale/refund cycles. Exercise both-direction create/edit/archive and failure recovery. All contract and behavior tests must pass.

### Phase 3: catalog pilot for 24 hours

Enable catalog and inventory synchronization for an allowlist of 10 real products. Sales export remains disabled, so those allowlisted products are blocked server-side from checkout during this phase; otherwise a website sale would decrement only the website and make a zero-drift pilot impossible. Require zero unexplained managed drift and no irreversible action.

### Phase 4: sales pilot for 24 hours

After every sales/returns gate passes, enable website sale/refund export and automatically release the Phase 3 checkout block for the allowlist. Confirm deterministic sale/refund identities, correct outlet movement, payment totals, and no duplicate stock adjustment.

### Phase 5: full catalog with 7-day monitoring

Expand the allowlist deliberately, then enable the full catalog. Review alerts and reconciliation daily for seven days before treating the integration as steady-state.

### 19.1 Kill switches

The connection has four independent controls:

| Switch | Effect when off |
|---|---|
| Inbound apply | Continue capture/fetch, but do not mutate website catalog |
| Outbound catalog | Do not create, patch, or archive Lightspeed products |
| Inventory adjustments | Do not issue manual/initial stock adjustments |
| Sales and refunds | Do not create remote sales, returns, refunds, or payments |

Observation, inbox storage, audit, and dry-run reconciliation remain available when writes are disabled.

## 20. Service objectives and acceptance

The rebuild is accepted only when:

1. 99 percent of healthy-path product and inventory changes converge within 60 seconds, measured from durable local intent or verified webhook receipt;
2. any missed webhook represented in the authoritative API converges through recovery within 15 minutes;
3. duplicate/reordered delivery and timeout-after-commit tests produce no duplicate product, sale, refund, payment, or stock movement;
4. complete reconciliation reports zero unexplained managed-field drift for the rollout scope and incomplete scans produce zero archive actions; and
5. operators can identify and safely resolve every needs_attention item from stored evidence without database surgery.

“Zero drift” applies only to the declared managed-field contract. Unknown or unsupported data must be surfaced as unavailable or mapping-required, never coerced until it appears to match.

## 21. Implementation boundary

Implementation begins only after this design is reviewed. The subsequent implementation plan must preserve these boundaries:

- endpoint wire schemas stay inside versioned Lightspeed adapters;
- canonical comparison and policy contain no HTTP or database DTOs;
- product/checkout transactions write durable intents but make no remote calls;
- workers are replay-safe and resolve ambiguous remote outcomes before retry; and
- production mutations remain behind the contract gate, allowlist, and independent kill switches.

No part of the removed synchronization code is assumed correct by default. Reusable authentication or client infrastructure may be adopted only after its tenant scoping, error behavior, and target-version contract are verified against this design.
