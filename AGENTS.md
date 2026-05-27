# PDFer — AGENTS.md

## Project overview

PWA PDF viewer optimised for Android phones. Core features:

- Open PDF files from device (`<input type="file">`)
- Auto-load last-opened PDF on launch (persisted via OPFS)
- Continuous scroll through all pages (no page-by-page navigation)
- Rotate PDF 0° ↔ 270° (native PDF.js rotation, not CSS transform)
- Horizontal scroll mode when rotated (CSS inline-block layout)
- Pinch-to-zoom (mobile: CSS transform during gesture → re-render on end)
- Desktop zoom (Ctrl+wheel / trackpad pinch)
- Scroll lock (toggle via button: hides overflow on the cross-axis)
- Persist viewing state per file (scrollTop, scrollLeft, rotation, scale, scrollLock) in localStorage
- Installable as PWA (manifest + auto-generated Service Worker via vite-plugin-pwa)

## Tech stack

| Layer | Technology |
|---|---|
| Build | Vite 8 |
| PDF rendering | pdfjs-dist 5.x |
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
vite.config.js          Vite config: base '/pdfer/', PWA manifest (vite-plugin-pwa, generateSW mode),
                         Workbox settings (globs include wasm, fonts, etc.), devOptions for manifest in dev.
src/
  main.js               Entry point. UI wiring: file input, toolbar buttons, pinch-to-zoom gesture,
                         desktop Ctrl+wheel zoom, horizontal lock toggle, state persistence (debounced save
                         to localStorage), auto-load last PDF from OPFS on startup.
  pdf-viewer.js          PdfViewer class — wraps pdfjs-dist 5.x. Manages page rendering lifecycle:
                         lazy rendering of visible pages (with 3x viewport buffer), rotation via
                         page.getViewport({ rotation }), scale via re-render at new effective scale.
                         Flicker-free zoom via updateSizesOnly() (CSS stretch) + offscreen canvas swap.
                         Scroll-correcting zoom via adjustScrollForZoom().
  pdf-store.js           OPFS-based persistence: savePdf / loadPdf / clearPdf. Stores the last-opened
                         PDF file in Origin Private File System so it survives page reloads / PWA restarts.
                         File metadata (name, size, type) kept in localStorage for File reconstruction.
  storage.js             saveState / loadState / clearState — localStorage wrapper keyed by
                         `pdf:<filename>:<filesize>`.
public/
  favicon.svg            SVG favicon (white document with red "PDF" text).
  icons/                 icon-192.png, icon-512.png — PWA icons.
  pdf.worker.min.mjs     PDF.js Web Worker (bundled from pdfjs-dist).
  standard_fonts/        Standard PDF fonts (bundled from pdfjs-dist).
  wasm/                  PDF.js WASM modules (bundled from pdfjs-dist).
.github/
  workflows/
    deploy.yml           GitHub Actions: build + deploy to GitHub Pages (actions v6/v5, Node 24).
```

## Architecture

### Rendering pipeline

1. `PdfViewer.openFile(file)` reads ArrayBuffer → `pdfjsLib.getDocument()` (with `wasmUrl` and `standardFontDataUrl`) → iterates all pages to collect base dimensions at scale=1
2. `_calcBaseScale()` — determines scale that makes page width = viewport width (vertical mode) or page height = viewport height (horizontal mode, when rotated 270°)
3. `_createPages()` — creates a `<div class="page-wrapper">` + `<canvas>` for each page. Canvas starts at 1×1 (not 300×150 default)
4. `_updateAllWrapperSizes()` — sets CSS width/height on every wrapper based on current scale+rotation. This ensures scrollbar dimensions are correct even for unrendered pages
5. `_updateLayoutDirection()` — toggles `.horizontal` class on container: inline-block layout for rotated mode, normal block flow for vertical mode
6. `_renderVisiblePages()` — uses `getBoundingClientRect()` to check which wrappers intersect the viewport (with 3x buffer). Only those pages are rendered via offscreen canvas + `replaceWith()` swap
7. On scroll → `onScroll()` → `_renderVisiblePages()` renders newly visible pages
8. On rotation/scale change → all canvases reset → `_updateAllWrapperSizes()` → `_renderVisiblePages()` re-renders visible pages at new parameters

### Key invariant: `_renderKey()`

`baseScale * scale : rotation` — when this changes, all canvas content is stale and gets cleared. The `renderedPages` Set tracks which pages have been rendered at the current key.

### Flicker-free zoom

- **`updateSizesOnly(scale)`** — updates wrapper CSS sizes without re-rendering canvases. Existing canvas content stretches via CSS `width/height: 100%`, preventing blank flash during continuous zoom gestures.
- **Offscreen canvas swap** — `_renderPage()` renders to a detached canvas, then replaces the old canvas in DOM via `replaceWith()`. Eliminates intermediate blank states.
- **`adjustScrollForZoom(oldScale, newScale, centerX, centerY)`** — corrects viewport scroll position so the document point under the zoom center stays in place.

### Pinch-to-zoom (mobile)

Touch handlers on `#viewport`:
1. `touchstart` (2 fingers) → record start distance + current scale
2. `touchmove` → calculate ratio, apply CSS `transform: scale(ratio)` with `transformOrigin` at pinch midpoint. No layout changes — instant, no flicker
3. `touchend` → read final ratio from CSS transform → compute new scale → `updateSizesOnly()` + `adjustScrollForZoom()` → `setScale()` for actual re-render

Browser zoom is prevented via `touch-action: pan-x pan-y` on `#viewport` and `touch-action: none` on `body`.

### Desktop zoom

`wheel` event with `ctrlKey` on `#viewport`: debounced zoom with `updateSizesOnly()` during gesture → `setScale()` on timeout (200ms). Zoom center = viewport center.

### Rotation (0° ↔ 270°)

- `setRotation()` recalculates base scale, updates wrapper sizes, toggles layout direction, re-renders
- Before rotation: `getCenteredPageIndex()` records which page is centered
- After rotation: `scrollToPage()` scrolls to the same page via `scrollIntoView({ block: 'center', inline: 'center' })`
- Scroll lock resets on rotation (cross-axis changes)

### OPFS file persistence (`pdf-store.js`)

- `savePdf(file)` — writes the File blob to OPFS as `last-opened.pdf`, stores metadata (name, size, type) in localStorage under `opfs:pdfMeta`
- `loadPdf()` — reads from OPFS, reconstructs a `File` with the original name (needed for storage key matching)
- On app startup: `loadPdf()` is called; if a saved file exists, it's opened automatically
- On every file open: `savePdf()` is called after successful load

### State persistence (`storage.js`)

- Key: `pdf:<file.name>:<file.size>`
- Saved: `{ scrollTop, scrollLeft, rotation, scale, scrollLock }`
- Triggered by: scroll (debounced 500ms), rotation, zoom, lock toggle, `beforeunload`, `visibilitychange` (hidden)
- Restored on file open: applies rotation → scale → scroll position (after 2x rAF for layout)

### Horizontal scroll mode

When rotated 270°, the container gets class `.horizontal`:
- Pages become `display: inline-block` with `white-space: nowrap` on the container
- Pages scroll horizontally via natural `overflow-x: auto`
- Scroll lock hides `overflow-y` (cross-axis) instead of `overflow-x`

### PWA / Service Worker

- `vite-plugin-pwa` in `generateSW` mode
- Workbox glob patterns include `js`, `mjs`, `css`, `html`, `png`, `svg`, `wasm`, `ttf`, `pfb` — covers all PDF.js assets
- `registerType: 'autoUpdate'` — SW updates automatically
- Dev mode: PWA manifest is available via `devOptions.enabled: true`

## Known limitations / future work

- No IndexedDB — large PDF state could exceed localStorage quota
- No virtual scroll — all page wrappers are in DOM simultaneously; large PDFs (100+ pages) may be slow
- No keyboard shortcuts
- OPFS file is overwritten on each open — no multi-file history
- Icons are SVG-based PNGs generated via sharp — design matches favicon.svg
