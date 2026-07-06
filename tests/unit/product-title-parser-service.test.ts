import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductTitleParserService } from "@/services/product-title-parser-service";

const mockListBrandsWithGroups = vi.fn();
const mockListBrandAliases = vi.fn();
const mockListModels = vi.fn();
const mockListModelAliasesAll = vi.fn();

vi.mock("@/repositories/catalog-repo", () => ({
  CatalogRepository: vi.fn(function CatalogRepositoryMock() {
    return {
      listBrandsWithGroups: mockListBrandsWithGroups,
      listBrandAliases: mockListBrandAliases,
      listModels: mockListModels,
      listModelAliasesAll: mockListModelAliasesAll,
    };
  }),
}));

describe("ProductTitleParserService", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockListBrandsWithGroups.mockResolvedValue([
      {
        id: "brand-nike",
        canonical_label: "Nike",
        group: { id: "group-1", key: "nike", label: "Nike" },
      },
    ]);
    mockListBrandAliases.mockResolvedValue([]);
    mockListModels.mockResolvedValue([
      {
        id: "model-jordan-3",
        canonical_label: "Jordan 3",
        brand_id: "brand-nike",
      },
    ]);
    mockListModelAliasesAll.mockResolvedValue([]);
  });

  it("reuses catalog lookups across multiple parses for the same tenant", async () => {
    const service = new ProductTitleParserService({} as never);

    await service.parseTitle({
      titleRaw: "Nike Jordan 3 White Cement",
      category: "sneakers",
      tenantId: "tenant-1",
    });
    await service.parseTitle({
      titleRaw: "Nike Jordan 3 Black Cement",
      category: "sneakers",
      tenantId: "tenant-1",
    });

    expect(mockListBrandsWithGroups).toHaveBeenCalledTimes(1);
    expect(mockListBrandAliases).toHaveBeenCalledTimes(1);
    expect(mockListModels).toHaveBeenCalledTimes(1);
    expect(mockListModelAliasesAll).toHaveBeenCalledTimes(1);
  });
});
