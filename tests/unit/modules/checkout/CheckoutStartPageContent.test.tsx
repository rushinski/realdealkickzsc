import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/store-access/get-store-access-settings", () => ({
  getStoreAccessSettings: vi.fn(),
}));

vi.mock("@/components/checkout/CheckoutLockedNotice", () => ({
  CheckoutLockedNotice: ({ message }: { message: string }) => `locked:${message}`,
}));

vi.mock("@/components/checkout/CheckoutStart", () => ({
  CheckoutStart: () => "checkout-start",
}));

import { getStoreAccessSettings } from "@/lib/store-access/get-store-access-settings";
import { CheckoutStartPageContent } from "@/modules/checkout/presentation/CheckoutStartPageContent";

const mockGetStoreAccessSettings = vi.mocked(getStoreAccessSettings);

describe("CheckoutStartPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStoreAccessSettings.mockResolvedValue(null);
  });

  it("renders a locked notice when checkout is disabled", async () => {
    mockGetStoreAccessSettings.mockResolvedValue({
      settings: {
        checkoutLockEnabled: true,
        checkoutLockMessage: "Temporarily unavailable",
      },
    } as never);

    const html = renderToStaticMarkup(await CheckoutStartPageContent());

    expect(html).toContain("locked:Temporarily unavailable");
  });

  it("renders the checkout start content when checkout is enabled", async () => {
    const html = renderToStaticMarkup(await CheckoutStartPageContent());

    expect(html).toContain("checkout-start");
  });
});
