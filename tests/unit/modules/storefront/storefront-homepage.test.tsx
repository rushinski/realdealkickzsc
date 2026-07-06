import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HomePageContent } from "@/modules/storefront/presentation/home/HomePageContent";

describe("HomePageContent", () => {
  it("renders the solesneakers editorial homepage sections", () => {
    const html = renderToStaticMarkup(<HomePageContent />);

    expect(html).toContain("ELEVATED CURATION OF FOOTWEAR");
    expect(html).toContain("BRAND NAME");
    expect(html).toContain("SHOP NOW");
  });
});
