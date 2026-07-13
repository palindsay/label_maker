import { z } from "zod";

/**
 * Thin client for an OpenAI-compatible multimodal (vision) endpoint, used to
 * read peptide facts off a photo of a vial or its supplier label/COA.
 *
 * By default it targets "/v1", which the Vite dev/preview server proxies to the
 * configured host (see vite.config.ts) — this keeps requests same-origin and
 * avoids browser CORS. Override via VITE_LLM_BASE_URL to call a host directly.
 */
export interface LlmConfig {
  /** Base URL ending in "/v1" (or a same-origin proxy path). */
  baseUrl: string;
  /** Model name sent to the server (many local servers ignore it). */
  model: string;
  /** Optional bearer token, if the server requires one. */
  apiKey?: string;
}

const env = import.meta.env;

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: env.VITE_LLM_BASE_URL ?? "/v1",
  // Must be a real, vision-capable model id served by the endpoint
  // (see `GET /v1/models`). Override with VITE_LLM_MODEL.
  model: env.VITE_LLM_MODEL ?? "gemma-4-31b",
};

/**
 * Why image auto-fill failed. The app assumes a multimodal model is available
 * and only branches on these when it turns out not to be:
 *   - `unreachable`    the endpoint could not be contacted (DNS/refused/offline)
 *   - `no-vision`      the model has no image support (no mmproj loaded)
 *   - `model-missing`  the configured model id is not served by the endpoint
 *   - `bad-response`   the endpoint replied in an unexpected shape
 *   - `unknown`        any other non-OK response
 */
export type LlmFailureKind =
  | "unreachable"
  | "no-vision"
  | "model-missing"
  | "bad-response"
  | "unknown";

/**
 * A failure of image auto-fill. `message` is safe to show the user; `kind`
 * lets callers branch; `detail` carries the raw server text for logs.
 */
export class LlmError extends Error {
  readonly kind: LlmFailureKind;
  readonly detail: string | undefined;

  constructor(kind: LlmFailureKind, message: string, detail?: string) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.detail = detail;
  }
}

/** Fields we attempt to read from an image; all optional. */
export interface ExtractedPeptide {
  peptideName?: string;
  vialMg?: number;
  lot?: string;
}

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatMessage {
  role: "system" | "user";
  content: string | ContentPart[];
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  response_format: { type: "json_object" };
}

const SYSTEM_PROMPT =
  "You read peptide vial labels. Extract only what is clearly printed. " +
  "Respond with a single JSON object and nothing else.";

const USER_PROMPT =
  "Extract these fields from the vial image as JSON: " +
  '`peptideName` (string, e.g. "BPC-157"), `vialMg` (number, total milligrams in the vial), ' +
  "`lot` (string, batch/lot code). Omit any field you cannot read with confidence.";

/** Build the chat-completions request body for a data-URL image. */
export function buildVisionRequest(imageDataUrl: string, config: LlmConfig): ChatCompletionRequest {
  return {
    model: config.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: USER_PROMPT },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  };
}

/** Pull the first number out of a value that may be a number or a string like "5 mg". */
function coerceMg(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const match = value.match(/\d+(?:\.\d+)?/);
    if (match) {
      const n = Number.parseFloat(match[0]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

const rawSchema = z
  .object({
    peptideName: z.string().trim().min(1).optional(),
    vialMg: z.union([z.number(), z.string()]).optional(),
    lot: z.string().trim().min(1).optional(),
  })
  .partial();

/**
 * Parse the model's message content into an {@link ExtractedPeptide}. Tolerant
 * of markdown code fences and of `vialMg` returned as a string; returns an
 * empty object rather than throwing on anything it cannot use.
 */
export function parseExtractionContent(content: string): ExtractedPeptide {
  const stripped = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch {
    return {};
  }

  const parsed = rawSchema.safeParse(raw);
  if (!parsed.success) return {};

  const result: ExtractedPeptide = {};
  if (parsed.data.peptideName) result.peptideName = parsed.data.peptideName;
  if (parsed.data.lot) result.lot = parsed.data.lot;
  const mg = coerceMg(parsed.data.vialMg);
  if (mg !== undefined) result.vialMg = mg;
  return result;
}

const chatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

/** Map a non-OK HTTP response to a typed, user-facing failure. */
function classifyHttpError(status: number, body: string): LlmError {
  const b = body.toLowerCase();

  // Text-only model / no mmproj: the endpoint can't accept images at all.
  if (/image input is not supported|mmproj|does not support image|no vision/.test(b)) {
    return new LlmError(
      "no-vision",
      "The inference endpoint has no multimodal (vision) model loaded, so it can't read the photo. Enter the label details manually.",
      body,
    );
  }

  // Unknown model id (e.g. llama-swap "no router for requested model").
  if (status === 404 || /no router|unknown model|model not found/.test(b)) {
    return new LlmError(
      "model-missing",
      "The configured vision model isn't available on the inference endpoint. Enter the label details manually.",
      body,
    );
  }

  return new LlmError(
    "unknown",
    `Image auto-fill failed (status ${status}). Enter the label details manually.`,
    body,
  );
}

/**
 * Send a vial image to the vision model and return whatever peptide fields it
 * could read. `fetchImpl` is injectable for testing.
 *
 * Assumes a multimodal model is available; when it is not (or the endpoint is
 * unreachable / misbehaving) it throws a typed {@link LlmError} whose `message`
 * is safe to show the user, so callers can degrade to manual entry.
 *
 * @throws {LlmError} On any failure to obtain an extraction.
 */
export async function extractPeptideFromImage(
  imageDataUrl: string,
  config: LlmConfig = DEFAULT_LLM_CONFIG,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractedPeptide> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildVisionRequest(imageDataUrl, config)),
    });
  } catch (err) {
    throw new LlmError(
      "unreachable",
      "Could not reach the inference endpoint. Check it is running, then enter the label details manually.",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw classifyHttpError(response.status, detail);
  }

  const parsed = chatResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new LlmError(
      "bad-response",
      "The inference endpoint returned an unexpected response. Enter the label details manually.",
      parsed.error.message,
    );
  }

  const first = parsed.data.choices[0];
  if (!first) {
    throw new LlmError("bad-response", "The inference endpoint returned no choices.");
  }
  return parseExtractionContent(first.message.content);
}
