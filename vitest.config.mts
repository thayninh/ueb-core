import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.{ts,tsx}",
      "tests/phase-2/**/*.test.ts",
      "tests/phase-3/**/*.test.ts",
      "tests/phase-4/**/*.test.{ts,tsx}",
      "tests/phase-5/**/*.test.ts",
      "tests/phase-6/**/*.test.ts",
      "tests/phase-7/**/*.test.ts",
      "tests/phase-9/**/*.test.ts",
    ],
    setupFiles: ["./vitest.setup.ts"],
  },
});
