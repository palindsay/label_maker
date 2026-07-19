# Peptide Label Maker

A client-only web app for printing **peptide vial labels** on **Nelko 40 mm × 14 mm** stock
(sized for 3 ml vials). Enter the vial facts, get the dosing computed for you, and print at true
physical size. Optionally, snap a photo of the vial and let a local multimodal LLM pre-fill the
form.

> ⚠️ This tool performs arithmetic on the values **you** enter. It is not medical advice.
> Verify every printed label against the vial and your protocol. Dosing assumes a **U-100
> insulin syringe** (100 units = 1 mL).

**New here? Read [QUICKSTART.md](./QUICKSTART.md)** — install, run, print, and photo/CoA auto-fill in a few minutes.

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
| `npm run serve`     | Build, then serve on `0.0.0.0:4173` (LAN)    |
| `npm run serve:dev` | Dev server on `0.0.0.0:5173` (LAN)           |
| `npm test`          | Run the test suite once                      |
| `npm run test:cov`  | Run tests with a coverage report             |
| `npm run lint`      | Lint, format-check, and import-order (Biome) |
| `npm run format`    | Auto-format the codebase                     |

## Run on your LAN / auto-start on boot

```bash
npm run serve                  # build + serve on 0.0.0.0:4173 (phone, other PCs)
scripts/install-service.sh     # install a systemd user service that starts at boot
```

The `/v1` (LLM) and `/coa` (CoA) proxies work over the network, so photo auto-fill and CoA
fetching function from any device. See **[QUICKSTART.md](./QUICKSTART.md)** for the service
lifecycle (`systemctl --user … label-maker`) and details.

> Binding `0.0.0.0` exposes the app and its proxies to the LAN, and `/coa` will fetch any http(s)
> host — run it only on a network you trust.

## Printing

No backend, no PDF library. **Print** calls the browser's print dialog; the stylesheet sets
`@page { size: 40mm 14mm; margin: 0 }` and renders the label black-on-white for direct-thermal
printers. Choose "Save as PDF" as the destination to export a file.

## Auto-fill from a photo, QR, or URL (LLM)

Three ways to pre-fill the form (all best-effort — you confirm before printing):

- **Vial photo → auto-fill**: sends the image to an OpenAI-compatible multimodal endpoint and
  merges the extracted peptide name / mg / lot into the form.
- **QR-linked CoA**: if the photo carries a QR pointing to a CoA (image/PDF), it's fetched, read,
  and cross-checked against the photo (mismatches flagged).
- **CoA / image URL → auto-fill**: paste a direct link to a CoA (PDF/image) or vial image and
  click **Fetch**.

Details:

- The browser calls same-origin `/v1`; Vite proxies it to the endpoint in `vite.config.ts`
  (`LLM_TARGET`, default `http://rastalinuxai.local:8080`) — this avoids CORS.
- Override the base URL / model via `VITE_LLM_BASE_URL` / `VITE_LLM_MODEL` (see `.env.example`).
- CoA fetch (`/coa` proxy) validates the http(s) scheme only; any host is allowed (trusted LAN).

## Export the label as an image

**Copy image** rasterizes the true-size label to a PNG — copied to the clipboard on a secure
context (`localhost`/HTTPS), or downloaded over plain-http LAN. The layout is responsive, so the
form and preview work on a phone.

## Project layout

```
src/
  label/         pure domain — schema (Zod), reconstitution math, mm→px
  llm/           OpenAI-compatible vision client (request build + parse)
  components/     presentational React (LabelForm, LabelPreview)
  autofill.ts     orchestrates photo/QR/URL → LLM → merged fields (pure)
  coa.ts          CoA fetch + URL validation (scheme-only; PDF→image)
  qr.ts           QR decode (jsQR wrapper)
  image.ts        file → data URL, and the label PNG filename helper
  browser.ts      browser-only glue (canvas, pdf.js, label→PNG export)
  App.tsx         owns state, derives dosing, wires photo/QR/URL → form → print
  index.css       layout + the @media print contract
deploy/           systemd user-service template
scripts/          serve.sh, install-service.sh, uninstall-service.sh
```

See [CLAUDE.md](./CLAUDE.md) for architecture notes and invariants.
