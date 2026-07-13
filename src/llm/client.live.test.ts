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
 *     models return 500 "image input is not supported". The vision test is
 *     therefore gated on LLM_MODEL — point it at a vision-capable id.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPeptideFromImage } from "./client";

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

  beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/models`);
    if (res.ok) {
      const body = (await res.json()) as ModelsResponse;
      modelIds = (body.data ?? []).map((m) => m.id);
      console.log(`[live] ${modelIds.length} models: ${modelIds.join(", ")}`);
    }
  }, 30_000);

  it("is reachable and lists at least one model", async () => {
    const res = await fetch(`${BASE_URL}/models`);
    expect(res.ok).toBe(true);
    expect(modelIds.length).toBeGreaterThan(0);
  }, 30_000);

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

  it.runIf(MODEL)(
    `extracts peptide fields from an image (model=${MODEL ?? "?"})`,
    async () => {
      const model = MODEL as string; // guaranteed present by it.runIf(MODEL)
      const fields = await extractPeptideFromImage(imageDataUrl(), {
        baseUrl: BASE_URL,
        model,
      });
      console.log("[live] extracted:", JSON.stringify(fields));
      expect(fields).toBeTypeOf("object");
    },
    90_000,
  );

  it.skipIf(MODEL)("vision extraction (skipped — set LLM_MODEL to a vision model)", () => {
    console.warn(
      "[live] Skipping image extraction: set LLM_MODEL to a vision-capable id " +
        "(the endpoint currently serves text-only models — none accept images).",
    );
  });
});
