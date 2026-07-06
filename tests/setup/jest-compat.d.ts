import type { Mock as VitestMock, vi } from "vitest";

declare global {
  const jest: typeof vi;

  namespace jest {
    type Mock<
      T extends (...args: unknown[]) => unknown = (...args: unknown[]) => unknown,
    > = VitestMock<T>;
  }
}

export {};
