import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Toute fuite de stub (fetch, globals) est annulée entre deux tests.
    unstubGlobals: true,
    restoreMocks: true,
  },
});
