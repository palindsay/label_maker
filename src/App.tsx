import { useEffect, useState } from "react";
import { autofillFromPhoto } from "./autofill";
import { decodeQrFromDataUrl, rasterizePdfToDataUrl } from "./browser";
import { fetchCoaImage } from "./coa";
import { LabelForm } from "./components/LabelForm";
import { LabelPreview } from "./components/LabelPreview";
import { fileToDataUrl } from "./image";
import { reconstitution } from "./label/peptide";
import { PEPTIDE_PRESETS, type PeptideLabelInput, peptideLabelSchema } from "./label/schema";
import {
  DEFAULT_LLM_CONFIG,
  type ModelInfo,
  extractPeptideFromImage,
  listModels,
  pickVisionModel,
} from "./llm/client";

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
  const [mismatches, setMismatches] = useState<string[]>([]);

  // Discovered models + the one selected for image auto-fill. The endpoint's
  // roster changes, so we list it at runtime rather than hardcoding an id.
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<string>("");
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listModels()
      .then((discovered) => {
        if (cancelled) return;
        setModels(discovered);
        setModel(pickVisionModel(discovered, DEFAULT_LLM_CONFIG.model || undefined) ?? "");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDiscoverError(err instanceof Error ? err.message : "Could not list endpoint models.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const parsed = peptideLabelSchema.safeParse(label);
  const recon = parsed.success ? reconstitution(parsed.data) : null;
  const errorMessage = parsed.success ? null : parsed.error.issues[0]?.message;

  async function handleImage(file: File) {
    setBusy(true);
    setLlmError(null);
    setLlmNote(null);
    setMismatches([]);
    try {
      const dataUrl = await fileToDataUrl(file);
      const result = await autofillFromPhoto(dataUrl, {
        decodeQr: decodeQrFromDataUrl,
        extractFromImage: (image) =>
          extractPeptideFromImage(image, { ...DEFAULT_LLM_CONFIG, model }),
        fetchCoaImage: (url) => fetchCoaImage(url, { rasterizePdf: rasterizePdfToDataUrl }),
      });

      // `purity` isn't a label field — surface it in the note, not the form.
      const { purity, ...labelFields } = result.fields;
      const filled = Object.keys(labelFields);
      if (filled.length > 0) {
        setLabel((prev) => ({ ...prev, ...labelFields }));
      }

      const parts: string[] = [];
      if (filled.length > 0) parts.push(`Filled: ${filled.join(", ")}`);
      if (purity) parts.push(`CoA purity ${purity}`);
      if (result.coaUrl) parts.push("CoA read from QR");
      setLlmNote(
        parts.length > 0
          ? `${parts.join(" · ")}. Verify before printing.`
          : "No details could be read from the photo — enter them manually.",
      );
      setMismatches(result.mismatches);
      if (result.errors.length > 0) setLlmError(result.errors.join(" "));
    } catch (err) {
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

        <label className="model-picker">
          Vision model
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={models.length === 0}
          >
            {models.length === 0 ? (
              <option value="">{discoverError ? "unavailable" : "discovering…"}</option>
            ) : (
              models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? m.id}
                </option>
              ))
            )}
          </select>
        </label>

        <LabelForm value={label} onChange={setLabel} onImageSelected={handleImage} busy={busy} />

        {busy && <p className="status">Reading vial photo…</p>}
        {llmNote && <p className="status">{llmNote}</p>}
        {mismatches.length > 0 && (
          <ul className="mismatches">
            {mismatches.map((m) => (
              <li key={m}>⚠ {m}</li>
            ))}
          </ul>
        )}
        {discoverError && <p className="status">Model discovery: {discoverError}</p>}
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
