// ╔══════════════════════════════════════════════════════════════════════╗
// ║ locationLabelPrint.js — Etiquetas de Localização (modelos salvos)   ║
// ║ CONSART ERP | ESM                                                   ║
// ║                                                                     ║
// ║ Usado por:                                                          ║
// ║  - public/labelPrintConfig  (pré-visualização + impressão de teste) ║
// ║  - public/locationsBarCode  (impressão / PDF das etiquetas)         ║
// ║                                                                     ║
// ║ Modelos: GET /api/label-print-config/models (public."labelPrintModels")
// ║ Código de barras: JsBarcode (CODE128 / CODE39) e qrcode-generator  ║
// ║ (QR), carregados sob demanda. A etiqueta usa medidas em mm, então   ║
// ║ o estilo vai inline no próprio HTML da etiqueta (é o documento de   ║
// ║ impressão, não a tela).                                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

const API_BASE =
  (typeof window !== 'undefined' && (window.API_BASE || window.apiBase)) || '';

export const LABEL_MODELS_URL = `${API_BASE}/api/label-print-config/models`;

const LIBS = Object.freeze({
  JsBarcode: 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js',
  qrcode: 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
});

export const BARCODE_TYPE_LABELS = Object.freeze({
  CODE128: 'CODE128 (recomendado)',
  CODE39: 'CODE39',
  QR: 'QR Code',
});

export const PAPER_LABELS = Object.freeze({
  thermal: 'Térmica (1 etiqueta por página)',
  a4: 'Folha A4 (várias por página)',
});

/** Modelo usado quando a API não responde (igual à etiqueta antiga 60 × 40 mm). */
export const FALLBACK_MODEL = Object.freeze({
  id: null,
  name: 'Padrão 60 × 40 mm',
  width_mm: 60,
  height_mm: 40,
  margin_mm: 2,
  paper: 'thermal',
  barcode_type: 'CODE128',
  barcode_height_mm: 17,
  barcode_width_pct: 90,
  show_title: true,
  title_text: 'LOCALIZAÇÃO',
  title_font_pt: 11,
  show_location: true,
  location_font_pt: 9,
  location_wrap: 'single',
  show_barcode_text: true,
  barcode_text_font_pt: 10,
  show_footer: true,
  footer_text: 'CONSART ERP',
  show_border: true,
  copies: 1,
});

/* ───────────────────────── utilitários ───────────────────────── */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function num(value, fallback) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) && String(value ?? '') !== '' ? n : fallback;
}

function bool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

/** Garante números/booleanos (o PostgreSQL devolve NUMERIC como texto). */
export function normalizeModel(raw = {}) {
  const f = FALLBACK_MODEL;
  return {
    ...raw,
    name: raw.name || f.name,
    width_mm: num(raw.width_mm, f.width_mm),
    height_mm: num(raw.height_mm, f.height_mm),
    margin_mm: num(raw.margin_mm, f.margin_mm),
    paper: raw.paper === 'a4' ? 'a4' : 'thermal',
    barcode_type: ['CODE128', 'CODE39', 'QR'].includes(raw.barcode_type) ? raw.barcode_type : f.barcode_type,
    barcode_height_mm: num(raw.barcode_height_mm, f.barcode_height_mm),
    barcode_width_pct: num(raw.barcode_width_pct, f.barcode_width_pct),
    show_title: bool(raw.show_title, f.show_title),
    title_text: raw.title_text ?? f.title_text,
    title_font_pt: num(raw.title_font_pt, f.title_font_pt),
    show_location: bool(raw.show_location, f.show_location),
    location_font_pt: num(raw.location_font_pt, f.location_font_pt),
    location_wrap: ['single', 'wrap', 'levels'].includes(raw.location_wrap) ? raw.location_wrap : f.location_wrap,
    show_barcode_text: bool(raw.show_barcode_text, f.show_barcode_text),
    barcode_text_font_pt: num(raw.barcode_text_font_pt, f.barcode_text_font_pt),
    show_footer: bool(raw.show_footer, f.show_footer),
    footer_text: raw.footer_text ?? f.footer_text,
    show_border: bool(raw.show_border, f.show_border),
    copies: Math.max(1, Math.round(num(raw.copies, f.copies))),
  };
}

export const LOCATION_WRAP_LABELS = Object.freeze({
  single: 'Uma linha (corta com …)',
  wrap: 'Quebrar quando não couber',
  levels: 'Um nível por linha',
});

export function locationText(row = {}) {
  return row.label || locationLevels(row).join(' / ');
}

/** Níveis do caminho: Local, Corredor, Prateleira, Bandeja, Posição. */
export function locationLevels(row = {}) {
  const levels = [row.local, row.corredor, row.prateleira, row.bandeja, row.position]
    .map((v) => String(v ?? '').trim()).filter(Boolean);
  if (levels.length) return levels;
  return String(row.label || '').split('/').map((v) => v.trim()).filter(Boolean);
}

/* ───────────────────────── API ───────────────────────── */

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data;
}

export async function fetchLabelModels({ includeInactive = false } = {}) {
  const rows = await getJson(`${LABEL_MODELS_URL}${includeInactive ? '?includeInactive=true' : ''}`);
  return (Array.isArray(rows) ? rows : []).map(normalizeModel);
}

/* ───────────────────────── bibliotecas ───────────────────────── */

const pending = {};

function loadScript(globalName) {
  if (typeof window[globalName] === 'function') return Promise.resolve();
  if (!pending[globalName]) {
    pending[globalName] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = LIBS[globalName];
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        delete pending[globalName];
        reject(new Error(`Não foi possível carregar a biblioteca ${globalName}.`));
      };
      document.head.appendChild(script);
    });
  }
  return pending[globalName];
}

export function loadBarcodeLibs(model) {
  return model?.barcode_type === 'QR' ? loadScript('qrcode') : loadScript('JsBarcode');
}

/* ───────────────────────── código de barras ───────────────────────── */

/** Retorna o SVG (texto) do código, já dimensionado em mm. */
export function barcodeSvg(value, rawModel) {
  const model = normalizeModel(rawModel);
  const text = String(value ?? '').trim() || 'SEM-CODIGO';
  const heightMm = model.barcode_height_mm;
  const innerWidth = Math.max(5, model.width_mm - 2 * model.margin_mm);

  if (model.barcode_type === 'QR') {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const side = Math.min(heightMm, innerWidth);
    return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
      .replace('<svg ', `<svg style="width:${side}mm;height:${side}mm;display:block;margin:0 auto" `);
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    window.JsBarcode(svg, text, {
      format: model.barcode_type,
      width: 2,
      height: 100,
      displayValue: false,
      margin: 0,
    });
  } catch (err) {
    throw new Error(`O código "${text}" não é válido para ${model.barcode_type}.`);
  }
  const widthMm = (innerWidth * model.barcode_width_pct) / 100;
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('style', `width:${widthMm}mm;height:${heightMm}mm;display:block;margin:0 auto`);
  return svg.outerHTML;
}

/* ───────────────────────── etiqueta ───────────────────────── */

/** HTML de uma etiqueta (medidas em mm). Chame loadBarcodeLibs(model) antes. */
export function labelHtml(row, rawModel) {
  const m = normalizeModel(rawModel);
  const code = String(row?.barcode ?? '').trim();
  const box = [
    `width:${m.width_mm}mm`, `height:${m.height_mm}mm`, `padding:${m.margin_mm}mm`,
    'box-sizing:border-box', 'overflow:hidden', 'background:#fff', 'color:#111',
    'font-family:Arial,Helvetica,sans-serif', 'display:flex', 'flex-direction:column',
    'justify-content:space-evenly', 'align-items:stretch', 'text-align:center',
    m.show_border ? 'border:0.3mm solid #111' : 'border:0.3mm solid transparent',
  ].join(';');
  const line = 'margin:0;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

  const parts = [];
  if (m.show_title && m.title_text) {
    parts.push(`<div style="${line};font-size:${m.title_font_pt}pt;font-weight:900">${esc(m.title_text)}</div>`);
  }
  if (m.show_location) {
    const loc = `font-size:${m.location_font_pt}pt;font-weight:700`;
    if (m.location_wrap === 'levels') {
      const lines = locationLevels(row).map((level) => `<div style="${line}">${esc(level)}</div>`).join('');
      parts.push(`<div style="${loc}">${lines}</div>`);
    } else if (m.location_wrap === 'wrap') {
      parts.push(`<div style="margin:0;line-height:1.15;white-space:normal;overflow-wrap:anywhere;${loc}">${esc(locationText(row))}</div>`);
    } else {
      parts.push(`<div style="${line};${loc}">${esc(locationText(row))}</div>`);
    }
  }
  parts.push(`<div>${barcodeSvg(code, m)}</div>`);
  if (m.show_barcode_text) {
    parts.push(`<div style="${line};font-size:${m.barcode_text_font_pt}pt;font-weight:900;letter-spacing:0.3pt">${esc(code)}</div>`);
  }
  if (m.show_footer && m.footer_text) {
    parts.push(`<div style="${line};font-size:6pt">${esc(m.footer_text)}</div>`);
  }
  return `<div class="lbl" style="${box}">${parts.join('')}</div>`;
}

/** Página de impressão completa (térmica: 1 por página; A4: grade). */
export function printDocumentHtml(rows, rawModel, { title = 'Etiquetas de Localização' } = {}) {
  const m = normalizeModel(rawModel);
  const labels = [];
  rows.forEach((row) => {
    for (let i = 0; i < m.copies; i += 1) labels.push(labelHtml(row, m));
  });

  const pageCss = m.paper === 'a4'
    ? `@page{size:A4 portrait;margin:8mm}
       body{display:flex;flex-wrap:wrap;gap:2mm;align-content:flex-start}
       .lbl{break-inside:avoid}`
    : `@page{size:${m.width_mm}mm ${m.height_mm}mm;margin:0}
       .lbl{break-after:page}.lbl:last-child{break-after:auto}`;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
    <title>${esc(title)}</title>
    <style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact}${pageCss}</style>
    </head><body>${labels.join('')}
    <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script>
    </body></html>`;
}

/**
 * Abre a janela de impressão. rows = [{ barcode, label | local/corredor/... }]
 * Lança erro com mensagem em pt-BR (pop-up bloqueado, código inválido...).
 */
export async function printLocationLabels(rows, rawModel) {
  const model = normalizeModel(rawModel);
  if (!rows?.length) throw new Error('Selecione pelo menos uma localização para imprimir.');

  // Abre antes do await para o navegador não bloquear o pop-up.
  const win = window.open('', '_blank');
  if (!win) throw new Error('O navegador bloqueou a janela de impressão. Permita pop-ups para este site.');
  win.document.write('<p style="font-family:Arial;padding:16px">Preparando etiquetas…</p>');

  try {
    await loadBarcodeLibs(model);
    const html = printDocumentHtml(rows, model);
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (err) {
    win.close();
    throw err;
  }
}

/** Gera o PDF de uma etiqueta (usa html2pdf já carregado na página). */
export async function downloadLocationLabelPdf(row, rawModel) {
  const model = normalizeModel(rawModel);
  if (typeof window.html2pdf !== 'function') throw new Error('A biblioteca html2pdf não está carregada.');
  await loadBarcodeLibs(model);

  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff';
  holder.innerHTML = labelHtml(row, model);
  document.body.appendChild(holder);

  const code = String(row?.barcode || 'etiqueta').replace(/[^\w.-]+/g, '_');
  try {
    await window.html2pdf().set({
      margin: 0,
      filename: `etiqueta-${code}.pdf`,
      image: { type: 'jpeg', quality: 1 },
      html2canvas: { scale: 4, backgroundColor: '#ffffff' },
      jsPDF: {
        unit: 'mm',
        format: [model.width_mm, model.height_mm],
        orientation: model.width_mm >= model.height_mm ? 'landscape' : 'portrait',
      },
    }).from(holder.firstElementChild).save();
  } finally {
    holder.remove();
  }
}
