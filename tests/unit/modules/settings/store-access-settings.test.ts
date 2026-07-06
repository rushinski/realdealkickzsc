import { describe, expect, it, vi, type Mock } from "vitest";

import { StoreAccessSettingsRepository } from "@/repositories/store-access-settings-repo";
import { DEFAULT_CHECKOUT_LOCK_MESSAGE } from "@/modules/settings/shared/storeAccessSettings";
import { StoreAccessSettingsService } from "@/services/store-access-settings-service";

type SelectChain = {
  select: Mock<(value: string) => SelectChain>;
  eq: Mock<(column: string, value: string) => SelectChain>;
  maybeSingle: Mock<() => Promise<{ data: unknown; error: unknown }>>;
};

function createSupabaseMock(result: { data: unknown; error: unknown }) {
  const chain: SelectChain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };

  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue(result);

  return {
    from: vi.fn(() => chain),
  };
}

describe("StoreAccessSettingsRepository", () => {
  it("returns defaults when a tenant has no persisted settings", async () => {
    const supabase = createSupabaseMock({ data: null, error: null });
    const repo = new StoreAccessSettingsRepository(supabase as never);

    await expect(repo.getByTenant("tenant-1")).resolves.toEqual({
      checkoutLockEnabled: false,
      checkoutLockMessage: DEFAULT_CHECKOUT_LOCK_MESSAGE,
    });
  });
});

describe("StoreAccessSettingsService", () => {
  it("treats checkout lock as a direct toggle", () => {
    const service = new StoreAccessSettingsService({} as never);

    expect(service.isCheckoutLocked({ checkoutLockEnabled: true })).toBe(true);
    expect(service.isCheckoutLocked({ checkoutLockEnabled: false })).toBe(false);
  });
});
