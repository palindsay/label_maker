/**
 * Live smoke test / diagnostic for the multimodal endpoint. Skipped by default
 * so the offline suite stays deterministic; opt in with LLM_LIVE=1.
 *
 *   npm run test:live                                   # reachability + text
 *   LLM_MODEL=<vlm-id> LLM_IMAGE=./vial.jpg npm run test:live   # + vision
 *   LLM_BASE_URL=http://host:8080/v1 npm run test:live
 *
 * Notes on the target endpoint (llama-swap in front of llama.cpp):
 *   - It routes by the `model` id; an unknown id returns 404 "no router".
 *   - Image extraction needs a vision model with an mmproj loaded; text-only
 *     models return 500 "image input is not supported". The extraction test
 *     assumes a vision model is available (set LLM_MODEL to pick one) and
 *     degrades gracefully — like the app — when it is not.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { LlmError, extractPeptideFromImage } from "./client";

const LIVE = process.env.LLM_LIVE === "1";
const BASE_URL = process.env.LLM_BASE_URL ?? "http://rastalinuxai.local:8080/v1";
const MODEL = process.env.LLM_MODEL;

// 1x1 transparent PNG — a valid image with no readable content.
const PLACEHOLDER_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function imageDataUrl(): string {
  const path = process.env.LLM_IMAGE;
  if (!path) return PLACEHOLDER_PNG;
  const ext = path.split(".").pop()?.toLowerCase();
  const mime =
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

interface ModelsResponse {
  data?: Array<{ id: string }>;
}

describe.runIf(LIVE)("live endpoint", () => {
  let modelIds: string[] = [];
  let reachError: string | null = null;

  beforeAll(async () => {
    // Tolerate an unreachable endpoint here so a single test reports it cleanly
    // instead of the whole suite crashing in a hook.
    try {
      const res = await fetch(`${BASE_URL}/models`);
      if (!res.ok) {
        reachError = `GET /models returned ${res.status}`;
        return;
      }
      const body = (await res.json()) as ModelsResponse;
      modelIds = (body.data ?? []).map((m) => m.id);
      console.log(`[live] ${modelIds.length} models: ${modelIds.join(", ")}`);
    } catch (err) {
      reachError = err instanceof Error ? err.message : String(err);
    }
  }, 30_000);

  it("is reachable and lists at least one model", () => {
    expect(reachError, `endpoint ${BASE_URL} unreachable: ${reachError}`).toBeNull();
    expect(modelIds.length).toBeGreaterThan(0);
  });

  it("completes a text chat request", async () => {
    const model = MODEL ?? modelIds[0];
    expect(model, "no model available to test").toBeDefined();

    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 16,
      }),
    });
    expect(res.ok, `chat failed: ${res.status} ${await res.clone().text()}`).toBe(true);
  }, 60_000);

  // Assume a multimodal model is available and attempt real extraction; if the
  // endpoint has no vision model (or the id is missing), degrade gracefully —
  // exactly as the app does — rather than hard-failing.
  it("extracts fields from an image, or degrades gracefully without a vision model", async () => {
    const model = MODEL ?? modelIds[0];
    expect(model, "no model available to test").toBeDefined();

    try {
      const fields = await extractPeptideFromImage(imageDataUrl(), {
        baseUrl: BASE_URL,
        model: model as string,
      });
      console.log("[live] extracted:", JSON.stringify(fields));
      expect(fields).toBeTypeOf("object");
    } catch (err) {
      if (err instanceof LlmError && (err.kind === "no-vision" || err.kind === "model-missing")) {
        console.warn(`[live] graceful degrade (${err.kind}): ${err.message}`);
        return;
      }
      throw err;
    }
  }, 90_000);
});
