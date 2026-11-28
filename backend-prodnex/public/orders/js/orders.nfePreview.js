// ╔══════════════════════════════════════════════════════════════════════╗
// ║ orders.nfePreview.js — Pré-visualização do DANFE antes de emitir     ║
// ║ Mesmo comportamento do preview do orçamento (budgets.nfePreview.js): ║
// ║ ✅ PDF.js em canvas (sem iframe, sem download)                        ║
// ║ ✅ Zoom: aumentar, diminuir, 100% e ajustar à largura                 ║
// ║ ✅ Atalhos Ctrl +, Ctrl -, Ctrl 0, Ctrl + roda do mouse, Esc          ║
// ║ ✅ Botão "Emitir NF-e" no modal chama a emissão do pedido             ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import * as pdfjsLib from '/public/vendor/pdfjs/pdf.mjs';
import { showCenterModal } from '/public/includes/js/centerAlertModal.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/public/vendor/pdfjs/pdf.worker.mjs';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
const BASE_SCALE = 1.25;

let loadingTask = null;
let pdfDocument = null;
let renderTasks = [];
let renderVersion = 0;
let zoom = 1;
let currentOrderId = null;
let onIssue = null;
let bound = false;

const $ = (selector) => document.querySelector(selector);

function getAuthToken() {
  const keys = ['token', 'access_token', 'accessToken', 'jwt', 'auth_token', 'consart_token'];
  for (const key of keys) {
    try {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    } catch {
      // storage indisponível
    }
  }
  return null;
}

/* ========================= Zoom ========================= */

function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(value) || 1));
}

function updateZoomDisplay() {
  const label = $('#orderNfeZoomValue');
  if (label) label.textContent = `${Math.round(zoom * 100)}%`;

  const zoomOut = $('#btnOrderNfeZoomOut');
  const zoomIn = $('#btnOrderNfeZoomIn');
  if (zoomOut) zoomOut.disabled = zoom <= MIN_ZOOM;
  if (zoomIn) zoomIn.disabled = zoom >= MAX_ZOOM;
}

/* ========================= Render ========================= */

function clearPages() {
  $('#orderNfePreviewPages')?.replaceChildren();
}

function resetScroll() {
  const viewport = $('#orderNfePreviewViewport');
  if (viewport) {
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }
}

function cancelRenders() {
  for (const task of renderTasks) {
    try {
      task.cancel();
    } catch {
      // já terminou
    }
  }
  renderTasks = [];
}

async function destroyPdf() {
  renderVersion += 1;
  cancelRenders();
  try {
    await loadingTask?.destroy?.();
  } catch {
    // já destruído
  }
  loadingTask = null;
  pdfDocument = null;
}

async function renderPdf() {
  const pdf = pdfDocument;
  const container = $('#orderNfePreviewPages');
  if (!pdf || !container) return;

  renderVersion += 1;
  const version = renderVersion;

  cancelRenders();
  clearPages();

  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (version !== renderVersion) return;

    const page = await pdf.getPage(pageNumber);
    if (version !== renderVersion) return;

    const viewport = page.getViewport({ scale: BASE_SCALE * zoom });

    const canvas = document.createElement('canvas');
    canvas.dataset.pageNumber = String(pageNumber);
    canvas.setAttribute('aria-label', `Página ${pageNumber} de ${pdf.numPages}`);
    canvas.width = Math.floor(viewport.width * pixelRatio);
    canvas.height = Math.floor(viewport.height * pixelRatio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    canvas.style.display = 'block';
    canvas.style.flex = '0 0 auto';
    canvas.style.background = '#ffffff';
    canvas.style.boxShadow = '0 4px 18px rgba(15, 23, 42, 0.4)';

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Não foi possível criar o canvas do DANFE.');

    container.appendChild(canvas);

    const task = page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
      background: '#ffffff',
    });

    renderTasks.push(task);

    try {
      await task.promise;
    } catch (error) {
      if (error?.name === 'RenderingCancelledException') return;
      throw error;
    } finally {
      renderTasks = renderTasks.filter((t) => t !== task);
    }
  }

  updateZoomDisplay();
}

async function setZoom(value) {
  if (!pdfDocument) return;

  const viewport = $('#orderNfePreviewViewport');
  const previous = zoom;
  const next = clampZoom(value);
  if (next === previous) return;

  const centerX = viewport ? viewport.scrollLeft + viewport.clientWidth / 2 : 0;
  const centerY = viewport ? viewport.scrollTop + viewport.clientHeight / 2 : 0;

  zoom = next;
  updateZoomDisplay();
  await renderPdf();

  if (viewport && previous > 0) {
    const ratio = zoom / previous;
    viewport.scrollLeft = centerX * ratio - viewport.clientWidth / 2;
    viewport.scrollTop = centerY * ratio - viewport.clientHeight / 2;
  }
}

const zoomIn = () => setZoom(zoom + ZOOM_STEP);
const zoomOut = () => setZoom(zoom - ZOOM_STEP);

async function resetZoom() {
  if (!pdfDocument) return;
  zoom = 1;
  updateZoomDisplay();
  await renderPdf();
  resetScroll();
}

async function fitZoom() {
  if (!pdfDocument) return;
  const viewport = $('#orderNfePreviewViewport');
  if (!viewport) return;

  const firstPage = await pdfDocument.getPage(1);
  const natural = firstPage.getViewport({ scale: BASE_SCALE });
  const available = Math.max(240, viewport.clientWidth - 56);

  zoom = clampZoom(available / natural.width);
  updateZoomDisplay();
  await renderPdf();
  resetScroll();
}

/* ========================= Modal ========================= */

function isOpen() {
  return !!$('#orderNfePreviewModal')?.classList.contains('is-open');
}

function showModal() {
  const modal = $('#orderNfePreviewModal');
  modal?.classList.add('is-open');
  modal?.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

export async function closeOrderNfePreview() {
  await destroyPdf();
  clearPages();
  zoom = 1;
  updateZoomDisplay();

  const modal = $('#orderNfePreviewModal');
  modal?.classList.remove('is-open');
  modal?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');

  currentOrderId = null;
  onIssue = null;
}

async function readApiError(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await response.json().catch(() => null);
    return body?.message || body?.error || `Erro HTTP ${response.status}`;
  }
  const text = await response.text().catch(() => '');
  return text || `Erro HTTP ${response.status}`;
}

/**
 * Abre o DANFE de pré-visualização do pedido.
 * @param {string|number} orderId
 * @param {{ canIssue?: boolean, onIssue?: (orderId) => any }} options
 */
export async function openOrderNfePreview(orderId, { canIssue = false, onIssue: issueHandler = null } = {}) {
  if (!orderId) return;

  bindOrderNfePreview();

  currentOrderId = orderId;
  onIssue = typeof issueHandler === 'function' ? issueHandler : null;

  const title = $('#orderNfePreviewTitle');
  if (title) title.textContent = `🧾 Pré-visualização da NF-e — Pedido ${orderId}`;

  const issueBtn = $('#btnOrderNfeIssue');
  if (issueBtn) {
    issueBtn.hidden = !(canIssue && onIssue);
    issueBtn.disabled = true; // libera depois que o DANFE carregar
  }

  const loading = $('#orderNfePreviewLoading');

  showModal();
  clearPages();
  resetScroll();
  if (loading) loading.style.display = 'flex';

  try {
    const headers = { Accept: 'application/pdf' };
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const base = window.API_BASE || window.location.origin;
    const response = await fetch(
      `${base}/api/orders/${encodeURIComponent(orderId)}/preview-pdf`,
      { method: 'GET', headers, cache: 'no-store' },
    );

    if (!response.ok) throw new Error(await readApiError(response));

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/pdf')) {
      throw new Error('O servidor não retornou um PDF.');
    }

    const bytes = await response.arrayBuffer();

    // O usuário pode ter fechado ou trocado de pedido enquanto carregava
    if (currentOrderId !== orderId) return;

    await destroyPdf();
    loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes) });
    pdfDocument = await loadingTask.promise;

    zoom = 1;
    updateZoomDisplay();
    resetScroll();
    await renderPdf();

    if (issueBtn) issueBtn.disabled = false;
  } catch (error) {
    if (currentOrderId !== orderId) return;
    await closeOrderNfePreview();
    await showCenterModal({
      variant: 'error',
      title: 'Pré-visualização da NF-e',
      message: error?.message || 'Não foi possível exibir o DANFE.',
    });
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

async function handleIssueClick() {
  const orderId = currentOrderId;
  const handler = onIssue;
  if (!orderId || !handler) return;

  await closeOrderNfePreview();
  await handler(orderId);
}

export function bindOrderNfePreview() {
  if (bound) return;
  if (!$('#orderNfePreviewModal')) return;
  bound = true;

  $('#btnOrderNfeZoomIn')?.addEventListener('click', () => zoomIn());
  $('#btnOrderNfeZoomOut')?.addEventListener('click', () => zoomOut());
  $('#btnOrderNfeZoomReset')?.addEventListener('click', () => resetZoom());
  $('#btnOrderNfeZoomFit')?.addEventListener('click', () => fitZoom());
  $('#btnOrderNfeIssue')?.addEventListener('click', handleIssueClick);

  document.querySelectorAll('[data-order-nfe-preview-close]').forEach((el) => {
    el.addEventListener('click', () => closeOrderNfePreview());
  });

  document.addEventListener('keydown', (event) => {
    if (!isOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      closeOrderNfePreview();
      return;
    }

    if (!(event.ctrlKey || event.metaKey)) return;

    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomIn();
    } else if (event.key === '-') {
      event.preventDefault();
      zoomOut();
    } else if (event.key === '0') {
      event.preventDefault();
      resetZoom();
    }
  });

  $('#orderNfePreviewViewport')?.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY < 0) zoomIn();
      else zoomOut();
    },
    { passive: false },
  );

  updateZoomDisplay();
}
