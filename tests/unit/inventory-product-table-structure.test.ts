import fs from "node:fs";
import path from "node:path";

describe("inventory product table structure", () => {
  it("delegates row rendering to a focused table row component", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/modules/catalog/presentation/admin/inventory/listing/products/InventoryProductTable.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/products/InventoryProductTableRow",
    );
    expect(source).toContain("<InventoryProductTableRow");
  });
});
