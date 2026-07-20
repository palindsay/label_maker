import type { AutofillStage } from "./autofill";

const STAGE_LABELS: Record<AutofillStage, string> = {
  "reading-image": "Reading image…",
  "reading-photo": "Reading the vial photo…",
  "fetching-coa": "Fetching the Certificate of Analysis…",
  "reading-coa": "Reading the CoA…",
  "reading-url": "Reading the image…",
};

/** Human label for a progress stage. */
export function stageLabel(stage: AutofillStage): string {
  return STAGE_LABELS[stage];
}

/** Format elapsed milliseconds compactly: `9s`, `45s`, `1m 05s`. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
