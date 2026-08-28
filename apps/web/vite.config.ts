import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the shared package to its TS source so Vite transpiles it directly.
      "@automata/nfa-lang": fileURLToPath(
        new URL("../../packages/nfa-lang/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true, // fail loudly instead of drifting to another port
    proxy: {
      "/api": "http://localhost:3999",
    },
  },
});
