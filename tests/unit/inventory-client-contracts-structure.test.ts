import fs from "node:fs";
import path from "node:path";

describe("inventory client contracts structure", () => {
  it("shares typed contracts across the inventory child surfaces", () => {
    const toolbarSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/modules/catalog/presentation/admin/inventory/listing/components/InventoryToolbar.tsx",
      ),
      "utf8",
    );
    const contentSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/modules/catalog/presentation/admin/inventory/listing/InventoryClientContent.tsx",
      ),
      "utf8",
    );
    const dialogsSource = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/modules/catalog/presentation/admin/inventory/listing/components/InventoryDialogs.tsx",
      ),
      "utf8",
    );

    expect(toolbarSource).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/inventoryClientContracts",
    );
    expect(contentSource).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/inventoryClientContracts",
    );
    expect(dialogsSource).toContain(
      "@/modules/catalog/presentation/admin/inventory/listing/inventoryClientContracts",
    );
  });
});
