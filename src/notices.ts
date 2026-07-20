import type { AutofillResult } from "./autofill";

/** Severity of a user-facing notification banner. */
export type NoticeKind = "success" | "warning" | "error" | "info";

export interface Notice {
  kind: NoticeKind;
  text: string;
}

/** Human-readable labels for the internal field keys (never show camelCase). */
const FIELD_LABELS: Record<string, string> = {
  peptideName: "Peptide name",
  vialMg: "Vial mg",
  bacWaterMl: "BAC water",
  doseMcg: "Dose",
  lot: "Lot",
  dateReconstituted: "Date",
  manufacturer: "Manufacturer",
};

/**
 * Turn an {@link AutofillResult} into ordered notification banners.
 *
 * Key rules the old inline logic got wrong:
 *  - "read from the CoA" is claimed only when a CoA was actually read
 *    (`coaFields`), not merely because a QR/URL was present.
 *  - filled fields are shown by friendly label, not raw keys.
 *  - a fetch/read error is a *warning* when fields were still filled from
 *    another source (e.g. the photo), and only an *error* when nothing landed.
 */
export function buildNotices(result: AutofillResult, source: "photo" | "url"): Notice[] {
  const { purity, ...labelFields } = result.fields;
  const filledLabels = Object.keys(labelFields).map((k) => FIELD_LABELS[k] ?? k);
  const filledSomething = filledLabels.length > 0 || purity !== undefined;
  const notices: Notice[] = [];

  if (filledSomething) {
    const bits: string[] = [];
    if (filledLabels.length > 0) bits.push(`Filled ${filledLabels.join(", ")}`);
    if (purity !== undefined) bits.push(`purity ${purity}`);
    // Only credit the CoA when one was genuinely read and merged.
    const from = result.coaFields
      ? source === "url"
        ? " from the CoA URL"
        : " from the CoA linked in the QR code"
      : "";
    notices.push({ kind: "success", text: `${bits.join(" · ")}${from}. Verify before printing.` });
  } else if (result.errors.length === 0) {
    const noun = source === "url" ? "URL" : "photo";
    notices.push({
      kind: "info",
      text: `No details could be read from the ${noun} — enter them manually.`,
    });
  }

  for (const text of result.mismatches) notices.push({ kind: "warning", text });

  // A read failure is non-fatal if we still filled something from elsewhere.
  const errorKind: NoticeKind = filledSomething ? "warning" : "error";
  for (const text of result.errors) notices.push({ kind: errorKind, text });

  return notices;
}
