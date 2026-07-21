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
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // A QR often encodes a bare verification code (e.g. "99252_LDWJLKZ7JKFU")
    // rather than a link — say so instead of a generic "invalid URL".
    if (/^[\w-]+$/.test(trimmed)) {
      return { ok: false, reason: "looks like a verification code, not a web link" };
    }
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
/** A CoA link may point at a landing page; follow at most this many hops to the file. */
const MAX_SCRAPE_HOPS = 1;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Best-effort MIME sniff by magic bytes, for when a server sends no or an opaque
 * (`application/octet-stream`) content-type — common on cheap vendor/S3 hosts.
 * Returns "" when nothing matches (caller keeps the declared type).
 */
function sniffMime(b: Uint8Array): string {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) {
    return "application/pdf"; // %PDF
  }
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return "image/png"; // \x89PNG
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return "image/gif"; // GIF
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 && // RIFF
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  return "";
}

/**
 * Collect candidate CoA file URLs from an HTML page, resolved absolute against
 * `baseUrl`. http(s) only, `data:` URIs skipped, best-first: a file extension
 * and same-origin score up; logos/icons score down. Used to recover the scan
 * when a QR/URL points at a vendor's verification *page* rather than the file
 * (e.g. Janoshik's `<img src="./img/<hash>.png">`).
 */
export function extractCoaCandidates(html: string, baseUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const refs: (string | null)[] = [
    ...Array.from(doc.querySelectorAll("img[src]"), (n) => n.getAttribute("src")),
    ...Array.from(doc.querySelectorAll("a[href]"), (n) => n.getAttribute("href")),
  ];

  const seen = new Set<string>();
  const scored: { url: string; score: number }[] = [];
  for (const ref of refs) {
    if (!ref || ref.startsWith("data:")) continue;
    let abs: URL;
    try {
      abs = new URL(ref, base);
    } catch {
      continue;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    const key = abs.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    const path = abs.pathname.toLowerCase();
    let score = 0;
    if (/\.(png|jpe?g|webp|gif|pdf)$/.test(path)) score += 3;
    if (abs.origin === base.origin) score += 2;
    if (/logo|icon|sprite|favicon/.test(path)) score -= 3;
    scored.push({ url: key, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((c) => c.url);
}

/**
 * Fetch a CoA and return it as an image data URL (rasterizing a PDF if needed).
 * If the URL resolves to an HTML page (a vendor verification/landing page), the
 * page is scraped for the embedded CoA image/PDF and that is fetched instead.
 *
 * @throws {CoaError} On invalid URL, unreachable host, bad status, unsupported
 *   content type, or an over-cap payload.
 */
export async function fetchCoaImage(rawUrl: string, deps: FetchCoaDeps): Promise<string> {
  return fetchCoaImageAt(rawUrl, deps, { depth: 0, seen: new Set() });
}

/** Recursion state for the scrape: current hop depth + URLs already fetched. */
interface ScrapeCtx {
  depth: number;
  seen: Set<string>;
}

async function fetchCoaImageAt(
  rawUrl: string,
  deps: FetchCoaDeps,
  ctx: ScrapeCtx,
): Promise<string> {
  const validation = validateCoaUrl(rawUrl);
  if (!validation.ok) {
    throw new CoaError("invalid-url", `The URL can't be used: ${validation.reason}.`);
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const proxyBase = deps.proxyBase ?? "/coa";
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const url = validation.url;
  ctx.seen.add(url);

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

  const headerMime =
    (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new CoaError("too-large", "The CoA file is too large to process.");
  }

  // Trust an explicit image/pdf/html type; only sniff when the server is vague.
  let mime = headerMime;
  if (!mime || mime === "application/octet-stream" || mime === "binary/octet-stream") {
    mime = sniffMime(bytes) || mime;
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

  // A web page is the common QR/URL case: it points at a vendor verification /
  // landing page, not the file. Scrape it for the embedded CoA and follow that
  // (bounded by MAX_SCRAPE_HOPS + `seen` to avoid loops); only if nothing
  // resolves do we report it as a web page.
  if (mime === "text/html" || mime === "application/xhtml+xml") {
    if (ctx.depth < MAX_SCRAPE_HOPS) {
      const candidates = extractCoaCandidates(new TextDecoder().decode(bytes), url);
      for (const candidate of candidates) {
        if (ctx.seen.has(candidate)) continue;
        try {
          return await fetchCoaImageAt(candidate, deps, {
            depth: ctx.depth + 1,
            seen: ctx.seen,
          });
        } catch {
          // Try the next candidate; fall through to the clear error below.
        }
      }
    }
    throw new CoaError(
      "unsupported-type",
      "That link is a web page, not a CoA image or PDF — link directly to the file.",
    );
  }
  throw new CoaError(
    "unsupported-type",
    `That link didn't return a CoA image or PDF (it was ${mime || "an unknown type"}).`,
  );
}
