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
let rotation = 0; // 0 or 90
let userScale = 1.0; // 1.0 = fit width
let horizontalLock = false;
let saveTimeout = null;

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

  // Show viewer UI
  welcome.style.display = 'none';
  toolbar.style.display = 'flex';
  viewport.style.display = 'block';
  filenameEl.textContent = file.name;

  // Reset scroll
  viewport.scrollLeft = 0;
  viewport.scrollTop = 0;

  try {
    await viewer.openFile(file);
  } catch (err) {
    console.error('Failed to open PDF:', err);
    alert('Не удалось открыть PDF: ' + err.message);
    return;
  }

  // Restore saved state
  const saved = loadState(file);
  if (saved) {
    rotation = saved.rotation || 0;
    userScale = saved.scale || 1.0;
    horizontalLock = !!saved.horizontalLock;
    updateLockButton();

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

// ===================== Rotation (0 ↔ 90) =====================

btnRotate.addEventListener('click', async () => {
  rotation = rotation === 0 ? 90 : 0;
  btnRotate.classList.toggle('active', rotation === 90);

  // Remember proportional scroll position
  const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
  const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
  const ratioTop = maxScrollTop > 0 ? viewport.scrollTop / maxScrollTop : 0;
  const ratioLeft = maxScrollLeft > 0 ? viewport.scrollLeft / maxScrollLeft : 0;

  await viewer.setRotation(rotation);

  // Restore proportional position
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const newMaxTop = viewport.scrollHeight - viewport.clientHeight;
      const newMaxLeft = viewport.scrollWidth - viewport.clientWidth;
      viewport.scrollTop = ratioTop * newMaxTop;
      viewport.scrollLeft = ratioLeft * newMaxLeft;
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
  btnLock.title = horizontalLock ? 'Горизонтальный скролл заблокирован' : 'Горизонтальный скролл разблокирован';
}

function applyHorizontalLock() {
  if (horizontalLock) {
    // Freeze horizontal scroll by hiding overflow-x
    viewport.style.overflowX = 'hidden';
  } else {
    viewport.style.overflowX = 'auto';
  }
}

// ===================== Scroll handler =====================

viewport.addEventListener(
  'scroll',
  () => {
    viewer.onScroll();
    scheduleSave();
  },
  { passive: true }
);

// ===================== Pinch-to-zoom =====================

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

viewport.addEventListener(
  'touchmove',
  e => {
    if (!isPinching || e.touches.length !== 2) return;
    e.preventDefault();

    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ratio = dist / pinchStartDist;
    const newScale = Math.max(0.5, Math.min(5.0, pinchStartScale * ratio));

    if (Math.abs(newScale - userScale) / userScale > 0.03) {
      userScale = newScale;
      viewer.setScale(userScale);
      scheduleSave();
    }
  },
  { passive: false }
);

viewport.addEventListener(
  'touchend',
  e => {
    if (e.touches.length < 2) {
      isPinching = false;
    }
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
