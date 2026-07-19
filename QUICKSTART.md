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
> only run it on a network you trust. The `/coa` proxy will fetch **any** http(s) host (including
> LAN/private addresses) by design; keep it on a trusted network. Accessing by **IP** works out of
> the box; `.local` mDNS hostnames are already allowed, and any other custom hostname can be added
> to `server.allowedHosts` / `preview.allowedHosts` in `vite.config.ts`.

### Auto-start on boot (systemd service)

To keep the app always running on this host and start it automatically at boot:

```bash
scripts/install-service.sh        # installs & enables a systemd *user* service
```

This renders `deploy/label-maker.service.in` into `~/.config/systemd/user/label-maker.service`
(resolving your nvm Node path), enables lingering so it starts without a login session, and
serves on `0.0.0.0:4173`. On each start it rebuilds from source, then runs `vite preview`.

```bash
systemctl --user status label-maker      # health
systemctl --user restart label-maker     # rebuild + restart
journalctl --user -u label-maker -f      # follow logs
scripts/uninstall-service.sh             # stop, disable, remove
```

> Re-run `scripts/install-service.sh` after upgrading Node via nvm (it re-resolves the Node path).
> Uses a **user** service (not root) because Node is nvm-managed under your home directory.

## 4. Make a label (the 30-second path)

1. Fill in **Peptide name**, **Vial (mg)**, **BAC water (mL)**, **Dose (mcg)**.
   Set the **vial amount** from the common-mg picker (5/10/20/24/30/40/50/60 mg) or type a
   custom value; optionally set **Lot**, **Date**, **Manufacturer**, or start from a **Preset**
   (30+ peptides — GLP-1s, GH secretagogues, healing, cognitive, blends…). Preset BAC-water and
   dose values are **conventional starting points, not medical advice** — confirm them against
   your protocol.
2. The preview (right) updates live and shows the derived dosing. Example — **5 mg + 2 mL,
   250 mcg dose** →

   | Concentration | Draw volume | Syringe (U-100) | Doses/vial |
   | ------------- | ----------- | --------------- | ---------- |
   | 2.5 mg/mL     | 0.1 mL      | **10 IU**       | 20         |

3. Click **Print**. In the browser dialog choose your Nelko/label printer, or **Save as PDF**
   to export a file. The stylesheet sizes the page to exactly 40 × 14 mm — set the printer to
   the 40×14 mm media and **100% / actual size** (no "fit to page").

   Or click **Copy image** to get a PNG of the label at true size. On a secure context
   (`localhost` or HTTPS) it copies straight to the clipboard; over plain-http LAN it downloads
   the PNG instead (the note tells you which happened). Handy for sharing or printing from a phone.

> The **Print** / **Copy image** buttons are disabled until the form is valid (name present,
> all numbers > 0).

## 5. Photo auto-fill (optional, needs a vision LLM)

Point the app at an OpenAI-compatible multimodal endpoint, then let it read a vial photo.

1. **Set the endpoint.** Type it in the **LLM endpoint** field (default
   `http://rastalinuxai.local:8081/v1`); it commits on blur/Enter and re-discovers models. The
   browser calls it **directly**, so the endpoint must allow CORS (LAN inference servers usually
   do). No CORS? Set the field to `/v1` to route through the dev/preview proxy (`LLM_TARGET` in
   `vite.config.ts`).
2. **Pick the model.** On load (and whenever the endpoint changes) the app lists the endpoint's
   models and auto-selects a vision-capable one; use the **Model** dropdown to pick any of them.
   No model id is hardcoded. *(Optional build-time default: `VITE_LLM_MODEL`.)*
3. **Upload a photo.** Use **Vial photo → auto-fill**. Extracted fields (peptide, mg, lot) are
   merged into the form for you to **confirm** — the LLM is best-effort, never authoritative.
4. If the endpoint has no vision model / is unreachable, the app says so and you just keep
   typing. Nothing blocks manual entry.

### Certificate of Analysis (CoA) — by QR code or by URL

Two ways to pull peptide facts off a CoA:

- **QR code in the photo.** If the vial photo contains a QR pointing to a CoA (image or PDF),
  the app decodes it, fetches the CoA, reads it with the vision model, and **cross-checks** it
  against the vial photo. CoA values win the merge (manufacturer doc is more authoritative),
  purity is shown in the note, and any disagreement is flagged with a **⚠ mismatch** warning.
- **CoA / image URL field.** Paste a direct link to a CoA (PDF or image) or a vial image and
  click **Fetch**; the app reads it and pre-fills the form (single source, no cross-check).

CoA fetch tries the URL directly, then falls back to the dev/preview **`/coa` proxy** on a CORS
failure. URLs are validated for **http(s) scheme only** — **any host is allowed**, including
LAN/private/`.local` addresses (this runs on a trusted LAN where CoAs are often self-hosted).
The link must point at the image/PDF itself; an HTML product page won't work.

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
| `npm run serve`     | Build, then serve on `0.0.0.0:4173` for LAN access   |
| `npm test`          | Run the unit test suite                              |
| `npm run test:cov`  | Tests with coverage                                  |
| `npm run lint`      | Biome lint + format check (read-only)                |
| `npm run format`    | Auto-format                                          |

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Label prints wrong size | Select **40 × 14 mm** media and **100% / actual size** (disable "fit to page" / scaling). |
| "Model discovery: …" / auto-fill unavailable | Wrong URL in the **LLM endpoint** field or endpoint down. Check it: `curl http://<host>:<port>/v1/models`. If it's up but the browser can't reach it, the endpoint likely lacks **CORS** — set the field to `/v1` to use the proxy (and point `LLM_TARGET` at the host). |
| Photo fills nothing | Selected model can't see images — pick another from the **Vision model** dropdown, or the photo is unreadable. |
| CoA won't load | Vendor host blocks CORS **and** you're on a static build (no `/coa` proxy). Run via `npm run dev`/`preview`/`serve`. The link must point at the image/PDF itself (not an HTML page). |
| Auto-fill features missing entirely | They only appear with the dev/preview server running; a bare static file host has no `/v1` or `/coa` proxy. |
| Service won't start after `nvm` upgrade | The unit pins the Node bin dir. Re-run `scripts/install-service.sh` to re-resolve it, then `systemctl --user restart label-maker`. |
| Port 4173 already in use | A stale `vite preview` is holding it. `systemctl --user restart label-maker`, or `lsof -tiTCP:4173 -sTCP:LISTEN \| xargs -r kill`. |

See [README.md](./README.md) for an overview and [CLAUDE.md](./CLAUDE.md) for architecture.
