import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/server/index.ts",
    outDir: "dist-server",
    target: "node24",
    rollupOptions: { output: { entryFileNames: "index.js" } },
  },
  ssr: { noExternal: ["hono", "@hono/node-server"] },
});
