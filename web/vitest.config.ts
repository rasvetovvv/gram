import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest needs the same `@/` path alias the app and tsconfig use, otherwise a test that pulls in a
// module importing `@/lib/...` fails to resolve it (the Next build resolves `@/` on its own, but
// vitest does not read tsconfig paths without this).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
