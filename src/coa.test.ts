import { describe, expect, it, vi } from "vitest";
import { CoaError, fetchCoaImage, validateCoaUrl } from "./coa";

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
});

const URL_OK = "https://coa.vendor.com/lot/A1.pdf";
const rasterizePdf = vi.fn(async () => "data:image/png;base64,RASTER");

function pngResponse() {
  return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
}

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
});
