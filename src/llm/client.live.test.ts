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
import {
  LlmError,
  type ModelInfo,
  extractPeptideFromImage,
  listModels,
  pickVisionModel,
} from "./client";

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

describe.runIf(LIVE)("live endpoint", () => {
  const config = { baseUrl: BASE_URL, model: MODEL ?? "" };
  let models: ModelInfo[] = [];
  let reachError: string | null = null;

  beforeAll(async () => {
    // Exercise the real discovery path. Tolerate an unreachable endpoint here so
    // a single test reports it cleanly instead of the whole suite crashing.
    try {
      models = await listModels(config);
      console.log(`[live] ${models.length} models: ${models.map((m) => m.id).join(", ")}`);
    } catch (err) {
      reachError = err instanceof Error ? err.message : String(err);
    }
  }, 30_000);

  it("is reachable and lists at least one model", () => {
    expect(reachError, `endpoint ${BASE_URL} unreachable: ${reachError}`).toBeNull();
    expect(models.length).toBeGreaterThan(0);
  });

  it("completes a text chat request", async () => {
    const model = MODEL ?? pickVisionModel(models);
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

  // Assume a multimodal model is available and attempt real extraction (the
  // client auto-discovers a model from config.model=""). If the endpoint has no
  // vision model, degrade gracefully — exactly as the app does.
  it("extracts fields from an image, or degrades gracefully without a vision model", async () => {
    console.log(`[live] auto-picked model: ${pickVisionModel(models) ?? "(none)"}`);

    try {
      const fields = await extractPeptideFromImage(imageDataUrl(), config);
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
