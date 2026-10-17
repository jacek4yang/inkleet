import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: { include: ["marked", "@codemirror/merge"] },
  worker: { format: "es" },
});
