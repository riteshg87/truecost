import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Keep browser-like lifecycle tests from competing with dozens of workers
  // on developer laptops and small CI runners.
  test: { maxWorkers: 4 },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
