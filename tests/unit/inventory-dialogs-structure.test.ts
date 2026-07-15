import fs from "node:fs";
import path from "node:path";

describe("inventory dialogs structure", () => {
  it("delegates destructive confirmation flows to focused dialog components", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/modules/catalog/presentation/admin/inventory/listing/components/InventoryDialogs.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/components/InventoryArchiveDialog",
    );
    expect(source).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/components/InventoryDeleteDialogs",
    );
    expect(source).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/components/InventoryRestoreDialog",
    );
    expect(source).toContain("<InventoryArchiveDialog");
    expect(source).toContain("<InventoryDeleteDialogs");
    expect(source).toContain("<InventoryRestoreDialog");
  });
});
