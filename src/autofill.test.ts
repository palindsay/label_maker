import { describe, expect, it, vi } from "vitest";
import { autofillFromPhoto } from "./autofill";

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
});
