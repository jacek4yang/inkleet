import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: { include: ["marked", "@codemirror/merge", "@lezer/highlight"] },
  worker: { format: "es" },
});
