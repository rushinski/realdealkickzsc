import fs from "node:fs";
import path from "node:path";

describe("inventory toolbar filters structure", () => {
  it("delegates stock tabs and filter controls to focused subcomponents", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/modules/catalog/presentation/admin/inventory/listing/components/InventoryToolbar.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/components/InventoryStockStatusTabs",
    );
    expect(source).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/components/InventoryFilterControls",
    );
    expect(source).toContain("<InventoryStockStatusTabs");
    expect(source).toContain("<InventoryFilterControls");
  });
});
