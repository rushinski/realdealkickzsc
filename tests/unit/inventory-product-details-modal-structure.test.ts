import fs from "node:fs";
import path from "node:path";

describe("inventory product details modal structure", () => {
  it("delegates modal view formatting and image selection defaults to a focused view helper", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/modules/catalog/presentation/admin/inventory/listing/details/InventoryProductDetailsModal.tsx",
      ),
      "utf8",
    );
    const viewSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/modules/catalog/presentation/admin/inventory/listing/details/inventoryProductDetailsView.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/details/inventoryProductDetailsView",
    );
    expect(viewSource).toContain("formatInventoryDetailsDateTime");
    expect(viewSource).toContain("getInventoryDetailsImages");
  });

  it("delegates the media and metadata surfaces to focused child components", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/modules/catalog/presentation/admin/inventory/listing/details/InventoryProductDetailsModal.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/details/InventoryProductImageGallery",
    );
    expect(source).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/details/InventoryProductMetadataPanel",
    );
  });
});
