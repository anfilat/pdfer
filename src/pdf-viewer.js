// pdf-viewer.js — PDF rendering with PDF.js

import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const PAGE_GAP = 8; // px between pages

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
    this.rotation = 0; // 0 or 90
    this.scale = 1.0;
    this.baseScale = 1.0; // scale that fits width
    this.numPages = 0;
    this.renderTasks = new Map();
    this.pageDims = []; // { width, height } at scale=1, rotation=0
    this.renderedPages = new Set(); // track which pages have been rendered at current scale/rotation
    this.lastRenderKey = '';
  }

  _renderKey() {
    return `${this.baseScale * this.scale}:${this.rotation}`;
  }

  async openFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
    await this._renderVisiblePages();
  }

  _calcBaseScale() {
    if (!this.pageDims.length) return;
    const vpWidth = this.viewport.clientWidth;
    const dim = this.pageDims[0];
    if (this.rotation === 90 || this.rotation === 270) {
      this.baseScale = vpWidth / dim.height;
    } else {
      this.baseScale = vpWidth / dim.width;
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
      // Set a tiny 1x1 placeholder so it's not the default 300x150
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
    if (this.rotation === 90 || this.rotation === 270) {
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

  async _renderPage(pageIndex) {
    if (!this.pdfDoc) return;

    // Cancel existing render for this page
    if (this.renderTasks.has(pageIndex)) {
      this.renderTasks.get(pageIndex).cancel();
      this.renderTasks.delete(pageIndex);
    }

    const canvas = this.pageCanvases[pageIndex];
    const ctx = canvas.getContext('2d');
    const effectiveScale = this.baseScale * this.scale;

    try {
      const page = await this.pdfDoc.getPage(pageIndex + 1);
      const vp = page.getViewport({ scale: effectiveScale, rotation: this.rotation });

      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);

      const task = page.render({ canvasContext: ctx, viewport: vp });
      this.renderTasks.set(pageIndex, task);

      try {
        await task.promise;
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
      // Reset ALL canvases since their content is now stale
      for (let i = 0; i < this.numPages; i++) {
        this.pageCanvases[i].width = 1;
        this.pageCanvases[i].height = 1;
      }
      this.renderedPages.clear();
      this.lastRenderKey = key;
    }

    const vpRect = this.viewport.getBoundingClientRect();
    // Use 3x viewport height as buffer for smoother scrolling
    const buffer = vpRect.height * 3;
    const promises = [];

    for (let i = 0; i < this.numPages; i++) {
      const rect = this.pageWrappers[i].getBoundingClientRect();
      const visible = rect.bottom > vpRect.top - buffer && rect.top < vpRect.bottom + buffer;
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

  /** Set rotation (0 or 90) */
  async setRotation(rotation) {
    this.rotation = rotation;
    this._calcBaseScale();
    this._updateAllWrapperSizes();
    await this._renderVisiblePages();
  }

  /** Set zoom scale multiplier (1.0 = fit width) */
  async setScale(scale) {
    this.scale = scale;
    this._updateAllWrapperSizes();
    await this._renderVisiblePages();
  }

  destroy() {
    this.renderTasks.forEach(task => task.cancel());
    this.renderTasks.clear();
    this.container.innerHTML = '';
    this.pdfDoc = null;
  }
}
