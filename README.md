# Peptide Label Maker

A client-only web app for printing **peptide vial labels** on **Nelko 40 mm × 14 mm** stock
(sized for 3 ml vials). Enter the vial facts, get the dosing computed for you, and print at true
physical size. Optionally, snap a photo of the vial and let a local multimodal LLM pre-fill the
form.

> ⚠️ This tool performs arithmetic on the values **you** enter. It is not medical advice.
> Verify every printed label against the vial and your protocol. Dosing assumes a **U-100
> insulin syringe** (100 units = 1 mL).

## What it computes

From `vial mg`, `BAC water mL`, and `dose mcg` it derives:

| Output | Formula | Example (5 mg, 2 mL, 250 mcg) |
| --- | --- | --- |
| Concentration | `vialMg·1000 / bacWaterMl` | 2.5 mg/mL |
| Draw volume | `dose / concentration` | 0.1 mL |
| Syringe units (U-100) | `volume × 100` | 10 IU |
| Doses per vial | `vialMg·1000 / dose` | 20 |

## Stack

React 19 · TypeScript (strict) · Vite 6 · Vitest · Biome · Zod

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
```

## Scripts

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Dev server with hot reload                   |
| `npm run build`     | Typecheck + production build to `dist/`      |
| `npm run preview`   | Serve the production build                   |
| `npm test`          | Run the test suite once                      |
| `npm run test:cov`  | Run tests with a coverage report             |
| `npm run lint`      | Lint, format-check, and import-order (Biome) |
| `npm run format`    | Auto-format the codebase                     |

## Printing

No backend, no PDF library. **Print** calls the browser's print dialog; the stylesheet sets
`@page { size: 40mm 14mm; margin: 0 }` and renders the label black-on-white for direct-thermal
printers. Choose "Save as PDF" as the destination to export a file.

## Auto-fill from a photo (LLM)

The **Vial photo → auto-fill** control sends the image to an OpenAI-compatible multimodal
endpoint and merges the extracted peptide name / mg / lot into the form for you to confirm.

- The browser calls same-origin `/v1`; Vite proxies it to the endpoint in `vite.config.ts`
  (`LLM_TARGET`, default `http://rastalinuxai.local:8080`) — this avoids CORS.
- Override the base URL / model via `VITE_LLM_BASE_URL` / `VITE_LLM_MODEL` (see `.env.example`).

## Project layout

```
src/
  label/         pure domain — schema (Zod), reconstitution math, mm→px
  llm/           OpenAI-compatible vision client (request build + parse)
  components/     presentational React (LabelForm, LabelPreview)
  image.ts        file → data URL for the vision request
  App.tsx         owns state, derives dosing, wires photo → LLM → form → print
  index.css       layout + the @media print contract
```

See [CLAUDE.md](./CLAUDE.md) for architecture notes and invariants.
