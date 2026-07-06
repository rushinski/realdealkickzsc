import { CatalogFilterBar } from "@/modules/storefront/presentation/components/catalog/CatalogFilterBar";
import { CatalogToolbar } from "@/modules/storefront/presentation/components/catalog/CatalogToolbar";
import { FilterPanel } from "@/modules/storefront/presentation/components/catalog/FilterPanel";
import { ProductGrid } from "@/modules/storefront/presentation/components/catalog/ProductGrid";
import { StoreControls } from "@/modules/storefront/presentation/components/catalog/StoreControls";
import {
  getStoreCatalogPageData,
  type StoreSearchParams,
} from "@/modules/storefront/application/storefront-catalog";

export async function StoreCatalogPageContent({
  searchParams,
}: {
  searchParams: StoreSearchParams;
}) {
  const {
    brandOptions,
    browseLabel,
    filterData,
    filters,
    pageCount,
    productsResult,
    selectedBrands,
    selectedCategories,
    selectedClothingSizes,
    selectedConditions,
    selectedModels,
    selectedShoeSizes,
    storeHref,
  } = await getStoreCatalogPageData(searchParams);

  return (
    <div className="bg-brand-page pb-10">
      <div className="mx-auto max-w-brand">
        <CatalogToolbar browseLabel={browseLabel} total={productsResult.total} />
        <CatalogFilterBar />
      </div>

      <div className="mx-auto max-w-brand px-6 py-8 md:px-12 lg:px-16">
        <StoreControls
          total={productsResult.total}
          page={productsResult.page}
          pageCount={pageCount}
          limit={productsResult.limit}
          sort={filters.sort ?? "newest"}
          showPagination={false}
        />

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
          <div className="hidden lg:block">
            <div
              className="sticky transition-[top] duration-300"
              style={{ top: "var(--rdk-header-offset, 0px)" }}
            >
              <FilterPanel
                selectedCategories={selectedCategories}
                selectedBrands={selectedBrands}
                selectedModels={selectedModels}
                selectedShoeSizes={selectedShoeSizes}
                selectedClothingSizes={selectedClothingSizes}
                selectedConditions={selectedConditions}
                categories={filterData.categories}
                brands={brandOptions}
                modelsByBrand={filterData.modelsByBrand}
                brandsByCategory={filterData.brandsByCategory}
                availableShoeSizes={filterData.availableShoeSizes}
                availableClothingSizes={filterData.availableClothingSizes}
                availableConditions={filterData.availableConditions}
                totalProducts={productsResult.total}
              />
            </div>
          </div>

          <div className="lg:col-span-3">
            <ProductGrid products={productsResult.products} storeHref={storeHref} />
          </div>
        </div>

        <div className="lg:hidden">
          <FilterPanel
            selectedCategories={selectedCategories}
            selectedBrands={selectedBrands}
            selectedModels={selectedModels}
            selectedShoeSizes={selectedShoeSizes}
            selectedClothingSizes={selectedClothingSizes}
            selectedConditions={selectedConditions}
            categories={filterData.categories}
            brands={brandOptions}
            modelsByBrand={filterData.modelsByBrand}
            brandsByCategory={filterData.brandsByCategory}
            availableShoeSizes={filterData.availableShoeSizes}
            availableClothingSizes={filterData.availableClothingSizes}
            availableConditions={filterData.availableConditions}
            totalProducts={productsResult.total}
          />
        </div>

        <div className="mt-10">
          <StoreControls
            total={productsResult.total}
            page={productsResult.page}
            pageCount={pageCount}
            limit={productsResult.limit}
            sort={filters.sort ?? "newest"}
            showSortControls={false}
          />
        </div>
      </div>
    </div>
  );
}
