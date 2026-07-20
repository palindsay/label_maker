import { describe, expect, it } from "vitest";
import type { AutofillResult } from "./autofill";
import { buildNotices } from "./notices";

function result(over: Partial<AutofillResult> = {}): AutofillResult {
  return {
    fields: {},
    coaUrl: null,
    coaFields: null,
    mismatches: [],
    notes: [],
    errors: [],
    ...over,
  };
}

describe("buildNotices", () => {
  it("uses friendly field labels, not raw keys", () => {
    const [notice] = buildNotices(
      result({ fields: { peptideName: "BPC-157", vialMg: 10, lot: "A1", manufacturer: "Acme" } }),
      "photo",
    );
    expect(notice?.kind).toBe("success");
    expect(notice?.text).toContain("Peptide name");
    expect(notice?.text).toContain("Vial mg");
    expect(notice?.text).not.toContain("peptideName");
    expect(notice?.text).not.toContain("vialMg");
  });

  it("does NOT claim 'from the CoA' when the CoA was not read", () => {
    // Photo filled the fields; the QR CoA fetch failed → coaFields stays null.
    const notices = buildNotices(
      result({
        fields: { peptideName: "BPC-157", vialMg: 5, purity: "99.3%" },
        coaUrl: "https://x.example/page.html",
        coaFields: null,
        errors: ["That link is a web page, not a CoA image or PDF."],
      }),
      "photo",
    );
    const success = notices.find((n) => n.kind === "success");
    expect(success?.text).not.toMatch(/CoA/i);
    expect(success?.text).toContain("purity 99.3%");
    // The fetch error is a warning here (fields still filled), not a hard error.
    expect(notices.some((n) => n.kind === "warning" && /web page/.test(n.text))).toBe(true);
    expect(notices.some((n) => n.kind === "error")).toBe(false);
  });

  it("credits the CoA when it was actually read", () => {
    const [notice] = buildNotices(
      result({
        fields: { peptideName: "BPC-157", vialMg: 10 },
        coaUrl: "https://x.example/coa.pdf",
        coaFields: { peptideName: "BPC-157", vialMg: 10 },
      }),
      "url",
    );
    expect(notice?.text).toContain("from the CoA URL");
  });

  it("treats a read error as fatal when nothing was filled", () => {
    const notices = buildNotices(result({ errors: ["Could not reach the endpoint."] }), "url");
    expect(notices).toEqual([{ kind: "error", text: "Could not reach the endpoint." }]);
  });

  it("emits an info notice when the source yielded nothing and no error", () => {
    const [notice] = buildNotices(result(), "photo");
    expect(notice?.kind).toBe("info");
    expect(notice?.text).toMatch(/No details could be read from the photo/);
  });

  it("carries mismatches as warnings", () => {
    const notices = buildNotices(
      result({
        fields: { vialMg: 10 },
        coaFields: { vialMg: 10 },
        mismatches: ['Vial mg: photo "5" vs CoA "10" (using CoA)'],
      }),
      "photo",
    );
    expect(notices.some((n) => n.kind === "warning" && /Vial mg/.test(n.text))).toBe(true);
  });
});
