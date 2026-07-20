---
name: screenshot-app
description: Screenshot the running Label Maker web app at desktop and mobile viewports using the Playwright MCP browser tools, then report any responsive problems. Use when asked to see/show/screenshot the app, verify the UI visually, or check the mobile/responsive layout. Requires the Playwright MCP (browser_* tools); if they are missing, tell the user to restart Claude Code (it was installed at ~/.claude-mcp/playwright).
---

# Screenshot the app at desktop + mobile

Capture the running app at several viewport widths, surface each screenshot, and
flag responsive issues (horizontal scroll, clipping, overlap, tiny tap targets).

## Arguments (optional)

`$ARGUMENTS` may contain a target URL and/or extra viewport widths.
- Default URL: `http://localhost:4173/` (the systemd `label-maker` service / `npm run serve`).
- If a URL is given, use it instead. If widths are given (e.g. `375 768 1440`), add them.

## Preconditions

1. Confirm the Playwright MCP browser tools are available (names begin `browser_`,
   e.g. `browser_navigate`, `browser_resize`, `browser_take_screenshot`,
   `browser_snapshot`, `browser_close`). If they are **not** loaded, stop and tell
   the user to restart Claude Code — the MCP is installed but tools load at startup.
2. Verify the app is reachable. Run `curl -s -o /dev/null -w '%{http_code}' http://localhost:4173/`.
   If it is not `200`, start it: `systemctl --user restart label-maker` (preferred), or
   `npm run serve` in the repo, then re-check. Note in your report if you had to start it.

## Procedure

For each viewport below (in this order), using the Playwright MCP tools:

| Label   | Width × Height | Notes                          |
| ------- | -------------- | ------------------------------ |
| Desktop | 1280 × 900     | two-column grid layout         |
| Tablet  | 720 × 1024     | the max-width:720px breakpoint |
| Mobile  | 390 × 844      | iPhone-class; primary check    |
| Narrow  | 360 × 780      | small Android; single-column   |

1. `browser_resize` to the width/height.
2. `browser_navigate` to the URL (navigate fresh each time so media queries apply
   cleanly), then wait ~1s for model discovery to settle.
3. `browser_take_screenshot` (full page). Give each a clear filename, e.g.
   `label-maker-mobile-390.png`. Screenshots are written to the MCP output dir
   (`~/.claude-mcp/playwright-output/`, configured in the server registration) —
   `Read` them from there to view; they do NOT land in the repo.
4. Detect horizontal overflow — via `browser_snapshot` or by evaluating
   `document.documentElement.scrollWidth > window.innerWidth`. If it overflows,
   find the offending element (evaluate over `body *` for `getBoundingClientRect().right > innerWidth`).
   The usual culprit is a long `<select>`/`<option>` or fixed-width child forcing
   a grid/flex track — the `.app` grid uses `minmax(0, 1fr)` to guard against it.

Then `browser_close`.

## Report

- Show/attach each screenshot with its label and width.
- A short table: viewport → horizontal-scroll (yes/no) → any issue seen
  (clipped label, overlapping controls, buttons not full-width on mobile,
  inputs < 16px causing iOS zoom, etc.).
- Lead with a one-line verdict (e.g. "Responsive at all four widths, no overflow")
  and list concrete fixes only if something is actually wrong. Do not invent issues.

## Notes

- The label preview is intentionally magnified on screen via CSS `zoom` and is
  reset to true 40×14 mm for print — a large-looking preview is expected, not a bug.
- Keep it read-only: navigate + screenshot. Don't submit forms or click Print/Fetch
  unless the user asks you to exercise a specific flow.
