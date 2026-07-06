declare global {
  const jest: {
    fn: typeof import("vitest").vi.fn;
    mock: typeof import("vitest").vi.mock;
    mocked: typeof import("vitest").vi.mocked;
    clearAllMocks: typeof import("vitest").vi.clearAllMocks;
    resetAllMocks: typeof import("vitest").vi.resetAllMocks;
    restoreAllMocks: typeof import("vitest").vi.restoreAllMocks;
    spyOn: typeof import("vitest").vi.spyOn;
  };

  namespace jest {
    type Mock = ReturnType<typeof import("vitest").vi.fn>;
  }
}

export {};
