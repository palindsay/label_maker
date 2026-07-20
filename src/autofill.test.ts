import { describe, expect, it, vi } from "vitest";
import { autofillFromPhoto, autofillFromUrl } from "./autofill";

const PHOTO = "data:image/png;base64,PHOTO";
const COA_IMG = "data:image/png;base64,COA";

function deps(over: Partial<Parameters<typeof autofillFromPhoto>[1]> = {}) {
  return {
    decodeQr: vi.fn(async () => null),
    extractFromImage: vi.fn(async () => ({})),
    fetchCoaImage: vi.fn(async () => COA_IMG),
    ...over,
  };
}

describe("autofillFromPhoto", () => {
  it("returns only vial fields when there is no QR code", async () => {
    const d = deps({
      decodeQr: vi.fn(async () => null),
      extractFromImage: vi.fn(async () => ({ peptideName: "BPC-157", vialMg: 5 })),
    });

    const result = await autofillFromPhoto(PHOTO, d);

    expect(result.coaUrl).toBeNull();
    expect(result.fields).toEqual({ peptideName: "BPC-157", vialMg: 5 });
    expect(d.fetchCoaImage).not.toHaveBeenCalled();
  });

  it("reads the CoA from the QR URL and merges it (CoA wins)", async () => {
    const d = deps({
      decodeQr: vi.fn(async () => "https://coa.vendor.com/a.pdf"),
      // vial photo vs CoA: same peptide, CoA adds lot + purity
      extractFromImage: vi
        .fn()
        .mockResolvedValueOnce({ peptideName: "BPC-157", vialMg: 5 })
        .mockResolvedValueOnce({ peptideName: "BPC-157", lot: "A1234", purity: "99.2%" }),
    });

    const result = await autofillFromPhoto(PHOTO, d);

    expect(d.fetchCoaImage).toHaveBeenCalledWith("https://coa.vendor.com/a.pdf");
    expect(result.coaUrl).toBe("https://coa.vendor.com/a.pdf");
    expect(result.fields).toEqual({
      peptideName: "BPC-157",
      vialMg: 5,
      lot: "A1234",
      purity: "99.2%",
    });
    expect(result.mismatches).toEqual([]);
  });

  it("fills the manufacturer from the CoA when the photo lacks it", async () => {
    const d = deps({
      decodeQr: vi.fn(async () => "https://coa.vendor.com/a.pdf"),
      extractFromImage: vi
        .fn()
        .mockResolvedValueOnce({ peptideName: "Ipamorelin", vialMg: 10 })
        .mockResolvedValueOnce({
          peptideName: "Ipamorelin",
          manufacturer: "utherpeptide.com",
          lot: "IP10-0106",
          purity: "99.780%",
        }),
    });

    const result = await autofillFromPhoto(PHOTO, d);

    expect(result.fields.manufacturer).toBe("utherpeptide.com");
    expect(result.mismatches).toEqual([]);
  });

  it("flags a manufacturer disagreement between the photo and the CoA (CoA wins)", async () => {
    const d = deps({
      decodeQr: vi.fn(async () => "https://coa.vendor.com/a.pdf"),
      extractFromImage: vi
        .fn()
        .mockResolvedValueOnce({ peptideName: "Ipamorelin", manufacturer: "Acme Labs" })
        .mockResolvedValueOnce({ peptideName: "Ipamorelin", manufacturer: "utherpeptide.com" }),
    });

    const result = await autofillFromPhoto(PHOTO, d);

    expect(result.fields.manufacturer).toBe("utherpeptide.com");
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatch(/Manufacturer/);
  });

  it("flags a mismatch between the photo and the CoA (CoA wins)", async () => {
    const d = deps({
      decodeQr: vi.fn(async () => "https://coa.vendor.com/a.pdf"),
      extractFromImage: vi
        .fn()
        .mockResolvedValueOnce({ peptideName: "BPC-157", vialMg: 5 })
        .mockResolvedValueOnce({ peptideName: "BPC-157", vialMg: 10 }),
    });

    const result = await autofillFromPhoto(PHOTO, d);

    expect(result.fields.vialMg).toBe(10);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0]).toMatch(/5.*10/);
  });

  it("keeps vial fields and records an error when the CoA fetch fails", async () => {
    const d = deps({
      decodeQr: vi.fn(async () => "https://coa.vendor.com/a.pdf"),
      extractFromImage: vi.fn(async () => ({ peptideName: "BPC-157", vialMg: 5 })),
      fetchCoaImage: vi.fn(async () => {
        throw new Error("CoA blocked by CORS");
      }),
    });

    const result = await autofillFromPhoto(PHOTO, d);

    expect(result.fields).toEqual({ peptideName: "BPC-157", vialMg: 5 });
    expect(result.errors.join(" ")).toMatch(/CoA blocked by CORS/);
  });

  it("still uses the CoA when the vial photo extraction fails", async () => {
    const d = deps({
      decodeQr: vi.fn(async () => "https://coa.vendor.com/a.pdf"),
      extractFromImage: vi
        .fn()
        .mockRejectedValueOnce(new Error("photo unreadable"))
        .mockResolvedValueOnce({ peptideName: "TB-500", lot: "Z9" }),
    });

    const result = await autofillFromPhoto(PHOTO, d);

    expect(result.fields).toEqual({ peptideName: "TB-500", lot: "Z9" });
    expect(result.errors.join(" ")).toMatch(/photo unreadable/);
  });

  it("emits the reading-photo stage when there is no QR", async () => {
    const onStage = vi.fn();
    await autofillFromPhoto(PHOTO, deps({ onStage }));
    expect(onStage.mock.calls.map((c) => c[0])).toEqual(["reading-photo"]);
  });

  it("emits photo → fetching-coa → reading-coa when a QR resolves", async () => {
    const onStage = vi.fn();
    await autofillFromPhoto(
      PHOTO,
      deps({ decodeQr: vi.fn(async () => "https://coa.vendor.com/a.pdf"), onStage }),
    );
    expect(onStage.mock.calls.map((c) => c[0])).toEqual([
      "reading-photo",
      "fetching-coa",
      "reading-coa",
    ]);
  });
});

const URL_IN = "https://coa.vendor.com/lot/A1.pdf";

describe("autofillFromUrl", () => {
  it("fetches the URL, extracts, and returns the fields", async () => {
    const d = {
      fetchCoaImage: vi.fn(async () => COA_IMG),
      extractFromImage: vi.fn(async () => ({ peptideName: "BPC-157", vialMg: 5, lot: "A1" })),
    };

    const result = await autofillFromUrl(URL_IN, d);

    expect(d.fetchCoaImage).toHaveBeenCalledWith(URL_IN);
    expect(d.extractFromImage).toHaveBeenCalledWith(COA_IMG);
    expect(result.fields).toEqual({ peptideName: "BPC-157", vialMg: 5, lot: "A1" });
    expect(result.coaUrl).toBe(URL_IN);
    expect(result.errors).toEqual([]);
  });

  it("records an error and leaves fields empty when the fetch fails", async () => {
    const d = {
      fetchCoaImage: vi.fn(async () => {
        throw new Error("URL returned status 404");
      }),
      extractFromImage: vi.fn(async () => ({ peptideName: "X" })),
    };

    const result = await autofillFromUrl(URL_IN, d);

    expect(result.fields).toEqual({});
    expect(result.coaUrl).toBeNull();
    expect(result.errors.join(" ")).toMatch(/status 404/);
    expect(d.extractFromImage).not.toHaveBeenCalled();
  });

  it("returns empty fields (no error) when extraction finds nothing", async () => {
    const d = {
      fetchCoaImage: vi.fn(async () => COA_IMG),
      extractFromImage: vi.fn(async () => ({})),
    };

    const result = await autofillFromUrl(URL_IN, d);

    expect(result.fields).toEqual({});
    expect(result.coaUrl).toBe(URL_IN);
    expect(result.errors).toEqual([]);
  });

  it("emits fetching-coa → reading-url stages", async () => {
    const onStage = vi.fn();
    await autofillFromUrl(URL_IN, {
      fetchCoaImage: vi.fn(async () => COA_IMG),
      extractFromImage: vi.fn(async () => ({ peptideName: "X" })),
      onStage,
    });
    expect(onStage.mock.calls.map((c) => c[0])).toEqual(["fetching-coa", "reading-url"]);
  });
});
