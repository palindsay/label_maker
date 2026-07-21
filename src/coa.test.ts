import { describe, expect, it, vi } from "vitest";
import { CoaError, extractCoaCandidates, fetchCoaImage, validateCoaUrl } from "./coa";

describe("validateCoaUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(validateCoaUrl("https://coa.vendor.com/lot/A1.pdf")).toEqual({
      ok: true,
      url: "https://coa.vendor.com/lot/A1.pdf",
    });
    expect(validateCoaUrl("http://coa.vendor.com/a.png").ok).toBe(true);
  });

  it("rejects non-http schemes", () => {
    expect(validateCoaUrl("file:///etc/passwd").ok).toBe(false);
    expect(validateCoaUrl("data:text/html,<script>").ok).toBe(false);
    expect(validateCoaUrl("ftp://host/x").ok).toBe(false);
  });

  it("allows loopback/private/LAN hosts (trusted LAN — any host is fine)", () => {
    for (const u of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://192.168.1.10/x",
      "http://172.16.0.1/x",
      "https://rastahp1.local/coa.pdf",
      "http://[::1]/x",
    ]) {
      expect(validateCoaUrl(u).ok, u).toBe(true);
    }
  });

  it("rejects garbage input", () => {
    expect(validateCoaUrl("not a url").ok).toBe(false);
  });

  it("flags a bare verification token distinctly from junk", () => {
    const token = validateCoaUrl("99252_LDWJLKZ7JKFU");
    expect(token.ok).toBe(false);
    if (!token.ok) expect(token.reason).toMatch(/verification code|not a web link/);
    const junk = validateCoaUrl("not a url");
    if (!junk.ok) expect(junk.reason).toBe("Not a valid URL");
  });
});

describe("extractCoaCandidates", () => {
  const PAGE = "https://verify.janoshik.com/tests/99252_TOK";

  it("resolves a relative img src against the page URL", () => {
    expect(extractCoaCandidates('<img src="./img/abc.png">', PAGE)).toEqual([
      "https://verify.janoshik.com/tests/img/abc.png",
    ]);
  });

  it("skips data: URIs and ranks a real file above a logo", () => {
    const html =
      '<img src="data:image/png;base64,AAA"><img src="/logo.png"><a href="/coa.pdf">dl</a>';
    const out = extractCoaCandidates(html, PAGE);
    expect(out[0]).toBe("https://verify.janoshik.com/coa.pdf");
    expect(out.some((u) => u.startsWith("data:"))).toBe(false);
  });

  it("returns nothing when the base URL is unusable", () => {
    expect(extractCoaCandidates('<img src="a.png">', "not a url")).toEqual([]);
  });
});

const URL_OK = "https://coa.vendor.com/lot/A1.pdf";
const rasterizePdf = vi.fn(async () => "data:image/png;base64,RASTER");

function pngResponse() {
  return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
}

function htmlResponse(html: string) {
  return new Response(html, { headers: { "content-type": "text/html" } });
}

/** A Response with raw bytes and an optional (possibly opaque) content-type. */
function bytesResponse(bytes: number[], contentType?: string) {
  return new Response(
    new Uint8Array(bytes),
    contentType ? { headers: { "content-type": contentType } } : undefined,
  );
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // GIF89a
const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]; // RIFF..WEBP

describe("fetchCoaImage", () => {
  it("returns a data URL for an image CoA", async () => {
    const fetchImpl = vi.fn(async () => pngResponse());
    const result = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf });
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("rasterizes a PDF CoA to an image", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([9, 9]), { headers: { "content-type": "application/pdf" } }),
    );
    const result = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf });
    expect(rasterizePdf).toHaveBeenCalled();
    expect(result).toBe("data:image/png;base64,RASTER");
  });

  it("falls back to the /coa proxy when a direct fetch fails (CORS)", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(pngResponse());

    const result = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf });

    expect(result).toMatch(/^data:image\/png/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("/coa?url=");
  });

  it("throws 'unreachable' when both direct and proxy fail", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf }).catch((e) => e);
    expect(err).toBeInstanceOf(CoaError);
    expect(err.kind).toBe("unreachable");
  });

  it("throws 'invalid-url' before fetching for a non-http(s) URL", async () => {
    const fetchImpl = vi.fn();
    const err = await fetchCoaImage("file:///etc/passwd", { fetchImpl, rasterizePdf }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(CoaError);
    expect(err.kind).toBe("invalid-url");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws 'unsupported-type' for non-image/pdf content", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>", { headers: { "content-type": "text/html" } }),
    );
    const err = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf }).catch((e) => e);
    expect(err).toBeInstanceOf(CoaError);
    expect(err.kind).toBe("unsupported-type");
  });

  it("throws 'too-large' when content-length exceeds the cap", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(new Uint8Array([1]), {
          headers: { "content-type": "image/png", "content-length": "99999999" },
        }),
    );
    const err = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf, maxBytes: 1000 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(CoaError);
    expect(err.kind).toBe("too-large");
  });

  it("throws 'not-found' on an error status", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    const err = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf }).catch((e) => e);
    expect(err).toBeInstanceOf(CoaError);
    expect(err.kind).toBe("not-found");
  });

  it("fetches a private/LAN host directly", async () => {
    const fetchImpl = vi.fn(async () => pngResponse());
    const result = await fetchCoaImage("http://rastahp1.local/coa.png", {
      fetchImpl,
      rasterizePdf,
    });
    expect(result).toMatch(/^data:image\/png/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("scrapes the CoA image out of a verification web page (relative img)", async () => {
    const page = "https://verify.janoshik.com/tests/99252_TOK";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse('<img src="./img/HASH.png">'))
      .mockResolvedValueOnce(pngResponse());

    const result = await fetchCoaImage(page, { fetchImpl, rasterizePdf });

    expect(result).toMatch(/^data:image\/png/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // Resolved against the PAGE url, not response.url (which is the proxy path).
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "https://verify.janoshik.com/tests/img/HASH.png",
    );
  });

  it("follows an anchor link to a PDF CoA and rasterizes it", async () => {
    const localRaster = vi.fn(async () => "data:image/png;base64,RASTER");
    const page = "https://verify.janoshik.com/tests/99252_TOK";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse('<a href="https://cdn.example.com/coa.pdf">download</a>'))
      .mockResolvedValueOnce(bytesResponse(PDF_MAGIC, "application/pdf"));

    const result = await fetchCoaImage(page, { fetchImpl, rasterizePdf: localRaster });

    expect(localRaster).toHaveBeenCalled();
    expect(result).toBe("data:image/png;base64,RASTER");
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe("https://cdn.example.com/coa.pdf");
  });

  it("reports a plain web page (no CoA file) clearly, fetching once", async () => {
    const fetchImpl = vi.fn(async () =>
      htmlResponse('<p>nothing here</p><img src="data:image/png;base64,AA">'),
    );
    const err = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf }).catch((e) => e);
    expect(err).toBeInstanceOf(CoaError);
    expect(err.kind).toBe("unsupported-type");
    expect(err.message).toMatch(/web page/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("bounds recursion when two pages link to each other", async () => {
    const A = "https://a.example/tests/a";
    const fetchImpl = vi.fn(async (u: string | URL | Request) =>
      String(u) === A
        ? htmlResponse('<a href="https://a.example/tests/b">b</a>')
        : htmlResponse('<a href="https://a.example/tests/a">a</a>'),
    );
    const err = await fetchCoaImage(A, { fetchImpl, rasterizePdf }).catch((e) => e);
    expect(err).toBeInstanceOf(CoaError);
    expect(err.kind).toBe("unsupported-type");
    expect(fetchImpl).toHaveBeenCalledTimes(2); // A (depth 0) + b (depth 1, not scraped)
  });

  it("does not refetch a self-linking page", async () => {
    const A = "https://a.example/tests/a";
    const fetchImpl = vi.fn(async () =>
      htmlResponse('<a href="https://a.example/tests/a">self</a>'),
    );
    const err = await fetchCoaImage(A, { fetchImpl, rasterizePdf }).catch((e) => e);
    expect(err.kind).toBe("unsupported-type");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("sniffs a PDF served as application/octet-stream", async () => {
    const localRaster = vi.fn(async () => "data:image/png;base64,RASTER");
    const fetchImpl = vi.fn(async () => bytesResponse(PDF_MAGIC, "application/octet-stream"));
    const result = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf: localRaster });
    expect(localRaster).toHaveBeenCalled();
    expect(result).toBe("data:image/png;base64,RASTER");
  });

  it("sniffs a PNG when the content-type is missing", async () => {
    const fetchImpl = vi.fn(async () => bytesResponse(PNG_MAGIC));
    const result = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf });
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("sniffs a JPEG served as octet-stream", async () => {
    const fetchImpl = vi.fn(async () => bytesResponse(JPEG_MAGIC, "application/octet-stream"));
    const result = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf });
    expect(result).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("sniffs GIF and WebP served as octet-stream", async () => {
    const gif = await fetchCoaImage(URL_OK, {
      fetchImpl: vi.fn(async () => bytesResponse(GIF_MAGIC, "application/octet-stream")),
      rasterizePdf,
    });
    expect(gif).toMatch(/^data:image\/gif;base64,/);
    const webp = await fetchCoaImage(URL_OK, {
      fetchImpl: vi.fn(async () => bytesResponse(WEBP_MAGIC, "application/octet-stream")),
      rasterizePdf,
    });
    expect(webp).toMatch(/^data:image\/webp;base64,/);
  });

  it("scrapes via the /coa proxy when the embedded image is CORS-blocked", async () => {
    const page = "https://verify.janoshik.com/tests/99252_TOK";
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse('<img src="./img/HASH.png">')) // page (direct)
      .mockRejectedValueOnce(new TypeError("Failed to fetch")) // image direct → CORS
      .mockResolvedValueOnce(pngResponse()); // image via proxy

    const result = await fetchCoaImage(page, { fetchImpl, rasterizePdf });

    expect(result).toMatch(/^data:image\/png/);
    expect(String(fetchImpl.mock.calls[2]?.[0])).toContain("/coa?url=");
  });

  it("does not let a magic-byte sniff override an explicit content-type", async () => {
    const localRaster = vi.fn(async () => "data:image/png;base64,RASTER");
    // Body is a PDF but the server declares image/png — trust the declared type.
    const fetchImpl = vi.fn(async () => bytesResponse(PDF_MAGIC, "image/png"));
    const result = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf: localRaster });
    expect(localRaster).not.toHaveBeenCalled();
    expect(result).toMatch(/^data:image\/png;base64,/);
  });

  it("reports 'bad-response' when a PDF cannot be rendered", async () => {
    const fetchImpl = vi.fn(async () => bytesResponse(PDF_MAGIC, "application/pdf"));
    const raster = vi.fn(async () => {
      throw new Error("pdf.js blew up");
    });
    const err = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf: raster }).catch((e) => e);
    expect(err).toBeInstanceOf(CoaError);
    expect(err.kind).toBe("bad-response");
  });

  it("reports 'unsupported-type' with the MIME for an unknown file type", async () => {
    const fetchImpl = vi.fn(async () => bytesResponse([1, 2, 3], "application/zip"));
    const err = await fetchCoaImage(URL_OK, { fetchImpl, rasterizePdf }).catch((e) => e);
    expect(err).toBeInstanceOf(CoaError);
    expect(err.kind).toBe("unsupported-type");
    expect(err.message).toMatch(/application\/zip/);
  });

  it("rejects a bare verification token without fetching", async () => {
    const fetchImpl = vi.fn();
    const err = await fetchCoaImage("99252_LDWJLKZ7JKFU", { fetchImpl, rasterizePdf }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(CoaError);
    expect(err.kind).toBe("invalid-url");
    expect(err.message).toMatch(/verification code|not a web link/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
