// main.js — entry point

import { PdfViewer } from './pdf-viewer.js';
import { saveState, loadState } from './storage.js';

// DOM elements
const welcome = document.getElementById('welcome');
const toolbar = document.getElementById('toolbar');
const viewport = document.getElementById('viewport');
const container = document.getElementById('pdf-container');
const fileInput = document.getElementById('file-input');
const filenameEl = document.getElementById('filename');
const btnOpen = document.getElementById('btn-open');
const btnOpen2 = document.getElementById('btn-open2');
const btnRotate = document.getElementById('btn-rotate');
const btnLock = document.getElementById('btn-lock');

// App state
let viewer = new PdfViewer(container, viewport);
let currentFile = null;
let rotation = 0; // 0 or 270
let userScale = 1.0; // 1.0 = fit width
let horizontalLock = false;
let saveTimeout = null;

// Zoom state
let isZooming = false;
let wheelZoomTimeout = null;

// Pinch-to-zoom state
let pinchStartDist = 0;
let pinchStartScale = 1.0;
let isPinching = false;

// ===================== File opening =====================

btnOpen.addEventListener('click', () => fileInput.click());
btnOpen2.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  await openPdf(file);
});

async function openPdf(file) {
  if (currentFile) saveCurrentState();

  currentFile = file;
  rotation = 0;
  userScale = 1.0;
  horizontalLock = false;
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
  applyHorizontalLock();

  try {
    await viewer.openFile(file);
  } catch (err) {
    console.error('Failed to open PDF:', err);
    alert('Failed to open PDF: ' + err.message);
    return;
  }

  // Restore saved state
  const saved = loadState(file);
  if (saved) {
    rotation = saved.rotation || 0;
    userScale = saved.scale || 1.0;
    horizontalLock = !!saved.horizontalLock;
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

  // Remember which page is centered before layout change
  const centeredPage = viewer.getCenteredPageIndex();

  // Re-apply lock for new direction before layout
  applyHorizontalLock();

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
  horizontalLock = !horizontalLock;
  updateLockButton();
  applyHorizontalLock();
  scheduleSave();
});

function updateLockButton() {
  btnLock.classList.toggle('active', horizontalLock);
  btnLock.textContent = horizontalLock ? '🔏' : '🔓';
  if (viewer.isHorizontal) {
    btnLock.title = horizontalLock ? 'Vertical scroll locked' : 'Vertical scroll unlocked';
  } else {
    btnLock.title = horizontalLock ? 'Horizontal scroll locked' : 'Horizontal scroll unlocked';
  }
}

/**
 * When rotated 0 (vertical scroll): lock hides overflow-x
 * When rotated 270 (horizontal scroll): lock hides overflow-y
 */
function applyHorizontalLock() {
  if (viewer.isHorizontal) {
    // Pages scroll horizontally — lock vertical
    viewport.style.overflowX = '';
    viewport.style.overflowY = horizontalLock ? 'hidden' : '';
  } else {
    // Pages scroll vertically — lock horizontal
    viewport.style.overflowX = horizontalLock ? 'hidden' : '';
    viewport.style.overflowY = '';
  }
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
    const newScale = Math.max(0.5, Math.min(5.0, userScale * (delta > 0 ? factor : 1 / factor)));

    // Zoom center = viewport center (trackpad has no finger point)
    const centerX = viewport.clientWidth / 2;
    const centerY = viewport.clientHeight / 2;

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
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDist = Math.sqrt(dx * dx + dy * dy);
      pinchStartScale = userScale;
    }
  },
  { passive: false }
);

let lastPinchOriginX = 0;
let lastPinchOriginY = 0;

viewport.addEventListener(
  'touchmove',
  e => {
    if (!isPinching || e.touches.length !== 2) return;
    e.preventDefault();

    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ratio = dist / pinchStartDist;

    // Apply CSS transform — no layout changes, instant, no flicker
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const vpRect = viewport.getBoundingClientRect();
    lastPinchOriginX = midX - vpRect.left;
    lastPinchOriginY = midY - vpRect.top;

    container.style.transformOrigin = `${lastPinchOriginX}px ${lastPinchOriginY}px`;
    container.style.transform = `scale(${ratio})`;
  },
  { passive: false }
);

viewport.addEventListener(
  'touchend',
  () => {
    if (!isPinching) return;
    isPinching = false;

    // Calculate final scale from the CSS transform ratio
    const currentTransform = container.style.transform;
    container.style.transform = '';
    container.style.transformOrigin = '';

    if (!currentTransform) return;

    const match = currentTransform.match(/scale\(([^)]+)\)/);
    if (!match) return;
    const ratio = parseFloat(match[1]);
    const newScale = Math.max(0.5, Math.min(5.0, pinchStartScale * ratio));

    if (newScale === pinchStartScale) return;

    // Real resize + scroll correction at the pinch center
    const oldScale = pinchStartScale;
    userScale = newScale;
    viewer.updateSizesOnly(userScale);
    viewer.adjustScrollForZoom(oldScale, newScale, lastPinchOriginX, lastPinchOriginY);

    viewer.setScale(userScale);
    scheduleSave();
  },
  { passive: true }
);

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
    horizontalLock,
  });
}

window.addEventListener('beforeunload', () => saveCurrentState());
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveCurrentState();
});
