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
      "/api": { target: process.env.FLIXML_API_URL, changeOrigin: true },
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
