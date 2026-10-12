import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // Every test file shares one database and truncates it, so files must not run concurrently.
    fileParallelism: false,
  },
});
