/**
 * Live smoke test for the multimodal endpoint. Skipped by default so the
 * offline suite stays deterministic; opt in with LLM_LIVE=1.
 *
 *   npm run test:live
 *   LLM_IMAGE=./vial.jpg npm run test:live          # use a real vial photo
 *   LLM_BASE_URL=http://host:8080/v1 LLM_MODEL=qwen2-vl npm run test:live
 *
 * With no LLM_IMAGE it sends a 1x1 pixel — enough to prove connectivity, auth,
 * response shape, and that the parser handles the reply (extraction will be
 * empty). Point LLM_IMAGE at a vial photo to verify real field extraction.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type LlmConfig, extractPeptideFromImage } from "./client";

const LIVE = process.env.LLM_LIVE === "1";

const config: LlmConfig = {
  baseUrl: process.env.LLM_BASE_URL ?? "http://rastalinuxai.local:8080/v1",
  model: process.env.LLM_MODEL ?? "local-vlm",
  ...(process.env.LLM_API_KEY ? { apiKey: process.env.LLM_API_KEY } : {}),
};

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

describe.runIf(LIVE)("live LLM extraction (set LLM_LIVE=1)", () => {
  it("reaches the endpoint and returns a parsed peptide object", async () => {
    console.log(`[live] POST ${config.baseUrl}/chat/completions (model=${config.model})`);
    const fields = await extractPeptideFromImage(imageDataUrl(), config);
    console.log("[live] extracted:", JSON.stringify(fields));
    expect(fields).toBeTypeOf("object");
  }, 60_000);
});
