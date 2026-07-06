import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("app/checkout/page", () => {
  it("keeps the route thin by delegating to the checkout module page content", async () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "app/checkout/page.tsx"),
      "utf8",
    );

    expect(source).toContain('@/modules/checkout');
    expect(source).toContain("<CheckoutGatePageContent");
  });
});
