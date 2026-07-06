import fs from "node:fs";
import path from "node:path";

describe("storefront route structure", () => {
  it("uses the storefront catalog component tree from the store route", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/store/page.tsx"),
      "utf8",
    );

    expect(source).toContain("@/modules/storefront");
    expect(source).toContain("<StoreCatalogPageContent");
  });
});
