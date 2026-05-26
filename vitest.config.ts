import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Vitest config: we only need to wire the `@/*` path alias defined in
// tsconfig.json (paths: { "@/*": ["src/*"] }) so tests can import via
// `@/features/...` exactly like the source does. The `.js` suffix on the
// TS `import ... from "@/foo/bar.js"` imports is stripped by Vite's resolver.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
