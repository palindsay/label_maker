import { useState } from "react";
import { LabelForm } from "./components/LabelForm";
import { LabelPreview } from "./components/LabelPreview";
import { fileToDataUrl } from "./image";
import { reconstitution } from "./label/peptide";
import { PEPTIDE_PRESETS, type PeptideLabelInput, peptideLabelSchema } from "./label/schema";
import { extractPeptideFromImage } from "./llm/client";

const INITIAL: PeptideLabelInput = {
  peptideName: "BPC-157",
  ...PEPTIDE_PRESETS["BPC-157"],
  lot: "",
  dateReconstituted: "",
  note: "Research use only",
};

export function App() {
  const [label, setLabel] = useState<PeptideLabelInput>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [llmNote, setLlmNote] = useState<string | null>(null);

  const parsed = peptideLabelSchema.safeParse(label);
  const recon = parsed.success ? reconstitution(parsed.data) : null;
  const errorMessage = parsed.success ? null : parsed.error.issues[0]?.message;

  async function handleImage(file: File) {
    setBusy(true);
    setLlmError(null);
    setLlmNote(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const fields = await extractPeptideFromImage(dataUrl);
      const filled = Object.keys(fields);
      if (filled.length === 0) {
        setLlmNote("No details could be read from the photo — enter them manually.");
        return;
      }
      setLabel((prev) => ({ ...prev, ...fields }));
      setLlmNote(`Filled from photo: ${filled.join(", ")}. Verify before printing.`);
    } catch (err) {
      // extractPeptideFromImage throws a user-safe LlmError message; fall back
      // defensively for anything unexpected.
      setLlmError(
        err instanceof Error
          ? err.message
          : "Image auto-fill failed. Enter the label details manually.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <section className="editor no-print">
        <h1>Peptide Label Maker</h1>
        <p className="subtitle">Nelko 40 × 14 mm · 3 ml vials · U-100 dosing</p>

        <LabelForm value={label} onChange={setLabel} onImageSelected={handleImage} busy={busy} />

        {busy && <p className="status">Reading vial photo…</p>}
        {llmNote && <p className="status">{llmNote}</p>}
        {llmError && <p className="error">{llmError}</p>}
        {errorMessage && <p className="error">{errorMessage}</p>}

        <button type="button" onClick={() => window.print()} disabled={!parsed.success}>
          Print
        </button>
      </section>

      <section className="stage">
        <div className="preview-frame">
          <LabelPreview label={label} recon={recon} />
        </div>
      </section>
    </main>
  );
}
