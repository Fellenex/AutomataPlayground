import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests co-locate with source as *.test.ts. For now only nfa-lang has any;
    // the glob picks up every workspace package under packages/ automatically.
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
  },
});
