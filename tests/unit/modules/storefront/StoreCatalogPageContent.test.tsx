import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/modules/storefront/application/storefront-catalog", () => ({
  getStoreCatalogPageData: vi.fn(),
}));

vi.mock("@/components/storefront/catalog/CatalogFilterBar", () => ({
  CatalogFilterBar: () => "<catalog-filter-bar />",
}));

vi.mock("@/components/storefront/catalog/CatalogToolbar", () => ({
  CatalogToolbar: ({ browseLabel, total }: { browseLabel: string; total: number }) =>
    `<catalog-toolbar label="${browseLabel}" total="${total}" />`,
}));

vi.mock("@/components/storefront/catalog/StorefrontControls", () => ({
  StorefrontControls: ({ total, page, pageCount }: { total: number; page: number; pageCount: number }) =>
    `<storefront-controls total="${total}" page="${page}" pageCount="${pageCount}" />`,
}));

vi.mock("@/components/storefront/catalog/StorefrontFilterPanel", () => ({
  StorefrontFilterPanel: () => "<storefront-filter-panel />",
}));

vi.mock("@/components/storefront/catalog/StorefrontProductGrid", () => ({
  StorefrontProductGrid: ({ storeHref }: { storeHref: string }) =>
    `<storefront-product-grid href="${storeHref}" />`,
}));

import {
  getStoreCatalogPageData,
} from "@/modules/storefront/application/storefront-catalog";
import { StoreCatalogPageContent } from "@/modules/storefront/presentation/catalog/StoreCatalogPageContent";

const mockGetStoreCatalogPageData = vi.mocked(getStoreCatalogPageData);

describe("StoreCatalogPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStoreCatalogPageData.mockResolvedValue({
      brandOptions: [{ value: "Nike", label: "Nike" }],
      browseLabel: "Shop All",
      filterData: {
        categories: ["Sneakers"],
        modelsByBrand: {},
        brandsByCategory: {},
        availableShoeSizes: ["10"],
        availableClothingSizes: ["M"],
        availableConditions: ["new"],
      },
      filters: { sort: "newest" },
      pageCount: 3,
      productsResult: {
        total: 42,
        page: 2,
        limit: 20,
        products: [],
      },
      selectedBrands: [],
      selectedCategories: [],
      selectedClothingSizes: [],
      selectedConditions: [],
      selectedModels: [],
      selectedShoeSizes: [],
      storeHref: "/store?q=nike",
    } as never);
  });

  it("passes resolved search params into the catalog page data loader", async () => {
    const searchParams = { q: "nike", page: "2" };

    await StoreCatalogPageContent({ searchParams });

    expect(mockGetStoreCatalogPageData).toHaveBeenCalledWith(searchParams);
  });

  it("renders the current storefront catalog shell", async () => {
    const html = renderToStaticMarkup(
      await StoreCatalogPageContent({ searchParams: undefined }),
    );

    expect(html).toContain("catalog-toolbar");
    expect(html).toContain("catalog-filter-bar");
    expect(html).toContain("storefront-controls");
    expect(html).toContain("storefront-product-grid");
    expect(html).toContain("&quot;/store?q=nike&quot;");
  });
});
