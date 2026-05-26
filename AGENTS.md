# PDFer — AGENTS.md

## Project overview

PWA PDF viewer optimised for Android phones. Core features:

- Open PDF files from device (`<input type="file">`)
- Continuous scroll through all pages (no page-by-page navigation)
- Rotate PDF 0° ↔ 90° (native PDF.js rotation, not CSS transform)
- Pinch-to-zoom (touch gesture, re-renders at new scale)
- Horizontal scroll lock (toggle via button, implemented as `overflow-x: hidden`)
- Persist viewing state per file (scrollTop, scrollLeft, rotation, scale, horizontalLock) in localStorage
- Installable as PWA (manifest + auto-generated Service Worker via vite-plugin-pwa)

## Tech stack

| Layer | Technology |
|---|---|
| Build | Vite 8 |
| PDF rendering | pdfjs-dist 4.x |
| PWA | vite-plugin-pwa (generateSW mode) |
| Linting | oxlint |
| Formatting | oxfmt |
| Git hooks | simple-git-hooks (pre-commit: format check + lint) |

No framework — vanilla JS modules, no JSX, no TypeScript.

## Commands

```bash
npm run dev          # Vite dev server with HMR
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
npm run lint         # oxlint src/
npm run lint:fix     # oxlint --fix src/
npm run format       # oxfmt src/
npm run format:check # oxfmt --check src/
```

## File structure

```
index.html              Main HTML (welcome screen, toolbar, viewport). All CSS is inline in <style>.
vite.config.js          Vite config + PWA manifest + Workbox settings.
src/
  main.js               Entry point. UI wiring: file input, toolbar buttons, pinch-to-zoom gesture,
                         horizontal lock toggle, state persistence (debounced save to localStorage).
  pdf-viewer.js          PdfViewer class — wraps pdfjs-dist. Manages page rendering lifecycle:
                         lazy rendering of visible pages (with 3x viewport buffer), rotation via
                         page.getViewport({ rotation }), scale via re-render at new effective scale.
  storage.js             saveState / loadState / clearState — localStorage wrapper keyed by
                         `pdf:<filename>:<filesize>`.
public/
  manifest.json          Static manifest (vite-plugin-pwa generates its own at build time).
  sw.js                  Not used in prod (vite-plugin-pwa generates SW). Kept as fallback.
  icons/                 icon-192.png, icon-512.png — PWA icons.
  test.pdf               Test PDF (5 pages) for development.
```

## Architecture

### Rendering pipeline

1. `PdfViewer.openFile(file)` reads ArrayBuffer → `pdfjsLib.getDocument()` → iterates all pages to collect base dimensions at scale=1
2. `_calcBaseScale()` — determines scale that makes page width = viewport width (accounts for rotation: at 90°, original height becomes width)
3. `_createPages()` — creates a `<div class="page-wrapper">` + `<canvas>` for each page. Canvas starts at 1×1 (not 300×150 default)
4. `_updateAllWrapperSizes()` — sets CSS width/height on every wrapper based on current scale+rotation. This ensures scrollbar dimensions are correct even for unrendered pages
5. `_renderVisiblePages()` — uses `getBoundingClientRect()` to check which wrappers intersect the viewport (with 3x buffer). Only those pages are rendered via `page.render()`
6. On scroll → `onScroll()` → `_renderVisiblePages()` renders newly visible pages
7. On rotation/scale change → all canvases reset to 1×1 → `_updateAllWrapperSizes()` → `_renderVisiblePages()` re-renders visible pages at new parameters

### Key invariant: `_renderKey()`

`baseScale * scale : rotation` — when this changes, all canvas content is stale and gets reset. The `renderedPages` Set tracks which pages have been rendered at the current key.

### State persistence

- Key: `pdf:<file.name>:<file.size>`
- Saved: `{ scrollTop, scrollLeft, rotation, scale, horizontalLock }`
- Triggered by: scroll (debounced 500ms), rotation, zoom, lock toggle, `beforeunload`, `visibilitychange` (hidden)
- Restored on file open: applies rotation → scale → scroll position (after 2x rAF for layout)

### Horizontal scroll lock

Implemented by toggling `overflow-x` on `#viewport` between `hidden` (locked) and `auto` (free). No JS scroll-event hacking.

### Pinch-to-zoom

Touch handlers on `#viewport`: `touchstart` (2 fingers → record start distance + current scale), `touchmove` (calculate ratio, apply if >3% change), `touchend` (reset). Calls `viewer.setScale()` which re-renders visible pages.

Browser zoom is prevented via `touch-action: pan-x pan-y` on `#viewport` and `touch-action: none` on `body`.

## Known limitations / future work

- No IndexedDB — large PDF state could exceed localStorage quota
- No virtual scroll — all page wrappers are in DOM simultaneously; large PDFs (100+ pages) may be slow
- No keyboard shortcuts
- Pinch-to-zoom re-renders visible pages on every >3% change — may lag on slow devices
- Icons are minimal auto-generated PNGs — should be replaced with proper app icons
