// main.js — entry point

import { PdfViewer } from './pdf-viewer.js';
import { saveState, loadState } from './storage.js';
import { savePdf, loadPdf, clearPdf } from './pdf-store.js';

// DOM elements
const welcome = document.getElementById('welcome');
const toolbar = document.getElementById('toolbar');
const viewport = document.getElementById('viewport');
const container = document.getElementById('pdf-container');
const fileInput = document.getElementById('file-input');
const filenameEl = document.getElementById('filename');
const btnOpenWelcome = document.getElementById('btn-open-welcome');
const btnOpenToolbar = document.getElementById('btn-open-toolbar');
const btnRotate = document.getElementById('btn-rotate');
const btnLock = document.getElementById('btn-lock');

// App state
let viewer = new PdfViewer(container, viewport);
let currentFile = null;
let rotation = 0; // 0 or 270
let userScale = 1.0; // 1.0 = fit width
let scrollLock = false;
let saveTimeout = null;

// Zoom state
let isZooming = false;
let wheelZoomTimeout = null;

// Pinch-to-zoom state
let isPinching = false;
let pinchPrevDist = 0;
let touchUnusedFactor = 1;

/**
 * Quantize scale changes to 1% steps with leftover accumulation (from pdf.js).
 * Prevents sub-percent changes that cause jitter with CSS layout.
 */
function accumulateFactor(previousScale, factor) {
  if (factor === 1) return 1;
  if ((touchUnusedFactor > 1 && factor < 1) || (touchUnusedFactor < 1 && factor > 1)) {
    touchUnusedFactor = 1;
  }
  const newFactor = Math.floor(previousScale * factor * touchUnusedFactor * 100) / (100 * previousScale);
  touchUnusedFactor = factor / newFactor;
  return newFactor;
}

// ===================== File opening =====================

btnOpenWelcome.addEventListener('click', () => fileInput.click());
btnOpenToolbar.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  await openPdf(file);
});

async function openPdf(file) {
  if (currentFile) saveCurrentState();

  // Cancel any in-progress wheel zoom to prevent stale timeout firing
  if (wheelZoomTimeout) {
    clearTimeout(wheelZoomTimeout);
    wheelZoomTimeout = null;
  }
  isZooming = false;

  currentFile = file;
  rotation = 0;
  userScale = 1.0;
  scrollLock = false;
  updateLockButton();
  updateRotateIcon();

  // Show viewer UI
  welcome.style.display = 'none';
  toolbar.style.display = 'flex';
  viewport.style.display = 'block';
  filenameEl.textContent = file.name;

  // Reset scroll
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;

  // Reset viewer rotation to default (vertical) before opening
  if (viewer.isHorizontal) {
    await viewer.setRotation(0);
  }
  applyScrollLock();

  try {
    await viewer.openFile(file);
  } catch (err) {
    console.error('Failed to open PDF:', err);
    alert('Failed to open PDF: ' + err.message);
    // If this was auto-loaded from OPFS, clear it to prevent a startup error loop
    if (loadedFromOpfs) {
      await clearPdf();
      loadedFromOpfs = false;
    }
    return;
  }

  // Persist file to OPFS (skip if loaded from OPFS — already saved there)
  if (!loadedFromOpfs) {
    try {
      await savePdf(file);
    } catch (err) {
      console.error('Failed to persist PDF to OPFS:', err);
    }
  }
  loadedFromOpfs = false;

  // Restore saved state
  const saved = loadState(file);
  if (saved) {
    rotation = saved.rotation || 0;
    userScale = saved.scale || 1.0;
    scrollLock = !!saved.scrollLock;
    updateLockButton();
    updateRotateIcon();

    if (rotation !== 0) {
      await viewer.setRotation(rotation);
    }
    if (userScale !== 1.0) {
      await viewer.setScale(userScale);
    }

    // Restore scroll after layout settles
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        viewport.scrollTop = saved.scrollTop || 0;
        viewport.scrollLeft = saved.scrollLeft || 0;
        viewer.onScroll();
      });
    });
  } else {
    viewer.onScroll();
  }
}

// ===================== Rotation (0 to 270) ====================

function updateRotateIcon() {
  const svg = btnRotate.querySelector('.rotate-icon');
  if (!svg) return;
  svg.classList.toggle('ccw', rotation === 0);
  svg.classList.toggle('cw', rotation === 270);
  btnRotate.classList.toggle('active', rotation === 270);
}

btnRotate.addEventListener('click', async () => {
  rotation = rotation === 0 ? 270 : 0;
  updateRotateIcon();

  // Reset scroll lock on orientation change
  scrollLock = false;
  updateLockButton();

  // Remember which page is centered before layout change
  const centeredPage = viewer.getCenteredPageIndex();

  // Re-apply lock for new direction before layout
  applyScrollLock();

  await viewer.setRotation(rotation);

  // Scroll to the same page after rotation
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      viewer.scrollToPage(centeredPage);
      viewer.onScroll();
      scheduleSave();
    });
  });
});

// ===================== Horizontal scroll lock =====================

btnLock.addEventListener('click', () => {
  scrollLock = !scrollLock;
  updateLockButton();
  applyScrollLock();
  scheduleSave();
});

function updateLockButton() {
  btnLock.classList.toggle('active', scrollLock);
  btnLock.textContent = scrollLock ? '🔏' : '🔓';
  if (viewer.isHorizontal) {
    btnLock.title = scrollLock ? 'Vertical scroll locked' : 'Vertical scroll unlocked';
  } else {
    btnLock.title = scrollLock ? 'Horizontal scroll locked' : 'Horizontal scroll unlocked';
  }
}

/**
 * When rotated 0 (vertical scroll): lock hides overflow-x
 * When rotated 270 (horizontal scroll): lock hides overflow-y
 */
function applyScrollLock() {
  if (viewer.isHorizontal) {
    // Pages scroll horizontally — lock vertical
    viewport.style.overflowX = '';
    viewport.style.overflowY = scrollLock ? 'hidden' : '';
  } else {
    // Pages scroll vertically — lock horizontal
    viewport.style.overflowX = scrollLock ? 'hidden' : '';
    viewport.style.overflowY = '';
  }
}

function clampScale(value) {
  return Math.max(0.5, Math.min(5.0, value));
}

// ===================== Scroll handler =====================

viewport.addEventListener(
  'scroll',
  () => {
    // Don't trigger renders during zoom — they cause flicker
    if (!isZooming) {
      viewer.onScroll();
    }
    scheduleSave();
  },
  { passive: true }
);

// ===================== Desktop zoom (trackpad pinch / Ctrl+wheel) =====================

viewport.addEventListener(
  'wheel',
  e => {
    if (!e.ctrlKey || !currentFile) return;
    e.preventDefault();

    const oldScale = userScale;
    const delta = -e.deltaY;
    const factor = 1 + Math.abs(delta) * 0.005;
    const newScale = clampScale(userScale * (delta > 0 ? factor : 1 / factor));

    // Zoom center = cursor position in viewport coordinates
    const vpRect = viewport.getBoundingClientRect();
    const centerX = e.clientX - vpRect.left;
    const centerY = e.clientY - vpRect.top;

    isZooming = true;
    userScale = newScale;
    viewer.updateSizesOnly(userScale);
    viewer.adjustScrollForZoom(oldScale, newScale, centerX, centerY);

    // Debounce actual canvas render
    if (wheelZoomTimeout) clearTimeout(wheelZoomTimeout);
    wheelZoomTimeout = setTimeout(() => {
      isZooming = false;
      viewer.setScale(userScale);
      scheduleSave();
    }, 200);
  },
  { passive: false }
);

// ===================== Pinch-to-zoom (mobile) =====================

viewport.addEventListener(
  'touchstart',
  e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      isPinching = true;
      isZooming = true;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchPrevDist = Math.sqrt(dx * dx + dy * dy);
    }
  },
  { passive: false }
);

viewport.addEventListener(
  'touchmove',
  e => {
    if (!isPinching || e.touches.length !== 2) return;
    e.preventDefault();

    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Incremental factor from previous touchmove
    const rawFactor = dist / pinchPrevDist;
    const scaleFactor = accumulateFactor(userScale, rawFactor);

    // Midpoint in viewport coordinates (zoom origin)
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const vpRect = viewport.getBoundingClientRect();
    const originX = midX - vpRect.left;
    const originY = midY - vpRect.top;

    const oldScale = userScale;
    const newScale = clampScale(userScale * scaleFactor);

    if (newScale !== oldScale) {
      userScale = newScale;
      viewer.updateSizesOnly(userScale);
      viewer.adjustScrollForZoom(oldScale, newScale, originX, originY);
    }

    pinchPrevDist = dist;
  },
  { passive: false }
);

viewport.addEventListener(
  'touchend',
  () => {
    if (!isPinching) return;
    isPinching = false;
    isZooming = false;
    touchUnusedFactor = 1;
    viewer.setScale(userScale);
    scheduleSave();
  },
  { passive: true }
);

viewport.addEventListener('touchcancel', () => {
  if (!isPinching) return;
  isPinching = false;
  isZooming = false;
  touchUnusedFactor = 1;
});

// ===================== State persistence =====================

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => saveCurrentState(), 500);
}

function saveCurrentState() {
  if (!currentFile) return;
  saveState(currentFile, {
    scrollTop: Math.round(viewport.scrollTop),
    scrollLeft: Math.round(viewport.scrollLeft),
    rotation,
    scale: userScale,
    scrollLock,
  });
}

window.addEventListener('beforeunload', () => saveCurrentState());
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveCurrentState();
});

// ===================== Handle file from file_handlers (OS "Open with") =====================

// Flag to prevent auto-load from racing with an OS file launch
let launchedWithFile = false;

if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async launchParams => {
    for (const handle of launchParams.files) {
      const file = await handle.getFile();
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        launchedWithFile = true;
        await openPdf(file);
        return;
      }
    }
  });
}

// ===================== Auto-load last PDF on startup =====================

let loadedFromOpfs = false;

(async () => {
  // Skip if the OS launched us with a specific file via file_handlers
  if (launchedWithFile) return;

  try {
    const savedPdf = await loadPdf();
    if (savedPdf) {
      loadedFromOpfs = true;
      await openPdf(savedPdf);
    }
  } catch (e) {
    console.error('Auto-load failed:', e);
  }
})();
