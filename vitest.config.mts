import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup/vitest.setup.ts"],
    globals: true,
    include: [
      "tests/unit/**/*.test.ts",
      "tests/unit/**/*.test.tsx",
      "tests/architecture/**/*.test.ts",
      "tests/architecture/**/*.test.tsx",
    ],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    css: true,
    passWithNoTests: false,
  },
});
