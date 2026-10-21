import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests co-locate with source as *.test.ts in any workspace package or app.
    // Web tests cover DOM-free modules only, so the node environment suffices.
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
  },
});
