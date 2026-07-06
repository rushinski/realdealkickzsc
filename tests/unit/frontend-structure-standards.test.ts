import fs from "node:fs";
import path from "node:path";

describe("frontend structure standards", () => {
  it("avoids src-crossing relative imports from app routes", () => {
    const shippingPage = fs.readFileSync(
      path.join(process.cwd(), "app/admin/shipping/page.tsx"),
      "utf8",
    );

    expect(shippingPage).not.toMatch(/\.\.\/\.\.\/\.\.\/src\//);
  });

  it("keeps storefront page content pointed at module-owned presentation components", () => {
    const catalogPageContent = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/modules/storefront/presentation/catalog/StoreCatalogPageContent.tsx",
      ),
      "utf8",
    );

    expect(catalogPageContent).toContain(
      "@/modules/storefront/presentation/components/catalog/ProductGrid",
    );
    expect(catalogPageContent).not.toContain("@/components/storefront/");
  });
});
