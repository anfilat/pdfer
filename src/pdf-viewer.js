// pdf-viewer.js — PDF rendering with PDF.js

import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

const BASE = import.meta.env.BASE_URL;

export class PdfViewer {
  /**
   * @param {HTMLElement} container - where page canvases go
   * @param {HTMLElement} viewport - scrollable viewport
   */
  constructor(container, viewport) {
    this.container = container;
    this.viewport = viewport;
    this.pdfDoc = null;
    this.pageCanvases = [];
    this.pageWrappers = [];
    this.rotation = 0; // 0 or 270
    this.scale = 1.0;
    this.baseScale = 1.0; // scale that fits width (0°) or height (90°)
    this.numPages = 0;
    this.renderTasks = new Map();
    this.pageDims = []; // { width, height } at scale=1, rotation=0
    this.renderedPages = new Set();
    this.lastRenderKey = '';
  }

  _renderKey() {
    return `${this.baseScale * this.scale}:${this.rotation}`;
  }

  /** Whether pages are laid out horizontally */
  get isHorizontal() {
    return this.rotation === 270 || this.rotation === 90;
  }

  async openFile(file) {
    // Release previous PDF.js document resources (parsed pages, font caches, WASM allocations)
    if (this.pdfDoc) this.pdfDoc.destroy();

    // Cancel in-flight renders from previous document
    this.renderTasks.forEach(task => task.cancel());
    this.renderTasks.clear();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      wasmUrl: `${BASE}wasm/`,
      standardFontDataUrl: `${BASE}standard_fonts/`,
    }).promise;
    this.pdfDoc = pdf;
    this.numPages = pdf.numPages;
    this.pageCanvases = [];
    this.pageWrappers = [];
    this.pageDims = [];
    this.renderedPages.clear();
    this.lastRenderKey = '';

    // Get base dimensions for each page (scale=1, rotation=0)
    for (let i = 1; i <= this.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      this.pageDims.push({ width: vp.width, height: vp.height });
    }

    this._calcBaseScale();
    this._createPages();
    this._updateAllWrapperSizes();
    this._updateLayoutDirection();
    await this._renderVisiblePages();
  }

  /** Calculate base scale so pages fit the viewport */
  _calcBaseScale() {
    if (!this.pageDims.length) return;
    const dim = this.pageDims[0];
    if (this.isHorizontal) {
      // Fit page height to viewport height (pages scroll left-right)
      this.baseScale = this.viewport.clientHeight / dim.width;
    } else {
      // Fit page width to viewport width (pages scroll top-bottom)
      this.baseScale = this.viewport.clientWidth / dim.width;
    }
  }

  _createPages() {
    this.container.innerHTML = '';
    this.pageCanvases = [];
    this.pageWrappers = [];

    for (let i = 0; i < this.numPages; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'page-wrapper';
      wrapper.dataset.pageIndex = i;

      const canvas = document.createElement('canvas');
      // Tiny placeholder — avoids default 300×150
      canvas.width = 1;
      canvas.height = 1;
      wrapper.appendChild(canvas);
      this.container.appendChild(wrapper);
      this.pageCanvases.push(canvas);
      this.pageWrappers.push(wrapper);
    }
  }

  _getPageDisplaySize(pageIndex) {
    const dim = this.pageDims[pageIndex];
    const effectiveScale = this.baseScale * this.scale;
    if (this.isHorizontal) {
      // Rotated 270°: natural width becomes height, natural height becomes width
      return { width: dim.height * effectiveScale, height: dim.width * effectiveScale };
    }
    return { width: dim.width * effectiveScale, height: dim.height * effectiveScale };
  }

  _updateAllWrapperSizes() {
    for (let i = 0; i < this.numPages; i++) {
      const { width, height } = this._getPageDisplaySize(i);
      const wrapper = this.pageWrappers[i];
      wrapper.style.width = Math.floor(width) + 'px';
      wrapper.style.height = Math.floor(height) + 'px';
    }
  }

  /** Toggle CSS class for horizontal vs vertical page flow */
  _updateLayoutDirection() {
    this.container.classList.toggle('horizontal', this.isHorizontal);
  }

  async _renderPage(pageIndex) {
    if (!this.pdfDoc) return;

    // Cancel existing render for this page
    if (this.renderTasks.has(pageIndex)) {
      this.renderTasks.get(pageIndex).cancel();
      this.renderTasks.delete(pageIndex);
    }

    const effectiveScale = this.baseScale * this.scale;

    try {
      const page = await this.pdfDoc.getPage(pageIndex + 1);
      const vp = page.getViewport({ scale: effectiveScale, rotation: this.rotation });

      // Render to offscreen canvas to avoid flicker
      const offscreen = document.createElement('canvas');
      offscreen.width = Math.floor(vp.width);
      offscreen.height = Math.floor(vp.height);

      const ctx = offscreen.getContext('2d');
      const task = page.render({ canvasContext: ctx, viewport: vp });
      this.renderTasks.set(pageIndex, task);

      try {
        await task.promise;
        // Swap: replace old canvas with the freshly rendered one
        const oldCanvas = this.pageCanvases[pageIndex];
        oldCanvas.replaceWith(offscreen);
        this.pageCanvases[pageIndex] = offscreen;
        this.renderedPages.add(pageIndex);
      } catch (e) {
        if (e.name !== 'RenderingCancelledException') throw e;
      } finally {
        this.renderTasks.delete(pageIndex);
      }
    } catch (e) {
      console.warn(`Failed to render page ${pageIndex + 1}:`, e);
    }
  }

  async _renderVisiblePages() {
    const key = this._renderKey();
    const scaleChanged = key !== this.lastRenderKey;
    if (scaleChanged) {
      this.renderedPages.clear();
      this.lastRenderKey = key;
    }

    const vpRect = this.viewport.getBoundingClientRect();
    // 3x viewport buffer for smooth scrolling
    const bufferH = vpRect.height * 3;
    const bufferW = vpRect.width * 3;
    const promises = [];

    for (let i = 0; i < this.numPages; i++) {
      const rect = this.pageWrappers[i].getBoundingClientRect();
      const visible =
        rect.bottom > vpRect.top - bufferH &&
        rect.top < vpRect.bottom + bufferH &&
        rect.right > vpRect.left - bufferW &&
        rect.left < vpRect.right + bufferW;
      if (visible && (scaleChanged || !this.renderedPages.has(i))) {
        promises.push(this._renderPage(i));
      }
    }

    await Promise.all(promises);
  }

  /** Called after scroll — render pages that came into view */
  onScroll() {
    this._renderVisiblePages();
  }

  /** Get index of the page closest to viewport center */
  getCenteredPageIndex() {
    const vpRect = this.viewport.getBoundingClientRect();
    const cx = vpRect.left + vpRect.width / 2;
    const cy = vpRect.top + vpRect.height / 2;

    let bestIndex = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.pageWrappers.length; i++) {
      const rect = this.pageWrappers[i].getBoundingClientRect();
      const dx = Math.max(0, Math.abs(cx - (rect.left + rect.width / 2)) - rect.width / 2);
      const dy = Math.max(0, Math.abs(cy - (rect.top + rect.height / 2)) - rect.height / 2);
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  /** Scroll so that the given page is centered in the viewport */
  scrollToPage(index) {
    const wrapper = this.pageWrappers[index];
    if (!wrapper) return;
    wrapper.scrollIntoView({ block: 'center', inline: 'center' });
  }

  /** Set rotation (0 or 270) */
  async setRotation(rotation) {
    this.rotation = rotation;
    this._calcBaseScale();
    this._updateAllWrapperSizes();
    this._updateLayoutDirection();
    await this._renderVisiblePages();
  }

  /**
   * Adjust viewport scroll so the document point under (centerX, centerY)
   * stays in place after scale change.
   * @param {number} oldScale
   * @param {number} newScale
   * @param {number} centerX - point X in viewport coords (clientX - vpRect.left)
   * @param {number} centerY - point Y in viewport coords (clientY - vpRect.top)
   */
  adjustScrollForZoom(oldScale, newScale, centerX, centerY) {
    const ratio = newScale / oldScale;
    this.viewport.scrollLeft = (this.viewport.scrollLeft + centerX) * ratio - centerX;
    this.viewport.scrollTop = (this.viewport.scrollTop + centerY) * ratio - centerY;
  }

  /** Full render at given scale */
  async setScale(scale) {
    this.scale = scale;
    this._updateAllWrapperSizes();
    await this._renderVisiblePages();
  }

  /**
   * Update CSS sizes only — no canvas render.
   * Used during zoom gestures to keep UI responsive.
   * Old canvas content stretches to fill, preventing flicker.
   */
  updateSizesOnly(scale) {
    this.scale = scale;
    this._updateAllWrapperSizes();
  }

  destroy() {
    this.renderTasks.forEach(task => task.cancel());
    this.renderTasks.clear();
    this.container.innerHTML = '';
    this.pdfDoc = null;
  }
}
