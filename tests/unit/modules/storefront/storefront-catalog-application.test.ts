import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/storefront/infrastructure/storefront-data", () => ({
  createStorefrontService: vi.fn(),
}));

import { createStorefrontService } from "@/modules/storefront/infrastructure/storefront-data";
import { getStoreCatalogPageData } from "@/modules/storefront/application/storefront-catalog";

const mockCreateStorefrontService = vi.mocked(createStorefrontService);

describe("getStoreCatalogPageData", () => {
  const listProducts = vi.fn();
  const listFilters = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listProducts.mockResolvedValue({
      total: 40,
      page: 2,
      limit: 20,
      products: [],
    });
    listFilters.mockResolvedValue({
      categories: ["Sneakers"],
      brands: [{ label: "Nike" }],
      modelsByBrand: {},
      brandsByCategory: {},
      availableShoeSizes: ["10"],
      availableClothingSizes: ["M"],
      availableConditions: ["new"],
    });
    mockCreateStorefrontService.mockReturnValue({
      listProducts,
      listFilters,
    } as never);
  });

  it("normalizes search params into service filters and store href", async () => {
    const result = await getStoreCatalogPageData({
      q: "air max",
      category: ["sneakers"],
      brand: "Nike",
      sort: "price_desc",
      page: "2",
      limit: "20",
    });

    expect(listProducts).toHaveBeenCalledWith({
      q: "air max",
      category: ["sneakers"],
      brand: ["Nike"],
      model: [],
      sizeShoe: [],
      sizeClothing: [],
      condition: [],
      sort: "price_desc",
      page: 2,
      limit: 20,
      stockStatus: "in_stock",
    });
    expect(result.storeHref).toBe(
      "/store?q=air+max&category=sneakers&brand=Nike&sort=price_desc&page=2&limit=20",
    );
    expect(result.browseLabel).toBe('Search: "air max"');
  });

  it("falls back to safe defaults when invalid params are provided", async () => {
    const result = await getStoreCatalogPageData({
      sort: "not-real",
      page: "bad",
      limit: "wrong",
    });

    expect(listProducts).toHaveBeenCalledWith({
      q: undefined,
      category: [],
      brand: [],
      model: [],
      sizeShoe: [],
      sizeClothing: [],
      condition: [],
      sort: "newest",
      page: 1,
      limit: 20,
      includeOutOfStock: false,
    });
    expect(result.browseLabel).toBe("Shop All");
    expect(result.pageCount).toBe(2);
  });
});
