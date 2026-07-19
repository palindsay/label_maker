/**
 * Fetch and normalize a Certificate of Analysis (CoA) — either entered as a URL
 * or decoded from a vial's QR code.
 *
 * The app runs on a trusted private LAN, so URLs are validated for scheme only
 * (http/https) — any host is allowed, including LAN/private addresses where CoAs
 * are often hosted. Because vendor hosts rarely send CORS headers, `fetchCoaImage`
 * tries a direct fetch first and falls back to the same-origin `/coa` proxy (see
 * vite.config.ts). PDFs are rasterized to an image via the injected `rasterizePdf`
 * so the result is always an image data URL ready for the vision model.
 */

export type CoaFailureKind =
  | "invalid-url"
  | "unreachable"
  | "unsupported-type"
  | "too-large"
  | "not-found"
  | "bad-response";

/** A failure fetching/reading a CoA. `message` is safe to show the user. */
export class CoaError extends Error {
  readonly kind: CoaFailureKind;
  readonly detail: string | undefined;

  constructor(kind: CoaFailureKind, message: string, detail?: string) {
    super(message);
    this.name = "CoaError";
    this.kind = kind;
    this.detail = detail;
  }
}

export type UrlValidation = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Validate a CoA/image URL: http(s) scheme only. Any host is allowed (the app
 * runs on a trusted private LAN, so LAN/private CoA hosts must resolve). The
 * scheme check keeps `file:`/`data:`/junk out of the fetch path.
 */
export function validateCoaUrl(raw: string): UrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `Unsupported URL scheme "${parsed.protocol}"` };
  }
  return { ok: true, url: parsed.toString() };
}

export interface FetchCoaDeps {
  /** Rasterize a PDF's first page to an image data URL (browser/pdf.js glue). */
  rasterizePdf: (bytes: Uint8Array) => Promise<string>;
  fetchImpl?: typeof fetch;
  /** Same-origin proxy path used when a direct cross-origin fetch is blocked. */
  proxyBase?: string;
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Fetch a CoA and return it as an image data URL (rasterizing a PDF if needed).
 *
 * @throws {CoaError} On invalid URL, unreachable host, bad status, unsupported
 *   content type, or an over-cap payload.
 */
export async function fetchCoaImage(rawUrl: string, deps: FetchCoaDeps): Promise<string> {
  const validation = validateCoaUrl(rawUrl);
  if (!validation.ok) {
    throw new CoaError("invalid-url", `The URL can't be used: ${validation.reason}.`);
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const proxyBase = deps.proxyBase ?? "/coa";
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const url = validation.url;

  // Try direct; on a network/CORS throw, retry via the same-origin proxy.
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    const proxyUrl = `${proxyBase}?url=${encodeURIComponent(url)}`;
    try {
      response = await fetchImpl(proxyUrl);
    } catch (proxyErr) {
      throw new CoaError(
        "unreachable",
        "Could not fetch the CoA — it may be blocked by CORS or the host is unreachable.",
        proxyErr instanceof Error ? proxyErr.message : String(proxyErr),
      );
    }
  }

  if (!response.ok) {
    throw new CoaError("not-found", `The CoA URL returned status ${response.status}.`);
  }

  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > maxBytes) {
    throw new CoaError("too-large", "The CoA file is too large to process.");
  }

  const mime =
    (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new CoaError("too-large", "The CoA file is too large to process.");
  }

  if (mime.startsWith("image/")) {
    return `data:${mime};base64,${bytesToBase64(bytes)}`;
  }

  if (mime === "application/pdf") {
    try {
      return await deps.rasterizePdf(bytes);
    } catch (err) {
      throw new CoaError(
        "bad-response",
        "The CoA PDF could not be rendered.",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  throw new CoaError("unsupported-type", `The CoA is an unsupported type (${mime || "unknown"}).`);
}
