import { defineConfig } from "vitest/config";

// Config de tests separada del vite.config (que tiene root: "web" para el editor).
export default defineConfig({
  test: {
    root: ".",
    include: ["src/**/*.test.ts", "web/**/*.test.ts"],
    // Los tests de src/ son lógica pura/node; solo los de web/ necesitan DOM.
    environment: "node",
    environmentMatchGlobs: [["web/**", "jsdom"]],
  },
});
