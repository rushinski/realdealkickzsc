import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { redirect } from "next/navigation";

import { getServerSession } from "@/lib/auth/session";
import { getStoreAccessSettings } from "@/lib/store-access/get-store-access-settings";
import { CheckoutGatePageContent } from "@/modules/checkout/presentation/CheckoutGatePageContent";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/store-access/get-store-access-settings", () => ({
  getStoreAccessSettings: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/modules/checkout/presentation/components/CheckoutLockedNotice", () => ({
  CheckoutLockedNotice: ({ message }: { message: string }) => `locked:${message}`,
}));

vi.mock("@/modules/checkout/presentation/components/CheckoutGate", () => ({
  CheckoutGate: () => "checkout-gate",
}));

const mockRedirect = vi.mocked(redirect);
const mockGetServerSession = vi.mocked(getServerSession);
const mockGetStoreAccessSettings = vi.mocked(getStoreAccessSettings);

describe("CheckoutGatePageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStoreAccessSettings.mockResolvedValue(null);
    mockGetServerSession.mockResolvedValue(null);
  });

  it("renders a locked notice when checkout is disabled", async () => {
    mockGetStoreAccessSettings.mockResolvedValue({
      settings: {
        checkoutLockEnabled: true,
        checkoutLockMessage: "Temporarily unavailable",
      },
    } as never);

    const html = renderToStaticMarkup(await CheckoutGatePageContent());

    expect(html).toContain("locked:Temporarily unavailable");
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("redirects authenticated users to checkout start", async () => {
    mockGetServerSession.mockResolvedValue({
      user: {
        id: "user-1",
        email: "user@example.com",
      },
      profile: null,
      role: "customer",
    } as never);

    await CheckoutGatePageContent();

    expect(mockRedirect).toHaveBeenCalledWith("/checkout/start");
  });

  it("renders the checkout gate for anonymous users", async () => {
    const html = renderToStaticMarkup(await CheckoutGatePageContent());

    expect(html).toContain("checkout-gate");
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
