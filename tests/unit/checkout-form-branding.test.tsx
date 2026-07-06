import { vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CheckoutForm } from "@/modules/checkout/presentation/components/CheckoutForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock("@/modules/checkout/presentation/components/SavedAddresses", () => ({
  SavedAddresses: () => "saved-addresses",
}));

describe("CheckoutForm", () => {
  it("renders the solesneakers checkout section without legacy red checkout chrome", () => {
    const html = renderToStaticMarkup(
      <CheckoutForm
        orderId="order-1"
        items={[]}
        displayTotal={250}
        fulfillment="pickup"
        shippingAddress={null}
        onShippingAddressChange={() => undefined}
        onFulfillmentChange={() => undefined}
        guestEmail="guest@example.com"
        onGuestEmailChange={() => undefined}
        isGuestCheckout
      />,
    );

    expect(html).toContain("null@gmail.com");
    expect(html).toContain("Secure checkout");
    expect(html).toContain("Submit Order");
    expect(html).toContain("bg-brand-surface");
    expect(html).not.toContain("bg-red-600");
    expect(html).not.toContain("text-red-500");
    expect(html).not.toContain("text-zinc-500");
    expect(html).not.toContain("pickup chat");
  });
});
