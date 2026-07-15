import { describe, expect, it } from "vitest";

import {
  buildInventoryBulkSelectionArgs,
  buildInventoryItemActionUrl,
  buildInventoryItemRequestInit,
} from "@/modules/catalog/presentation/admin/inventory/listing/inventoryClientMutations";

describe("inventory client request helpers", () => {
  it("builds item action urls for default and named actions", () => {
    expect(buildInventoryItemActionUrl("product-1")).toBe(
      "/api/admin/products/product-1",
    );
    expect(buildInventoryItemActionUrl("product-1", "archive")).toBe(
      "/api/admin/products/product-1?action=archive",
    );
    expect(buildInventoryItemActionUrl("product-1", "restore")).toBe(
      "/api/admin/products/product-1?action=restore",
    );
  });

  it("builds request init objects for item mutations", () => {
    expect(buildInventoryItemRequestInit("DELETE")).toEqual({ method: "DELETE" });
    expect(buildInventoryItemRequestInit("PATCH")).toEqual({ method: "PATCH" });
    expect(buildInventoryItemRequestInit("POST")).toEqual({ method: "POST" });
  });

  it("switches between id and filtered bulk selection payloads", () => {
    expect(
      buildInventoryBulkSelectionArgs({
        action: "archive",
        selectAllMatching: false,
        selectedIds: ["product-1", "product-2"],
        searchQuery: "",
        categoryFilter: undefined,
        conditionFilter: undefined,
        stockStatusFilter: "in_stock",
      }),
    ).toEqual({
      action: "archive",
      selectionMode: "ids",
      ids: ["product-1", "product-2"],
    });

    expect(
      buildInventoryBulkSelectionArgs({
        action: "restore",
        selectAllMatching: true,
        selectedIds: [],
        searchQuery: "air max",
        categoryFilter: "sneakers",
        conditionFilter: "new",
        stockStatusFilter: "archived",
        stockStatusOverride: "archived",
      }),
    ).toEqual({
      action: "restore",
      selectionMode: "filtered",
      filters: {
        q: "air max",
        category: "sneakers",
        condition: "new",
        stockStatus: "archived",
      },
    });
  });
});
