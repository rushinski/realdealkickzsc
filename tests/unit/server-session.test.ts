import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/repositories/profile-repo", () => ({
  ProfileRepository: vi.fn(),
}));

vi.mock("@/lib/utils/log", () => ({
  logError: vi.fn(),
}));

import { DynamicServerError } from "next/dist/client/components/hooks-server-context";

import { getServerSession } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logError } from "@/lib/utils/log";
import { ProfileRepository } from "@/repositories/profile-repo";

const mockCreateSupabaseServerClient = vi.mocked(createSupabaseServerClient);
const mockProfileRepository = vi.mocked(ProfileRepository);
const mockLogError = vi.mocked(logError);

describe("getServerSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when supabase auth lookup throws", async () => {
    mockCreateSupabaseServerClient.mockRejectedValue(new Error("supabase unavailable"));

    await expect(getServerSession()).resolves.toBeNull();
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it("returns null without logging when next raises a dynamic server error", async () => {
    mockCreateSupabaseServerClient.mockRejectedValue(
      new DynamicServerError(
        "Route /admin/customers couldn't be rendered statically because it used `cookies`.",
      ),
    );

    await expect(getServerSession()).resolves.toBeNull();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("returns session data when auth lookup succeeds", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "user@example.com",
        },
      },
      error: null,
    });
    const mockGetByUserId = vi.fn().mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      role: "admin",
      full_name: "User One",
      tenant_id: "tenant-1",
    });

    mockCreateSupabaseServerClient.mockResolvedValue({
      auth: {
        getUser: mockGetUser,
      },
    } as never);
    mockProfileRepository.mockImplementation(
      function mockProfileRepositoryConstructor() {
        return {
          getByUserId: mockGetByUserId,
        } as never;
      },
    );

    await expect(getServerSession()).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
      },
      profile: {
        id: "user-1",
        email: "user@example.com",
        role: "admin",
        full_name: "User One",
        tenant_id: "tenant-1",
      },
      role: "admin",
    });
  });
});
