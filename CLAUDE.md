# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A client-only web app for printing **peptide vial labels** on **Nelko 40mm × 14mm** label
stock (sized for 3ml vials). The operator enters vial facts (peptide, mg, reconstitution water,
dose); the app derives the dosing (concentration, draw volume, syringe units, doses/vial) and
renders a dense true-to-size label that prints via the browser's native dialog. A multimodal LLM
can read those facts off a photo of the vial to pre-fill the form.

There is no backend. "Printing" is `window.print()` with an `@page`-sized stylesheet; export a
PDF by choosing "Save as PDF" as the print destination.

**This tool does arithmetic on operator-supplied inputs. It is not medical advice, and every
printed label must be independently verified against the vial and protocol.**

## Commands

```bash
npm run dev          # Vite dev server (proxies /v1 -> the LLM endpoint)
npm run build        # tsc --noEmit (typecheck) then vite build -> dist/
npm run preview      # serve the production build (also proxies /v1)
npm test             # vitest run
npm run test:cov     # vitest with v8 coverage
npm run lint         # biome check (lint + format + import-order, read-only)
npm run format       # biome format --write

# One file / one test:
npx vitest run src/label/peptide.test.ts
npx vitest run -t "canonical 5mg"
```

`npm run build` runs `tsc --noEmit` first, so any type error fails the build — keep the strict
typecheck green, not just the bundler.

## Architecture

One-way data flow around a single `PeptideLabelInput` held in `App`:

```
App (owns PeptideLabelInput; derives Reconstitution; handles image extraction)
 ├─ LabelForm     controlled fields + vial-photo <input> + CoA/image URL field
 │                -> onChange / onImageSelected / onUrlSubmit
 └─ LabelPreview  renders the label at 40x14mm from input + derived dosing
```

- **`src/label/schema.ts`** — the domain. `peptideLabelSchema` (Zod) is the single source of
  truth; `PeptideLabel` is derived via `z.infer`. `PeptideLabelInput` is the *form* shape:
  every field always present, numeric fields may be `NaN` mid-edit (which fails validation).
  `NELKO_LABEL_SIZE` (40×14) is fixed — the layout/print rules are tuned to it.
- **`src/label/peptide.ts`** — pure dosing math and label formatters. `reconstitution()` is the
  core: concentration = `vialMg·1000 / bacWaterMl`, draw volume = `dose / concentration`,
  **insulin units assume a U-100 syringe** (100 units = 1 mL). This is where dosing logic lives
  and it is unit-tested exhaustively.
- **`src/label/format.ts`** — `mmToPx` only (physical mm → CSS px at 96dpi).
- **`src/llm/client.ts`** — OpenAI-compatible vision client. `buildVisionRequest` and
  `parseExtractionContent` are pure and tested; `extractPeptideFromImage` does the fetch
  (injectable `fetchImpl`). Parsing tolerates code fences and `vialMg` as a string, and never
  throws on unusable model output — it returns `{}`.
- **`src/image.ts`** — `fileToDataUrl` (FileReader → base64 data URL for the vision request).
- **`src/qr.ts`** — `decodeQrFromImageData` (pure `jsQR` wrapper; deterministic, not LLM-based).
- **`src/coa.ts`** — Certificate of Analysis handling. `validateCoaUrl` enforces the http(s)
  scheme only — **any host is allowed** (this runs on a trusted LAN where CoAs are often hosted on
  private/`.local` addresses); the scheme check just keeps `file:`/`data:`/junk out of the fetch.
  `fetchCoaImage` tries a direct fetch, falls back to the `/coa` proxy on CORS failure, dispatches
  by content-type (image passthrough, PDF → injected `rasterizePdf`), caps size, and throws a
  typed `CoaError`. Pure/injectable and tested. Serves both the QR path and the operator URL field.
- **`src/autofill.ts`** — two orchestrators, both pure and never-throwing (failures go in
  `errors`). `autofillFromPhoto`: photo → (QR decode ‖ vision) → CoA fetch → CoA vision → merge +
  cross-check; CoA overrides the vial photo (more authoritative) and disagreements are collected
  in `mismatches`. The QR may resolve to any URL (LAN included) pointing at a CoA image/PDF.
  `autofillFromUrl`: operator-entered CoA/image URL → fetch → vision → fields (single authoritative
  source, no cross-check). `App.ingest()` merges either result into the form.
- **`src/browser.ts`** — browser-only glue that needs a real canvas / pdf.js worker
  (`decodeQrFromDataUrl`, `rasterizePdfToDataUrl`, pdf.js lazy-imported). Excluded from coverage;
  exercised by the build and live runs.
- **`src/components/`** — presentational React; no domain logic beyond wiring.
- **`src/index.css`** — carries the print contract (see below).

### Invariants to preserve

1. **mm is the unit of truth.** Physical sizes are millimetres in the domain; convert to px only
   at the rendering edge via `mmToPx`. Don't leak px into `schema.ts` / `peptide.ts`.
2. **Dosing is U-100.** `insulinUnits` assumes a U-100 insulin syringe. If you add U-40/U-50
   support, make the syringe scale an explicit input — do not silently change the constant.
3. **The print contract lives in CSS.** `@media print` in `index.css` sets `@page { size: 40mm
   14mm; margin: 0 }`, hides `.no-print`, drops the screen-only `.preview-frame` zoom, and prints
   `.label-print` (black-on-white, for direct thermal) at exact size. New chrome must be
   `.no-print`; the printed element stays `.label-print`.
4. **The LLM is best-effort pre-fill, never a source of truth.** `parseExtractionContent`
   returns a *partial* that is merged into the form for the operator to confirm; it must keep
   degrading gracefully (empty object) rather than throwing.
5. **CoA URLs are host-agnostic on a trusted LAN.** `validateCoaUrl` deliberately allows any host
   (private/loopback/`.local` included) and checks the http(s) scheme only — both the operator URL
   field and the QR-decoded URL fetch through the same relaxed path, so a vial QR pointing at a LAN
   CoA resolves. The `/coa` dev/preview proxy is an intentional open fetch proxy; run it only on a
   network you trust. If this app is ever exposed beyond the LAN, re-introduce host restrictions.

## LLM endpoint / networking

- Browser calls same-origin **`/v1`**; Vite (`server.proxy` + `preview.proxy` in
  `vite.config.ts`) forwards to `LLM_TARGET` (default `http://rastalinuxai.local:8080`). This
  sidesteps CORS. Change the target by editing `LLM_TARGET` in `vite.config.ts`.
- Override the base URL with `VITE_LLM_BASE_URL` (see `.env.example`). Calling a host directly
  (not via the proxy) requires CORS on that server.
- **CoA fetch** uses a second dev/preview proxy: `vite.config.ts`'s `coaProxyPlugin` serves
  `/coa?url=<CoA URL>`, re-validates the URL's scheme server-side with `validateCoaUrl`, and
  fetches it (any host) without CORS. `fetchCoaImage` tries the URL directly first and only falls
  back to `/coa` on a CORS/network failure. Like `/v1`, the proxy exists only under `dev`/`preview`
  — a static build is direct-fetch only. The same `fetchCoaImage` serves both the QR path and the
  operator's **CoA/image URL field**, and both accept LAN/private hosts. Since the dev/preview
  server binds `0.0.0.0`, the proxy is effectively an open http(s) fetch proxy for anyone on the
  LAN — acceptable only because it runs on a network you trust (see invariant #5).
- **Model discovery is dynamic.** The endpoint's roster changes (it may serve Gemma 4 31B, a
  Qwen VL, LLaVA, …), so the app does not hardcode a model id. On mount it calls `listModels`
  (`GET /v1/models`) and `pickVisionModel` chooses one, in priority order: (1) a `VITE_LLM_MODEL`
  preference if the endpoint serves it, (2) the first model the endpoint flags
  `capabilities.vision: true`, (3) the first model whose name looks vision-capable
  (`VISION_HINTS`), (4) the first model. The **in-app "Vision model" dropdown** lets the user
  switch among discovered models, and `extractPeptideFromImage` auto-discovers when
  `config.model` is empty. The capability flag is authoritative when present; the name heuristic
  is the fallback when it isn't, and the user override is the final safety net. `VITE_LLM_MODEL`
  is optional (leave unset to auto-pick).
- Endpoints seen in practice: **llama-swap** (routes by `model` id; unknown id → `404 "no router"`)
  and a plain server exposing a single Qwen build that *does* accept images. A text-only model
  with no mmproj returns `500 "image input is not supported"` → the app's `no-vision` path.
- The app **assumes a multimodal model is available** and always offers photo auto-fill. When
  the endpoint can't do vision (no model, no mmproj, unreachable, or a bad response),
  `extractPeptideFromImage` throws a typed `LlmError` (`kind`: `no-vision` | `model-missing` |
  `unreachable` | `bad-response` | `unknown`) whose `message` is user-safe, and the UI degrades
  to manual entry. An empty extraction (`{}`) is not an error — the UI shows an info note.
- `npm run test:live` (gated by `LLM_LIVE=1`) is the diagnostic: it preflights `/v1/models`,
  proves a text completion works, then attempts image extraction and degrades gracefully (like
  the app) if no vision model is present. Point `LLM_MODEL` at a vision id to exercise the real
  extraction path.

## Conventions

- Types flow from Zod schemas (`z.infer`); don't duplicate a schema as a hand-written type.
- Keep domain logic pure and in `src/label/*` (and parsing in `src/llm/*`); components stay
  presentational and take values + callbacks.
- `tsconfig` is strict incl. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — index
  access is `T | undefined`, and optional props must not be explicitly assigned `undefined`.
- New deps carrying Vite/Vitest peers must resolve to a **single** `vite` version (`npm ls vite`);
  a duplicate nested copy breaks config typing.
- New logic in `src/label/*` and `src/llm/*` is expected to stay near 100% unit coverage.
