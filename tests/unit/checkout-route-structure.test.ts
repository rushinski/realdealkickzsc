import fs from "node:fs";
import path from "node:path";

describe("checkout route structure", () => {
  it("routes cart and checkout success pages through client-safe checkout presentation files", () => {
    const cartSource = fs.readFileSync(
      path.join(process.cwd(), "app/cart/page.tsx"),
      "utf8",
    );
    const successSource = fs.readFileSync(
      path.join(process.cwd(), "app/checkout/success/page.tsx"),
      "utf8",
    );

    expect(cartSource).toContain("@/modules/checkout/presentation/CartPageContent");
    expect(cartSource).not.toContain('from "@/modules/checkout"');
    expect(cartSource).toContain("<CartPageContent />");
    expect(successSource).toContain(
      "@/modules/checkout/presentation/CheckoutSuccessPageContent",
    );
    expect(successSource).not.toContain('from "@/modules/checkout"');
    expect(successSource).toContain("<CheckoutSuccessPageContent />");
  });
});
