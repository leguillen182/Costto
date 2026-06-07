import { defineConfig } from "vite";

// El editor web vive en web/. Reusa el código puro de ../src (calc.ts, types.ts).
export default defineConfig({
  root: "web",
  server: {
    port: 5173,
    open: false,
    proxy: { "/api": "http://localhost:8787" },
  },
  build: { outDir: "../dist-web", emptyOutDir: true },
});
