import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { createProxyMiddleware } from "http-proxy-middleware";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 7860);

function normalizeApiUrl(value) {
  let url = String(value || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  const parsed = new URL(url);
  if (!parsed.port) parsed.port = "8190";
  return parsed.toString().replace(/\/+$/, "");
}

const apiTarget = normalizeApiUrl(process.env.NEMOFLIX_API_URL || process.env.NEMOFLIX_AMD_API_URL || "");
const app = Fastify({ logger: true });
const distDir = path.join(__dirname, "studio", "dist");

const backendProxy = apiTarget
  ? createProxyMiddleware({
      target: apiTarget,
      changeOrigin: true,
      ws: true,
      logLevel: "warn",
      timeout: 30_000,
      proxyTimeout: 30_000,
      on: {
        error: (err, _req, res) => {
          app.log.error({ err, apiTarget }, "backend proxy error");
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
          }
          res.end(JSON.stringify({ detail: `Backend unavailable: ${err.message}` }));
        },
      },
    })
  : null;

app.addHook("onRequest", async (request, reply) => {
  if (request.url.startsWith("/api/") || request.url === "/api" || request.url.startsWith("/media/") || request.url === "/media") {
    if (!backendProxy) {
      return reply.code(503).send({ detail: "NEMOFLIX_API_URL is not configured" });
    }
    await new Promise((resolve, reject) => backendProxy(request.raw, reply.raw, (err) => err ? reject(err) : resolve()));
    reply.hijack();
  }
});

app.get("/space-health", async () => ({ ok: true, apiConfigured: Boolean(apiTarget), apiTarget: apiTarget || null }));

await app.register(fastifyStatic, { root: distDir, prefix: "/" });

app.setNotFoundHandler((request, reply) => {
  const index = path.join(distDir, "index.html");
  if (fs.existsSync(index)) return reply.type("text/html").send(fs.createReadStream(index));
  return reply.code(404).send("Studio build not found");
});

app.listen({ host: "0.0.0.0", port });
