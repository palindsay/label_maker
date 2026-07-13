import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// OpenAI-compatible multimodal endpoint. The browser calls the same-origin
// "/v1" path and the dev/preview server proxies it here, avoiding CORS.
// Edit this to point at your endpoint.
const LLM_TARGET = "http://rastalinuxai.local:8080";

const proxy = {
  "/v1": { target: LLM_TARGET, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/main.tsx", "src/vite-env.d.ts"],
    },
  },
});
