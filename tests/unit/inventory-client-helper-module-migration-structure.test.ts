import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("inventory client helper module migration structure", () => {
  it("makes the inventory helper and request modules module-owned", () => {
    const modulePaths = [
      "src/modules/catalog/presentation/admin/inventory/listing/inventoryClientData.ts",
      "src/modules/catalog/presentation/admin/inventory/listing/inventoryClientDerivedState.ts",
      "src/modules/catalog/presentation/admin/inventory/listing/inventoryClientLifecycle.ts",
      "src/modules/catalog/presentation/admin/inventory/listing/inventoryClientRealtime.ts",
      "src/modules/catalog/presentation/admin/inventory/listing/inventoryClientRequests.ts",
      "src/modules/catalog/presentation/admin/inventory/listing/inventoryClientSelection.ts",
      "src/modules/catalog/presentation/admin/inventory/listing/inventoryClientActions.ts",
      "src/modules/catalog/presentation/admin/inventory/listing/inventoryClientMutations.ts",
      "src/modules/catalog/presentation/admin/inventory/listing/inventoryClientUiState.ts",
      "src/modules/catalog/presentation/admin/inventory/inventoryMutationFlows.ts",
      "src/modules/catalog/presentation/admin/inventory/inventoryMutationRequests.ts",
    ];

    for (const modulePath of modulePaths) {
      expect(read(modulePath)).toContain("export ");
    }
  });

  it("removes legacy inventory helper duplicate files after module migration", () => {
    const legacyPaths = [
      "src/components/admin/inventory/inventoryClientData.ts",
      "src/components/admin/inventory/inventoryClientDerivedState.ts",
      "src/components/admin/inventory/inventoryClientLifecycle.ts",
      "src/components/admin/inventory/inventoryClientRealtime.ts",
      "src/components/admin/inventory/inventoryClientRequests.ts",
      "src/components/admin/inventory/inventoryClientSelection.ts",
      "src/components/admin/inventory/inventoryClientActions.ts",
      "src/components/admin/inventory/inventoryClientMutations.ts",
      "src/components/admin/inventory/inventoryClientUiState.ts",
      "src/components/admin/inventory/inventoryMutationFlows.ts",
      "src/components/admin/inventory/inventoryMutationRequests.ts",
    ];

    for (const legacyPath of legacyPaths) {
      expect(fs.existsSync(path.join(process.cwd(), legacyPath))).toBe(false);
    }
  });
});
