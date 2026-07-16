# Quick Start

Print peptide vial labels on **Nelko 40 mm × 14 mm** stock. This is a client-only web app —
no backend, no install beyond `npm`. You enter (or photograph) the vial facts, the app derives
the dosing, and you print through the browser.

> ⚠️ This tool does arithmetic on the values **you** provide. It is **not medical advice**.
> Verify every printed label against the vial and your protocol. Dosing assumes a **U-100
> insulin syringe** (100 units = 1 mL).

---

## 1. Prerequisites

- **Node.js 24.x** and npm (`node --version` → `v24.x`)
- A modern browser (Chrome/Edge/Firefox/Safari)
- *(Optional)* An OpenAI-compatible **vision** LLM endpoint for photo auto-fill (see §5)

## 2. Install

```bash
npm install
```

## 3. Run it

```bash
npm run dev
```

Open the printed URL (default **http://localhost:5173**). That's it — the app is usable
immediately with manual entry; the LLM is optional.

To serve the optimized production build instead:

```bash
npm run build     # typecheck + bundle to dist/
npm run preview   # serve dist/ (default http://localhost:4173)
```

### Serve on your network (0.0.0.0)

To reach the app from other machines (phone, another PC) on your LAN:

```bash
npm run serve                 # build, then serve on 0.0.0.0:4173
npm run serve:dev             # dev server (HMR) on 0.0.0.0:5173
PORT=8088 npm run serve       # choose the port
```

The script (`scripts/serve.sh`) prints the LAN URL, e.g. `http://192.168.1.63:4173/`. Both the
`/v1` (LLM) and `/coa` (CoA) proxies work in this mode, so photo auto-fill and QR-linked CoA
reading function over the network.

> Binding `0.0.0.0` exposes the app **and** its `/v1` + `/coa` proxies to everyone on the LAN —
> only run it on a network you trust. Accessing by **IP** works out of the box; to reach it by a
> custom **hostname** you may need to add that host to `server.allowedHosts` / `preview.allowedHosts`
> in `vite.config.ts`.

## 4. Make a label (the 30-second path)

1. Fill in **Peptide name**, **Vial (mg)**, **BAC water (mL)**, **Dose (mcg)**.
   Optionally set **Lot**, **Date**, **Note** (e.g. "Research use only"), or start from a
   **Preset** (BPC-157, TB-500, Tirzepatide, Retatrutide, Tesamorelin, Ipamorelin, DSIP, KPV,
   SS-31, Thymosin α-1, and more). Preset BAC-water and dose values are **conventional starting
   points, not medical advice** — confirm them against your protocol.
2. The preview (right) updates live and shows the derived dosing. Example — **5 mg + 2 mL,
   250 mcg dose** →

   | Concentration | Draw volume | Syringe (U-100) | Doses/vial |
   | ------------- | ----------- | --------------- | ---------- |
   | 2.5 mg/mL     | 0.1 mL      | **10 IU**       | 20         |

3. Click **Print**. In the browser dialog choose your Nelko/label printer, or **Save as PDF**
   to export a file. The stylesheet sizes the page to exactly 40 × 14 mm — set the printer to
   the 40×14 mm media and **100% / actual size** (no "fit to page").

> The **Print** button is disabled until the form is valid (name present, all numbers > 0).

## 5. Photo auto-fill (optional, needs a vision LLM)

Point the app at an OpenAI-compatible multimodal endpoint, then let it read a vial photo.

1. **Set the endpoint.** Edit `LLM_TARGET` in `vite.config.ts` (default
   `http://rastalinuxai.local:8080`). The browser calls same-origin `/v1`, which the dev/preview
   server proxies there — this avoids CORS. Restart `npm run dev` after editing.
2. **Pick the model.** On load the app lists the endpoint's models and auto-selects a
   vision-capable one; use the **Vision model** dropdown to switch. No model id is hardcoded.
   *(Optional: force one with `VITE_LLM_MODEL` — see `.env.example`. Leave unset to auto-pick.)*
3. **Upload a photo.** Use **Vial photo → auto-fill**. Extracted fields (peptide, mg, lot) are
   merged into the form for you to **confirm** — the LLM is best-effort, never authoritative.
4. If the endpoint has no vision model / is unreachable, the app says so and you just keep
   typing. Nothing blocks manual entry.

### QR-linked Certificate of Analysis (CoA)

If the photo contains a **QR code** pointing to a CoA (image or PDF), the app decodes it,
fetches the CoA, reads it with the vision model, and **cross-checks** it against the vial photo:

- CoA values win the merge (manufacturer doc is more authoritative); purity is shown in the note.
- Any disagreement is flagged with a **⚠ mismatch** warning for you to resolve before printing.
- CoA fetch tries the URL directly, then falls back to the dev/preview **`/coa` proxy** on a
  CORS failure. The QR URL is validated first (https/http only; loopback/private hosts refused).

## 6. Verify the LLM endpoint (diagnostic)

```bash
npm run test:live                                   # reachability + text + auto-picked vision
LLM_MODEL=<id> LLM_IMAGE=./vial.jpg npm run test:live   # exercise real image extraction
```

Gated behind `LLM_LIVE=1` (the script sets it). Point `LLM_BASE_URL` / `LLM_MODEL` at your
endpoint; it degrades gracefully if no vision model is present.

## 7. Everyday commands

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Dev server + HMR (proxies `/v1` and `/coa`)          |
| `npm run build`     | Typecheck (`tsc --noEmit`) then bundle to `dist/`    |
| `npm run preview`   | Serve the production build (also proxies `/v1`,`/coa`) |
| `npm test`          | Run the unit test suite                              |
| `npm run test:cov`  | Tests with coverage                                  |
| `npm run lint`      | Biome lint + format check (read-only)                |
| `npm run format`    | Auto-format                                          |

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Label prints wrong size | Select **40 × 14 mm** media and **100% / actual size** (disable "fit to page" / scaling). |
| "Model discovery: …" / auto-fill unavailable | Endpoint down or wrong `LLM_TARGET`. Check it's running: `curl http://<host>:<port>/v1/models`. Restart `npm run dev` after editing `vite.config.ts`. |
| Photo fills nothing | Selected model can't see images — pick another from the **Vision model** dropdown, or the photo is unreadable. |
| CoA won't load | Vendor host blocks CORS **and** you're on a static build (no `/coa` proxy). Run via `npm run dev`/`preview`. Private/loopback CoA URLs are refused by design. |
| Auto-fill features missing entirely | They only appear with the dev/preview server running; a bare static file host has no `/v1` or `/coa` proxy. |

See [README.md](./README.md) for an overview and [CLAUDE.md](./CLAUDE.md) for architecture.
