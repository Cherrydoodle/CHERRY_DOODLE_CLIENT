import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": path.join(root, "tests", "server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: { reporter: ["text", "json", "html"] },
    // A couple of tests dynamically import next.config.ts / instrumentation.ts,
    // which pull in enough of the module graph to occasionally exceed the 5s
    // default under parallel CPU contention across the full suite, even though
    // each is fast (<1s) in isolation. This is headroom for load, not a hang.
    testTimeout: 20_000,
  },
});
