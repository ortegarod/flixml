import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3011,
    proxy: {
      "/api": {
        target: process.env.FLIXML_API_URL,
        changeOrigin: true,
        // An API restart cuts the GET /api/events stream mid-body, and the proxy would
        // leave the browser's side of it open: the tab would never learn to reconnect.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            proxyRes.on("close", () => {
              if (!proxyRes.complete) res.destroy();
            });
          });
        },
      },
      "/docs": { target: process.env.FLIXML_API_URL, changeOrigin: true },
      "/redoc": { target: process.env.FLIXML_API_URL, changeOrigin: true },
      "/openapi.json": { target: process.env.FLIXML_API_URL, changeOrigin: true },
      "/media": { target: process.env.FLIXML_API_URL, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
