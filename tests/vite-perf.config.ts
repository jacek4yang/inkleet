import {defineConfig} from "vite";
import {fileURLToPath} from "node:url";
// Copied to repository root only by the instrumented performance workflow.
export default defineConfig({optimizeDeps:{include:["marked","@codemirror/merge"]},
 resolve:{alias:[{find:/^@tauri-apps\/api\/core$/,replacement:fileURLToPath(new URL("./tests/perf-tauri-core.ts",import.meta.url))}]}});
