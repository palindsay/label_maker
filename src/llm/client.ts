import { z } from "zod";

/**
 * Thin client for an OpenAI-compatible multimodal (vision) endpoint, used to
 * read peptide facts off a photo of a vial or its supplier label/COA.
 *
 * The base URL is configurable at runtime (the in-app "LLM endpoint" field) and
 * defaults to the LAN inference server. The browser calls it directly, so the
 * endpoint must send CORS headers (LAN inference servers typically do). Set
 * `/v1` (or `VITE_LLM_BASE_URL=/v1`) to instead route via the same-origin Vite
 * proxy, for an endpoint without CORS.
 */
export interface LlmConfig {
  /** Base URL ending in "/v1" (absolute, or a same-origin proxy path). */
  baseUrl: string;
  /** Model name sent to the server (many local servers ignore it). */
  model: string;
  /** Optional bearer token, if the server requires one. */
  apiKey?: string;
}

const env = import.meta.env;

/** Default LAN inference endpoint (OpenAI-compatible, CORS-enabled). */
export const DEFAULT_LLM_BASE_URL = "http://rastalinuxai.local:8081/v1";

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  baseUrl: env.VITE_LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL,
  // Empty means "auto-discover": the endpoint's model roster changes, so rather
  // than hardcode an id we list `GET /v1/models` and pick one at runtime. Set
  // VITE_LLM_MODEL to force a specific id (used as a preference if present).
  model: env.VITE_LLM_MODEL ?? "",
};

/** A model served by the endpoint (from `GET /v1/models`). */
export interface ModelInfo {
  id: string;
  name?: string;
  /** True when the endpoint explicitly advertises image support. */
  vision?: boolean;
}

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
  /** Brand / vendor / manufacturer — printed on a vial, or a CoA's "Manufacturer"/"Client". */
  manufacturer?: string;
  /** Purity, e.g. "99.2%" — typically only present on a CoA, not a vial. */
  purity?: string;
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
  "You read peptide vial labels and Certificates of Analysis (lab test reports). " +
  "Extract only what is clearly printed. Respond with a single JSON object and nothing else.";

const USER_PROMPT =
  "Extract these fields as JSON from the image, which is either a peptide vial label or a " +
  "Certificate of Analysis / lab test report: " +
  '`peptideName` (string, the peptide\'s name, e.g. "BPC-157" or "Ipamorelin"; on a report ' +
  "prefer the full name from the results table over an abbreviated sample name), " +
  "`vialMg` (number, the total milligrams of peptide in the vial — on a vial label the printed " +
  'amount like "10mg"; on a Certificate of Analysis the peptide content / quantity / net peptide / ' +
  'label claim / mg per vial, e.g. 10 from "10 mg". Prefer the CoA amount when reading a report), ' +
  "`manufacturer` (string, the brand / vendor / manufacturer / supplier; on a report use the " +
  '"Manufacturer" field, or "Client" if there is no separate manufacturer, e.g. "utherpeptide.com"), ' +
  '`lot` (string, the lot or batch code, e.g. "IP10-0106"), ' +
  '`purity` (string, the assay purity, e.g. "99.8%"). ' +
  "Omit any field you cannot read with confidence.";

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
    manufacturer: z.string().trim().min(1).optional(),
    purity: z.union([z.string(), z.number()]).optional(),
  })
  .partial();

/** Normalize purity to a display string, appending "%" to a bare number. */
function coercePurity(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}%`;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

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
  if (parsed.data.manufacturer) result.manufacturer = parsed.data.manufacturer;
  const mg = coerceMg(parsed.data.vialMg);
  if (mg !== undefined) result.vialMg = mg;
  const purity = coercePurity(parsed.data.purity);
  if (purity !== undefined) result.purity = purity;
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

function authHeaders(config: LlmConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

const modelsResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        // Some endpoints (e.g. llama-swap) advertise per-model capabilities.
        capabilities: z.object({ vision: z.boolean() }).partial().optional(),
      }),
    )
    .min(1),
});

/**
 * Discover the models the endpoint currently serves. The roster is not fixed
 * (it may be Gemma 4 31B, a Qwen VL, LLaVA, …), so callers list at runtime
 * rather than assuming an id.
 *
 * @throws {LlmError} `unreachable` / non-OK status / `bad-response`.
 */
export async function listModels(
  config: LlmConfig = DEFAULT_LLM_CONFIG,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelInfo[]> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/models`, { headers: authHeaders(config) });
  } catch (err) {
    throw new LlmError(
      "unreachable",
      "Could not reach the inference endpoint to list its models.",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw classifyHttpError(response.status, detail);
  }

  const parsed = modelsResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new LlmError(
      "bad-response",
      "The inference endpoint returned an unexpected model list.",
      parsed.error.message,
    );
  }

  return parsed.data.data.map((m) => {
    const info: ModelInfo = { id: m.id };
    if (m.name !== undefined) info.name = m.name;
    if (m.capabilities?.vision !== undefined) info.vision = m.capabilities.vision;
    return info;
  });
}

// Substrings that hint a model can accept images. Best-effort only: endpoints
// rarely advertise vision in metadata, and some models (e.g. this Qwen build)
// are multimodal despite a text-sounding name — so this only *ranks* the auto
// pick; the user can always override with a different discovered model.
const VISION_HINTS = [
  "vl",
  "vision",
  "gemma",
  "llava",
  "internvl",
  "pixtral",
  "moondream",
  "smolvlm",
  "minicpm-v",
  "minicpm-o",
];

function looksLikeVision(model: ModelInfo): boolean {
  const s = `${model.id} ${model.name ?? ""}`.toLowerCase();
  return VISION_HINTS.some((hint) => s.includes(hint));
}

/**
 * Choose which discovered model to use for image extraction:
 *   1. `preferred` if the endpoint serves it,
 *   2. otherwise the first model the endpoint flags `vision: true`,
 *   3. otherwise the first model whose name looks vision-capable,
 *   4. otherwise the first model available.
 * Returns `undefined` only when the list is empty.
 */
export function pickVisionModel(models: ModelInfo[], preferred?: string): string | undefined {
  if (models.length === 0) return undefined;
  if (preferred) {
    const exact = models.find((m) => m.id === preferred);
    if (exact) return exact.id;
  }
  const flagged = models.find((m) => m.vision === true);
  if (flagged) return flagged.id;
  const named = models.find(looksLikeVision);
  return (named ?? models[0])?.id;
}

/**
 * Resolve a concrete model id, discovering the roster when `config.model` is
 * empty ("auto").
 *
 * @throws {LlmError} If discovery fails or the endpoint serves no models.
 */
export async function resolveVisionModel(
  config: LlmConfig = DEFAULT_LLM_CONFIG,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const models = await listModels(config, fetchImpl);
  const picked = pickVisionModel(models, config.model || undefined);
  if (!picked) {
    throw new LlmError(
      "model-missing",
      "The inference endpoint is not serving any models. Enter the label details manually.",
    );
  }
  return picked;
}

/**
 * Send a vial image to a vision model and return whatever peptide fields it
 * could read. `fetchImpl` is injectable for testing.
 *
 * If `config.model` is empty it auto-discovers a model from the endpoint.
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
  const model = config.model || (await resolveVisionModel(config, fetchImpl));
  const requestConfig: LlmConfig = model === config.model ? config : { ...config, model };
  const headers = authHeaders(requestConfig);

  let response: Response;
  try {
    response = await fetchImpl(`${requestConfig.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildVisionRequest(imageDataUrl, requestConfig)),
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
