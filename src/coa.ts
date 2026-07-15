/**
 * Fetch and normalize a Certificate of Analysis (CoA) referenced by a QR code.
 *
 * The CoA URL comes from an untrusted QR payload, so it is strictly validated
 * (scheme + SSRF host checks) before any request. Because vendor hosts rarely
 * send CORS headers, `fetchCoaImage` tries a direct fetch first and falls back
 * to the same-origin `/coa` proxy (see vite.config.ts). PDFs are rasterized to
 * an image via the injected `rasterizePdf` so the result is always an image
 * data URL ready for the vision model.
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

// IPv4 ranges that must never be fetched from a QR-supplied URL.
const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
];

function isBlockedHost(hostname: string): boolean {
  // URL.hostname keeps IPv6 brackets (e.g. "[::1]"); strip them to compare.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0" || host === "::1" || host === "::") return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  return PRIVATE_V4.some((re) => re.test(host));
}

export type UrlValidation = { ok: true; url: string } | { ok: false; reason: string };

/** Validate a QR-supplied CoA URL: http(s) only, no loopback/private/link-local. */
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
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, reason: `Refusing to fetch a private/loopback host "${parsed.hostname}"` };
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
    throw new CoaError("invalid-url", `The QR code URL can't be used: ${validation.reason}.`);
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
    try {
      response = await fetchImpl(`${proxyBase}?url=${encodeURIComponent(url)}`);
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
