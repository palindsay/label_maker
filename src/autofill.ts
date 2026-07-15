import type { ExtractedPeptide } from "./llm/client";

/**
 * Injected capabilities so the orchestration stays pure and testable:
 *   - `decodeQr`         read a CoA URL out of the photo (or null)
 *   - `extractFromImage` vision extraction of an image data URL
 *   - `fetchCoaImage`    fetch + normalize a CoA URL to an image data URL
 */
export interface AutofillDeps {
  decodeQr: (imageDataUrl: string) => Promise<string | null>;
  extractFromImage: (imageDataUrl: string) => Promise<ExtractedPeptide>;
  fetchCoaImage: (url: string) => Promise<string>;
}

export interface AutofillResult {
  /** Merged fields (vial photo first, CoA overrides) for the operator to confirm. */
  fields: ExtractedPeptide;
  coaUrl: string | null;
  coaFields: ExtractedPeptide | null;
  /** Human-readable conflicts where the photo and CoA disagreed. */
  mismatches: string[];
  notes: string[];
  errors: string[];
}

const CROSS_CHECK = [
  { key: "peptideName", label: "Peptide" },
  { key: "vialMg", label: "Vial mg" },
  { key: "lot", label: "Lot" },
] as const;

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

function fieldsEqual(a: string | number, b: string | number): boolean {
  if (typeof a === "string" && typeof b === "string") {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return a === b;
}

/**
 * Drive image auto-fill end to end: read the vial photo and, if it carries a QR
 * code, fetch and read the linked Certificate of Analysis, then merge and
 * cross-check the two sources. Never throws — failures are collected in
 * `errors` so the operator can still fill the form manually.
 */
export async function autofillFromPhoto(
  imageDataUrl: string,
  deps: AutofillDeps,
): Promise<AutofillResult> {
  const notes: string[] = [];
  const errors: string[] = [];
  const mismatches: string[] = [];

  // Decode QR and read the vial photo concurrently — they are independent.
  const [qr, vial] = await Promise.allSettled([
    deps.decodeQr(imageDataUrl),
    deps.extractFromImage(imageDataUrl),
  ]);

  let vialFields: ExtractedPeptide = {};
  if (vial.status === "fulfilled") {
    vialFields = vial.value;
  } else {
    errors.push(message(vial.reason, "Could not read the vial photo."));
  }

  const coaUrl = qr.status === "fulfilled" && qr.value ? qr.value : null;

  let coaFields: ExtractedPeptide | null = null;
  if (coaUrl) {
    try {
      const coaImage = await deps.fetchCoaImage(coaUrl);
      coaFields = await deps.extractFromImage(coaImage);
      notes.push(`Read CoA linked from the QR code: ${coaUrl}`);
    } catch (err) {
      errors.push(message(err, "Could not read the CoA linked from the QR code."));
    }
  }

  // The manufacturer CoA is more authoritative than a phone photo, so it wins;
  // surface any disagreement for the operator to verify.
  if (coaFields) {
    for (const { key, label } of CROSS_CHECK) {
      const v = vialFields[key];
      const c = coaFields[key];
      if (v !== undefined && c !== undefined && !fieldsEqual(v, c)) {
        mismatches.push(`${label}: photo "${v}" vs CoA "${c}" (using CoA)`);
      }
    }
  }

  const fields: ExtractedPeptide = { ...vialFields, ...(coaFields ?? {}) };

  return { fields, coaUrl, coaFields, mismatches, notes, errors };
}
