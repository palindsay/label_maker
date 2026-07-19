import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { validateCoaUrl } from "./src/coa";

// OpenAI-compatible multimodal endpoint. The browser calls the same-origin
// "/v1" path and the dev/preview server proxies it here, avoiding CORS.
// Edit this to point at your endpoint.
const LLM_TARGET = "http://rastalinuxai.local:8080";

const proxy = {
  "/v1": { target: LLM_TARGET, changeOrigin: true },
};

// Minimal request/response shapes so this file needs no @types/node.
interface ProxyReq {
  url?: string | undefined;
}
interface ProxyRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: unknown): void;
}

/**
 * Same-origin `/coa?url=<CoA URL>` proxy. The URL is re-validated here (http/https
 * scheme only) before the dev/preview server fetches it. This runs server-side, so
 * it sidesteps the browser CORS that blocks a direct cross-origin CoA fetch. Any
 * host is allowed — this is an intentional open fetch proxy for the trusted LAN, so
 * only run dev/preview on a network you trust. Not present in a static production
 * build (direct fetch only, like /v1).
 */
function coaProxyPlugin(): Plugin {
  const handler = async (req: ProxyReq, res: ProxyRes, next: () => void) => {
    const target = new URL(req.url ?? "", "http://localhost").searchParams.get("url");
    if (!target) return next();

    const validation = validateCoaUrl(target);
    if (!validation.ok) {
      res.statusCode = 400;
      res.end(validation.reason);
      return;
    }

    try {
      const upstream = await fetch(validation.url);
      res.statusCode = upstream.status;
      const contentType = upstream.headers.get("content-type");
      if (contentType) res.setHeader("content-type", contentType);
      res.end(new Uint8Array(await upstream.arrayBuffer()));
    } catch {
      res.statusCode = 502;
      res.end("CoA fetch failed");
    }
  };

  return {
    name: "coa-proxy",
    configureServer(server) {
      server.middlewares.use("/coa", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/coa", handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), coaProxyPlugin()],
  // `host: true` binds 0.0.0.0 so anyone on the LAN can reach the app (and the
  // /v1 + /coa proxies) via this host's IP. Only run on a network you trust.
  // Access by IP works out of the box; Vite blocks non-IP Host headers by
  // default (DNS-rebind guard). The leading-dot `allowedHosts` entry permits
  // this host's mDNS name and any other `*.local` name on the trusted LAN.
  server: { host: true, allowedHosts: [".local"], proxy },
  preview: { host: true, allowedHosts: [".local"], proxy },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/main.tsx",
        "src/vite-env.d.ts",
        // Browser-only glue (canvas / pdf.js worker): exercised by build + live.
        "src/browser.ts",
      ],
    },
  },
});
