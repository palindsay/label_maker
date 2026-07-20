import { useEffect, useRef, useState } from "react";
import {
  type AutofillResult,
  type AutofillStage,
  autofillFromPhoto,
  autofillFromUrl,
} from "./autofill";
import { decodeQrFromDataUrl, exportLabelPng, rasterizePdfToDataUrl } from "./browser";
import { fetchCoaImage } from "./coa";
import { LabelForm } from "./components/LabelForm";
import { LabelPreview } from "./components/LabelPreview";
import { NoticeBanner } from "./components/NoticeBanner";
import { ProgressIndicator } from "./components/ProgressIndicator";
import { fileToDataUrl, labelPngFilename } from "./image";
import { reconstitution } from "./label/peptide";
import { PEPTIDE_PRESETS, type PeptideLabelInput, peptideLabelSchema } from "./label/schema";
import {
  DEFAULT_LLM_CONFIG,
  type ModelInfo,
  extractPeptideFromImage,
  listModels,
  pickVisionModel,
} from "./llm/client";
import { type Notice, buildNotices } from "./notices";
import { formatElapsed, stageLabel } from "./progress";

/** Backstop: abort an auto-fill running longer than this (local models are slow but finite). */
const AUTOFILL_TIMEOUT_MS = 180_000;

type AbortReason = "cancel" | "timeout";

function abortNotice(reason: AbortReason): Notice {
  return reason === "timeout"
    ? {
        kind: "warning",
        text: "Auto-fill timed out — local inference can be slow. Try again, pick a smaller model, or check the endpoint.",
      }
    : { kind: "info", text: "Auto-fill cancelled." };
}

function runError(err: unknown, what: "Image" | "URL"): string {
  return err instanceof Error
    ? err.message
    : `${what} auto-fill failed. Enter the label details manually.`;
}

const BPC = PEPTIDE_PRESETS["BPC-157"];
const INITIAL: PeptideLabelInput = {
  peptideName: BPC.name,
  vialMg: BPC.vialMg,
  bacWaterMl: BPC.bacWaterMl,
  doseMcg: BPC.doseMcg,
  lot: "",
  dateReconstituted: "",
  manufacturer: "",
};

export function App() {
  const [label, setLabel] = useState<PeptideLabelInput>(INITIAL);
  // Live auto-fill progress: the current stage (null = idle) and elapsed time.
  const [stage, setStage] = useState<AutofillStage | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const abortReasonRef = useRef<AbortReason | null>(null);
  const busy = stage !== null;
  // Notices from the last auto-fill (success/warning/error), and a separate
  // one for the image export, so the two flows don't clobber each other.
  const [notices, setNotices] = useState<Notice[]>([]);
  const [imageNotice, setImageNotice] = useState<Notice | null>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  // Tick the elapsed-time readout while an auto-fill is running.
  useEffect(() => {
    if (stage === null) return;
    const id = window.setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250);
    return () => window.clearInterval(id);
  }, [stage]);

  // OpenAI-compatible endpoint base URL. Editable in the UI; `endpointInput` is
  // the text buffer, `baseUrl` the committed value that drives discovery/calls.
  const [endpointInput, setEndpointInput] = useState<string>(DEFAULT_LLM_CONFIG.baseUrl);
  const [baseUrl, setBaseUrl] = useState<string>(DEFAULT_LLM_CONFIG.baseUrl);
  const commitEndpoint = () => setBaseUrl(endpointInput.trim() || DEFAULT_LLM_CONFIG.baseUrl);

  // Discovered models + the one selected for image auto-fill. The endpoint's
  // roster changes, so we list it at runtime rather than hardcoding an id.
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<string>("");
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  // (Re)discover the endpoint's models whenever the committed base URL changes.
  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setDiscoverError(null);
    listModels({ ...DEFAULT_LLM_CONFIG, baseUrl })
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
  }, [baseUrl]);

  const parsed = peptideLabelSchema.safeParse(label);
  const recon = parsed.success ? reconstitution(parsed.data) : null;
  const errorMessage = parsed.success ? null : parsed.error.issues[0]?.message;

  /** Merge an autofill result into the form and surface typed notices. */
  function ingest(result: AutofillResult, source: "photo" | "url") {
    // `purity` isn't a label field — surface it in the note, not the form.
    const { purity: _purity, ...labelFields } = result.fields;
    if (Object.keys(labelFields).length > 0) {
      setLabel((prev) => ({ ...prev, ...labelFields }));
    }
    setNotices(buildNotices(result, source));
  }

  /** Begin an auto-fill run: arm the abort controller/timer and return the
   *  shared context (a signal-bound fetch, the timeout id) callers need. */
  function beginRun(initial: AutofillStage) {
    const controller = new AbortController();
    abortRef.current = controller;
    abortReasonRef.current = null;
    setNotices([]);
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setStage(initial);
    const timeout = window.setTimeout(() => {
      abortReasonRef.current = "timeout";
      controller.abort();
    }, AUTOFILL_TIMEOUT_MS);
    const signalFetch: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal: controller.signal });
    const extractFromImage = (image: string) =>
      extractPeptideFromImage(image, { ...DEFAULT_LLM_CONFIG, baseUrl, model }, signalFetch);
    return { signalFetch, extractFromImage, timeout };
  }

  /** Common tail: honor a cancel/timeout, else ingest; always clear progress. */
  function finishRun(result: AutofillResult | null, source: "photo" | "url", timeout: number) {
    window.clearTimeout(timeout);
    abortRef.current = null;
    setStage(null);
    if (abortReasonRef.current) {
      setNotices([abortNotice(abortReasonRef.current)]);
    } else if (result) {
      ingest(result, source);
    }
  }

  function handleCancel() {
    abortReasonRef.current = "cancel";
    abortRef.current?.abort();
  }

  async function handleImage(file: File) {
    const { signalFetch, extractFromImage, timeout } = beginRun("reading-image");
    let result: AutofillResult | null = null;
    try {
      const dataUrl = await fileToDataUrl(file);
      result = await autofillFromPhoto(dataUrl, {
        decodeQr: decodeQrFromDataUrl,
        extractFromImage,
        fetchCoaImage: (url) =>
          fetchCoaImage(url, { rasterizePdf: rasterizePdfToDataUrl, fetchImpl: signalFetch }),
        onStage: setStage,
      });
    } catch (err) {
      if (!abortReasonRef.current) {
        setNotices([{ kind: "error", text: runError(err, "Image") }]);
      }
    } finally {
      finishRun(result, "photo", timeout);
    }
  }

  async function handleUrl(url: string) {
    const { signalFetch, extractFromImage, timeout } = beginRun("fetching-coa");
    let result: AutofillResult | null = null;
    try {
      result = await autofillFromUrl(url, {
        fetchCoaImage: (u) =>
          fetchCoaImage(u, { rasterizePdf: rasterizePdfToDataUrl, fetchImpl: signalFetch }),
        extractFromImage,
        onStage: setStage,
      });
    } catch (err) {
      if (!abortReasonRef.current) {
        setNotices([{ kind: "error", text: runError(err, "URL") }]);
      }
    } finally {
      finishRun(result, "url", timeout);
    }
  }

  async function handleCopyImage() {
    const node = labelRef.current;
    if (!node) return;
    setImageNotice(null);
    try {
      const outcome = await exportLabelPng(node, labelPngFilename(label.peptideName));
      setImageNotice(
        outcome === "copied"
          ? { kind: "success", text: "Copied the label image to the clipboard." }
          : { kind: "info", text: "Clipboard needs HTTPS — downloaded the image instead." },
      );
    } catch (err) {
      setImageNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not create the label image.",
      });
    }
  }

  return (
    <main className="app">
      <section className="editor no-print">
        <header className="editor-head">
          <h1>Peptide Label Maker</h1>
          <p className="subtitle">Nelko 40 × 14 mm · 3 ml vials · U-100 dosing</p>
        </header>

        <section className="settings" aria-label="Auto-fill endpoint and model">
          <h2 className="settings-title">Auto-fill endpoint &amp; model</h2>
          <div className="settings-body">
            <label className="field">
              LLM endpoint
              <input
                type="url"
                inputMode="url"
                value={endpointInput}
                placeholder="http://host:port/v1"
                onChange={(e) => setEndpointInput(e.target.value)}
                onBlur={commitEndpoint}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEndpoint();
                  }
                }}
              />
            </label>

            <label className="field">
              Model
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

            {discoverError && (
              <NoticeBanner kind="warning" text={`Couldn't list models: ${discoverError}`} />
            )}
          </div>
        </section>

        {stage && (
          <ProgressIndicator
            label={stageLabel(stage)}
            elapsed={formatElapsed(elapsedMs)}
            detail={model ? `Model: ${model}` : undefined}
            onCancel={handleCancel}
          />
        )}

        <LabelForm
          value={label}
          onChange={setLabel}
          onImageSelected={handleImage}
          onUrlSubmit={handleUrl}
          busy={busy}
        />

        <div className="notices" aria-live="polite">
          {notices.map((n, i) => (
            <NoticeBanner key={`${n.kind}:${i}:${n.text}`} kind={n.kind} text={n.text} />
          ))}
          {errorMessage && <NoticeBanner kind="error" text={errorMessage} />}
          {imageNotice && <NoticeBanner kind={imageNotice.kind} text={imageNotice.text} />}
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.print()}
            disabled={!parsed.success}
          >
            Print
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleCopyImage}
            disabled={!parsed.success}
          >
            Copy image
          </button>
        </div>
      </section>

      <section className="stage">
        <div className="preview-frame">
          <LabelPreview label={label} recon={recon} ref={labelRef} />
        </div>
      </section>
    </main>
  );
}
