import { defineConfig } from "vitest/config";

// Config de tests separada del vite.config (que tiene root: "web" para el editor).
export default defineConfig({
  test: {
    root: ".",
    include: ["src/**/*.test.ts"],
  },
});
