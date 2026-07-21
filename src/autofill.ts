import type { ExtractedPeptide } from "./llm/client";

/**
 * A phase of the auto-fill pipeline, emitted via `onStage` so the UI can show
 * live progress (local vision inference can take tens of seconds).
 */
export type AutofillStage =
  | "reading-image" // decoding the picked file to a data URL (UI-side)
  | "reading-photo" // running vision (+ QR decode) on the vial photo
  | "fetching-coa" // downloading the linked / entered CoA
  | "reading-coa" // running vision on the fetched CoA
  | "reading-url"; // running vision on the entered image URL

/**
 * Injected capabilities so the orchestration stays pure and testable:
 *   - `decodeQr`         read a CoA URL out of the photo (or null)
 *   - `extractFromImage` vision extraction of an image data URL
 *   - `fetchCoaImage`    fetch + normalize a CoA URL to an image data URL
 *   - `onStage`          optional progress callback for each phase
 */
export interface AutofillDeps {
  decodeQr: (imageDataUrl: string) => Promise<string | null>;
  extractFromImage: (imageDataUrl: string) => Promise<ExtractedPeptide>;
  fetchCoaImage: (url: string) => Promise<string>;
  onStage?: (stage: AutofillStage) => void;
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
  { key: "manufacturer", label: "Manufacturer" },
  { key: "lot", label: "Lot" },
] as const;

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/**
 * Treat two cross-check values as equal. Strings compare case-insensitively.
 * Numbers use a 5% relative tolerance so an assay-vs-label mass gap (e.g. a
 * model putting a measured 10.31 mg where the label says 10 mg, ~3%) is not
 * flagged as a disagreement, while a genuine vial-size confusion (nearest
 * common sizes differ by ≥20%) still is.
 */
function fieldsEqual(a: string | number, b: string | number): boolean {
  if (typeof a === "string" && typeof b === "string") {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 0.05;
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
  deps.onStage?.("reading-photo");
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
      deps.onStage?.("fetching-coa");
      const coaImage = await deps.fetchCoaImage(coaUrl);
      deps.onStage?.("reading-coa");
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

/** Capabilities for {@link autofillFromUrl}. */
export interface UrlAutofillDeps {
  /** Fetch + normalize a CoA/image URL to an image data URL. */
  fetchCoaImage: (url: string) => Promise<string>;
  /** Vision extraction of an image data URL. */
  extractFromImage: (imageDataUrl: string) => Promise<ExtractedPeptide>;
  onStage?: (stage: AutofillStage) => void;
}

/**
 * Auto-fill from an operator-entered CoA/image URL: fetch it (image or PDF),
 * read the peptide facts off it, and return them for the operator to confirm.
 * A single authoritative source, so there is nothing to cross-check. Never
 * throws — a fetch/read failure lands in `errors` with empty `fields`.
 */
export async function autofillFromUrl(url: string, deps: UrlAutofillDeps): Promise<AutofillResult> {
  try {
    deps.onStage?.("fetching-coa");
    const image = await deps.fetchCoaImage(url);
    deps.onStage?.("reading-url");
    const fields = await deps.extractFromImage(image);
    return { fields, coaUrl: url, coaFields: fields, mismatches: [], notes: [], errors: [] };
  } catch (err) {
    return {
      fields: {},
      coaUrl: null,
      coaFields: null,
      mismatches: [],
      notes: [],
      errors: [message(err, "Could not read the URL.")],
    };
  }
}
