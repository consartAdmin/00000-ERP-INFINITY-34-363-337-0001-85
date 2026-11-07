// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ generateOrdersLogisticsPackingPdf.js — PDF Packing & Volumes (CONSART)  ║
// ║ Path: backend/generationPdf/generateOrdersLogisticsPackingPdf.js        ║
// ║ Stack: Node.js (ESM) + PDFKit                                           ║
// ║ ✅ HEADER removido                                                      ║
// ║ ✅ Footer aplicado no final (não altera cursor)                          ║
// ║ ✅ Sem páginas em branco / sem “pular páginas”                           ║
// ║ ✅ Unidade "kg" e "m³" sem quebrar linha                                 ║
// ║ ✅ Descrição menor + truncamento "..."                                   ║
// ║ ✅ CADA VOLUME = BLOCO SEPARADO (box + padding + GAP forte)              ║
// ╚══════════════════════════════════════════════════════════════════════════╝

'use strict';

import PDFDocument from 'pdfkit';

/* ──────────────────────────────────────────────────────────────
   Helpers
────────────────────────────────────────────────────────────── */
function n(v, def = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
}
function esc(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}
function fmtDate(d) {
  try {
    const dt = d ? new Date(d) : null;
    if (!dt || Number.isNaN(+dt)) return '—';
    return dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch {
    return '—';
  }
}

// NBSP (não quebra linha entre número e unidade)
const NBSP = '\u00A0';

function fmtKg(v) {
  const x = n(v, NaN);
  if (!Number.isFinite(x)) return '—';
  const s = x.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return `${s}${NBSP}kg`;
}
function fmtM3(v) {
  const x = n(v, NaN);
  if (!Number.isFinite(x)) return '—';
  const s = x.toLocaleString('pt-BR', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  return `${s}${NBSP}m³`;
}
function fmtNum(v) {
  const x = n(v, NaN);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function fitText(doc, text, maxWidth) {
  const s = esc(text ?? '');
  if (!s) return '';

  if (doc.widthOfString(s) <= maxWidth) return s;

  const ell = '...';
  const ellW = doc.widthOfString(ell);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const cand = out + s[i];
    if (doc.widthOfString(cand) + ellW > maxWidth) break;
    out = cand;
  }
  return out.trimEnd() + ell;
}

function collectBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function groupByVolume(volumeItems = []) {
  const map = new Map();
  for (const it of volumeItems) {
    const vid = it.volume_id ?? it.volumeId ?? it.volumeIdFk ?? null;
    if (!map.has(vid)) map.set(vid, []);
    map.get(vid).push(it);
  }
  return map;
}

/* ──────────────────────────────────────────────────────────────
   PDF Generator
────────────────────────────────────────────────────────────── */
export async function generateOrdersLogisticsPackingPdf(summary, { orderId } = {}) {
  const order = summary?.order || null;
  const volumes = Array.isArray(summary?.volumes) ? summary.volumes : [];
  const volumeItems = Array.isArray(summary?.volumeItems) ? summary.volumeItems : [];
  const notPacked = Array.isArray(summary?.notPacked) ? summary.notPacked : [];

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, left: 42, right: 42, bottom: 56 },
    autoFirstPage: false,
    bufferPages: true,
  });

  const bufferPromise = collectBuffer(doc);

  // ====== THEME (CONSART clean)
  const COLORS = {
    text: '#111827',
    muted: '#6B7280',
    line: '#E5E7EB',
    soft: '#F3F4F6',
    brand: '#0F172A',
  };

  // ====== Safe metrics
  const pageW = () => Number(doc.page?.width) || 595.28;
  const pageH = () => Number(doc.page?.height) || 841.89;
  const left = () => Number(doc.page?.margins?.left) || 42;
  const right = () => Number(doc.page?.margins?.right) || 42;
  const top = () => Number(doc.page?.margins?.top) || 56;
  const bottom = () => Number(doc.page?.margins?.bottom) || 56;
  const contentW = () => pageW() - left() - right();
  const yBottom = () => pageH() - bottom();

  let hasAnyPage = false;
  const state = { pageIndex: -1 };

  function safeY() {
    const y = Number(doc.y);
    return Number.isFinite(y) ? y : top();
  }

  function addPage() {
    doc.addPage();
    state.pageIndex += 1;
    hasAnyPage = true;
    doc.x = left();
    doc.y = top();
  }

  function ensurePage() {
    if (!hasAnyPage) addPage();
  }

  /* ──────────────────────────────────────────────────────────────
     ✅ Volume Block (Box) — desenhado depois (não altera cursor)
  ─────────────────────────────────────────────────────────────── */
  const volumeBoxes = []; // { pageIndex, x, y, w, h, radius, roundMode }
  // roundMode: 'all' | 'top' | 'bottom' | 'none'

  let boxOpen = false;
  let boxStartY = 0;
  let boxStartPage = 0;

  // ✅ MAIS ESPAÇO ENTRE OS VOLUMES (corrige sobreposição visual)
  const BOX_OUTER_GAP = 26;       // ↑ era 14
  const BOX_PAD_TOP = 10;
  const BOX_PAD_BOTTOM = 18;      // ↑ era 10
  const BOX_X_PAD = 6;
  const BOX_RADIUS = 8;
  const BOX_BOTTOM_SAFE = 18;     // ↑ era 10

  function pushBoxSegment(pageIndex, yTop, yEnd, roundMode) {
    const x = left() - BOX_X_PAD;
    const w = contentW() + (BOX_X_PAD * 2);

    const yT = Math.max(top(), yTop);
    const yE = Math.min(yBottom() - BOX_BOTTOM_SAFE, yEnd);
    const h = Math.max(18, yE - yT);

    volumeBoxes.push({
      pageIndex,
      x,
      y: yT,
      w,
      h,
      radius: BOX_RADIUS,
      roundMode,
    });
  }

  function ensureSpace(h = 0) {
    ensurePage();
    const y = safeY();

    if (y + h > yBottom() - 8) {
      if (boxOpen) {
        closeBoxToBottomAndContinueOnNextPage();
        return;
      }
      addPage();
    }
  }

  function ensureMinForVolumeBlock(minH = 160) {
    ensurePage();
    const y = safeY();
    if (y + minH > yBottom() - 8) addPage();
  }

  function startVolumeBox() {
    ensurePage();

    // ✅ GAP REAL antes de começar o box (separa forte)
    ensureSpace(BOX_OUTER_GAP);
    doc.y = safeY() + BOX_OUTER_GAP;

    boxOpen = true;
    boxStartY = safeY();
    boxStartPage = state.pageIndex;
  }

  function endVolumeBox() {
    if (!boxOpen) return;

    const endY = safeY() + BOX_PAD_BOTTOM;
    const startY = boxStartY - BOX_PAD_TOP;

    if (boxStartPage === state.pageIndex) {
      pushBoxSegment(state.pageIndex, startY, endY, 'all');
    } else {
      pushBoxSegment(state.pageIndex, top(), endY, 'bottom');
    }

    boxOpen = false;

    // ✅ GAP extra depois do box (separa mais ainda)
    ensureSpace(BOX_OUTER_GAP);
    doc.y = safeY() + (BOX_OUTER_GAP * 0.6);
    doc.moveDown(0.8);
  }

  function closeBoxToBottomAndContinueOnNextPage() {
    if (!boxOpen) return;

    const startY = (boxStartPage === state.pageIndex) ? (boxStartY - BOX_PAD_TOP) : top();
    const endY = yBottom() - BOX_BOTTOM_SAFE;

    const roundMode = (boxStartPage === state.pageIndex) ? 'top' : 'none';
    pushBoxSegment(state.pageIndex, startY, endY, roundMode);

    addPage();
    boxStartY = top();
  }

  function h1(txt) {
    ensureSpace(30);
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(16);
    doc.text(txt, left(), safeY(), { width: contentW() });
    doc.moveDown(0.6);
  }

  function h2(txt) {
    ensureSpace(22);
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(12);
    doc.text(txt, left(), safeY(), { width: contentW() });
    doc.moveDown(0.4);
  }

  function kvRow(k, v) {
    ensureSpace(16);
    const x = left();
    const w = contentW();
    const y = safeY();

    doc.fontSize(9).fillColor(COLORS.muted).font('Helvetica-Bold');
    doc.text(`${k}:`, x, y, { width: 110 });

    doc.fillColor(COLORS.text).font('Helvetica');
    doc.text(esc(v ?? '—'), x + 110, y, { width: w - 110 });

    doc.moveDown(0.25);
  }

  function divider() {
    ensureSpace(14);
    const y = safeY();

    doc.strokeColor(COLORS.line).lineWidth(1);
    doc.moveTo(left(), y + 6).lineTo(pageW() - right(), y + 6).stroke();
    doc.moveDown(0.6);
  }

  function tableHeader(cols, widths) {
    ensureSpace(28);
    const x = left();
    const y = safeY();

    doc.save();
    doc.rect(x, y, contentW(), 20).fill(COLORS.soft);
    doc.fillColor(COLORS.brand).font('Helvetica-Bold').fontSize(9);

    let cx = x;
    for (let i = 0; i < cols.length; i++) {
      doc.text(cols[i], cx + 6, y + 6, {
        width: widths[i] - 12,
        align: i >= cols.length - 2 ? 'right' : 'left',
        lineBreak: false,
      });
      cx += widths[i];
    }
    doc.restore();

    doc.y = y + 24;
  }

  function tableRow(values, widths, opts = {}) {
    const rowH = opts.rowH ?? 18;

    ensureSpace(rowH + 10);

    const x = left();
    const y = safeY();

    doc.strokeColor(COLORS.line).lineWidth(1);
    doc.moveTo(x, y + rowH).lineTo(x + contentW(), y + rowH).stroke();

    let cx = x;

    for (let i = 0; i < values.length; i++) {
      const align = i >= values.length - 2 ? 'right' : 'left';
      const cellW = widths[i] - 12;

      let fontSize = 9;
      if (i === 1) fontSize = 8;

      doc.font('Helvetica').fontSize(fontSize).fillColor(COLORS.text);

      const txt = fitText(doc, String(values[i] ?? ''), cellW);

      doc.text(txt, cx + 6, y + 5, {
        width: cellW,
        align,
        lineBreak: false,
      });

      cx += widths[i];
    }

    doc.y = y + rowH;
  }

  /* ──────────────────────────────────────────────────────────────
     BODY
  ────────────────────────────────────────────────────────────── */
  ensurePage();

  const srcLabel = summary?.sourceLabel || 'Pedido';
  h1(`Romaneio de Volumes — ${srcLabel} #${order?.order_id ?? orderId ?? '—'}`);

  kvRow(srcLabel, order?.order_id ?? orderId ?? '—');
  if (order?.carrier_name) kvRow('Transportadora', order.carrier_name);
  kvRow('Status', order?.status ?? '—');
  kvRow('Cliente', order?.customer_name ?? order?.cliente ?? order?.razao_social ?? '—');
  kvRow('CNPJ/CPF', order?.cnpj_cpf ?? order?.cnpj ?? order?.cpf ?? '—');
  kvRow('Data', order?.issue_date_br ?? fmtDate(order?.created_at ?? order?.createdAt));

  divider();

  const totalWeight = volumes.reduce((acc, v) => acc + n(v.weight_kg ?? v.weight_kg_calc, 0), 0);
  const totalM3 = volumes.reduce((acc, v) => acc + n(v.volume_m3, 0), 0);

  ensureSpace(44);
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10);
  doc.text('KPIs', left(), safeY(), { width: contentW() });
  doc.moveDown(0.35);

  doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9);
  doc.text(
    `Volumes: ${volumes.length}   •   Itens não alocados: ${notPacked.length}   •   Peso total: ${fmtKg(totalWeight)}   •   Cubagem total: ${fmtM3(totalM3)}`,
    left(),
    safeY(),
    { width: contentW(), lineBreak: true }
  );
  doc.moveDown(0.8);

  h2('Volumes');

  const itemsByVol = groupByVolume(volumeItems);

  for (const v of volumes) {
    ensureMinForVolumeBlock(160);
    startVolumeBox();

    const volId = v.id;
    const volNo = v.volume_number ?? '—';
    const status = v.status ?? 'OPEN';
    const dims = `${fmtNum(v.height_cm)} × ${fmtNum(v.width_cm)} × ${fmtNum(v.length_cm)} cm`;
    const tare = fmtKg(v.tare_kg);
    const w = fmtKg(v.weight_kg ?? v.weight_kg_calc);
    const m3 = fmtM3(v.volume_m3);

    ensureSpace(64);

    doc.fillColor(COLORS.brand).font('Helvetica-Bold').fontSize(11);
    doc.text(`Volume #${volNo}`, left(), safeY(), { width: contentW() });

    doc.moveDown(0.25);
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9);
    doc.text(
      `Status: ${esc(status)}   •   Dimensões volume: ${dims}   •   Tara: ${tare}   •   Peso total: ${w}   •   Cubagem volume: ${m3}`,
      left(),
      safeY(),
      { width: contentW(), lineBreak: true }
    );
    doc.moveDown(0.5);

    const its = itemsByVol.get(volId) || [];

    const cols = ['SKU', 'Descrição', 'U.M', 'Fator', 'Qtd', 'Peso', 'Dimensões', 'm³'];
    const W = contentW();
    const widths = [
      Math.round(W * 0.12),
      Math.round(W * 0.30),
      Math.round(W * 0.08),
      Math.round(W * 0.07),
      Math.round(W * 0.07),
      Math.round(W * 0.10),
      Math.round(W * 0.18),
      W - (
        Math.round(W * 0.12) +
        Math.round(W * 0.30) +
        Math.round(W * 0.08) +
        Math.round(W * 0.07) +
        Math.round(W * 0.07) +
        Math.round(W * 0.10) +
        Math.round(W * 0.18)
      ),
    ];

    tableHeader(cols, widths);

    if (!its.length) {
      tableRow(['—', 'Nenhum item alocado neste volume.', '—', '—', '—'], widths, { rowH: 18 });
      doc.moveDown(0.4);
      endVolumeBox();
      continue;
    }

    for (const it of its) {
      const sku = esc(it.sku ?? '');
      const desc = esc(it.description ?? '');
      const um = esc(it.unit ?? '');
      const qtyN = n(it.quantity, 0);
      const qty = String(qtyN).replace('.', ',');
      
      const fator = fmtNum(it.fator ?? 1);

      const h = n(it.unit_height_cm, 0);
      const wCm = n(it.unit_width_cm, 0);
      const l = n(it.unit_length_cm, 0);

      const dimsItem = `${fmtNum(h)} × ${fmtNum(wCm)} × ${fmtNum(l)} cm`;

      const kg = fmtKg(
        it.line_weight_kg ??
        (n(it.unit_weight_kg, 0) * qtyN)
      );

      const m3 = fmtM3(
        it.line_volume_m3 ??
        ((h * wCm * l) / 1000000) * qtyN
      );

      tableRow(
        [
          sku || '—',
          desc || '—',
          um || '—',
          fator,
          qty,
          kg,
          dimsItem,
          m3
        ],
        widths,
        { rowH: 20 }
      );
    }

    doc.moveDown(0.4);
    endVolumeBox();
  }

  h2('Itens não alocados');

  const colsNP = ['SKU', 'Descrição', 'U.M', 'Qtd', 'Kg'];
  const W2 = contentW();
  const a1 = Math.round(W2 * 0.16);
  const a2 = Math.round(W2 * 0.52);
  const a3 = Math.round(W2 * 0.10);
  const a4 = Math.round(W2 * 0.10);
  const a5 = W2 - (a1 + a2 + a3 + a4);
  const widthsNP = [a1, a2, a3, a4, a5];

  tableHeader(colsNP, widthsNP);

  if (!notPacked.length) {
    tableRow(['—', 'Nenhum item pendente (tudo alocado).', '—', '—', '—'], widthsNP, { rowH: 18 });
  } else {
    for (const r of notPacked) {
      const sku = esc(r.sku ?? '');
      const desc = esc(r.description ?? r.descricao ?? '');
      const um = esc(r.unit ?? r.unidade ?? '');
      const remaining = n(r.remaining_qty ?? r.remaining ?? r.quantity ?? 0, 0);
      const qty = String(remaining).replace('.', ',');
      const kg = fmtKg(n(r.unit_weight_kg, 0) * remaining);

      tableRow([sku || '—', desc || '—', um || '—', qty, kg], widthsNP, { rowH: 18 });
    }
  }

  /* ──────────────────────────────────────────────────────────────
     DRAW VOLUME BOXES (APÓS o corpo — NÃO interfere no cursor)
  ─────────────────────────────────────────────────────────────── */
  function drawBoxSegment(b) {
    const { x, y, w, h, radius, roundMode } = b;

    doc.save();
    doc.lineWidth(1);
    doc.strokeColor(COLORS.line);

    if (roundMode === 'all') doc.roundedRect(x, y, w, h, radius).stroke();
    else doc.rect(x, y, w, h).stroke();

    doc.restore();
  }

  for (const b of volumeBoxes) {
    doc.switchToPage(b.pageIndex);
    drawBoxSegment(b);
  }

  /* ──────────────────────────────────────────────────────────────
     FOOTER
  ─────────────────────────────────────────────────────────────── */
  const range = doc.bufferedPageRange();
  const stamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    const pw = pageW();
    const ph = pageH();
    const l = left();
    const r = right();

    const footerY = ph - 34;
    const footerLineY = footerY - 10;

    doc.save();

    doc.strokeColor(COLORS.line).lineWidth(1);
    doc.moveTo(l, footerLineY).lineTo(pw - r, footerLineY).stroke();

    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8);
    doc.text(stamp, l, footerY, { width: pw - l - r, align: 'right' });

    doc.restore();
  }

  doc.end();

  const buffer = await bufferPromise;
  const filename = `romaneio_${String(srcLabel).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}_${order?.order_id ?? orderId ?? 'sem_id'}.pdf`;
  return { buffer, filename };
}


/* ──────────────────────────────────────────────────────────────
   Etiquetas dos volumes (4 por página A4)
   summary: retorno de buildSummary (head, volumes, volumeItems, sourceLabel)
────────────────────────────────────────────────────────────── */
export async function generateOrdersLogisticsPackingLabelsPdf(summary, { onlyVolumeId = null } = {}) {
  const head = summary?.head || {};
  const allVolumes = Array.isArray(summary?.volumes) ? summary.volumes : [];
  const volumes = onlyVolumeId ? allVolumes.filter((v) => Number(v.id) === Number(onlyVolumeId)) : allVolumes;
  const total = allVolumes.length;
  const items = groupByVolume(summary?.volumeItems || []);
  const srcLabel = summary?.sourceLabel || 'Pedido';
  const typeLabel = { BOX: 'CAIXA', PALLET: 'PALETE', BUNDLE: 'FARDO', BAG: 'SACO', OTHER: 'OUTRO' };

  const doc = new PDFDocument({ size: 'A4', margin: 24, autoFirstPage: false });
  const bufferPromise = collectBuffer(doc);

  const W = 595.28, H = 841.89, M = 24, GAP = 14;
  const cw = (W - M * 2 - GAP) / 2;
  const ch = (H - M * 2 - GAP) / 2;

  volumes.forEach((v, idx) => {
    const slot = idx % 4;
    if (slot === 0) doc.addPage();
    const x = M + (slot % 2) * (cw + GAP);
    const y = M + Math.floor(slot / 2) * (ch + GAP);
    const pad = 16;
    const iw = cw - pad * 2;

    doc.save();
    doc.roundedRect(x, y, cw, ch, 10).lineWidth(1.2).strokeColor('#0F172A').stroke();

    let cy = y + pad;
    doc.fillColor('#6B7280').font('Helvetica').fontSize(9)
      .text(`${srcLabel} nº ${head.id ?? ''}`, x + pad, cy, { width: iw });
    cy += 14;
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(13)
      .text(fitText(doc, head.customer_name || '—', iw), x + pad, cy, { width: iw, lineBreak: false });
    cy += 20;
    if (head.carrier_name) {
      doc.fillColor('#374151').font('Helvetica').fontSize(9)
        .text(fitText(doc, `Transportadora: ${head.carrier_name}`, iw), x + pad, cy, { width: iw, lineBreak: false });
      cy += 14;
    }

    cy += 10;
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(44)
      .text(`${v.volume_number}/${total}`, x + pad, cy, { width: iw, align: 'center' });
    cy += 54;
    doc.font('Helvetica-Bold').fontSize(11)
      .text(`VOLUME ${v.volume_number} · ${typeLabel[v.volume_type] || v.volume_type || ''}`, x + pad, cy, { width: iw, align: 'center' });
    cy += 22;

    doc.moveTo(x + pad, cy).lineTo(x + cw - pad, cy).lineWidth(0.6).strokeColor('#E5E7EB').stroke();
    cy += 10;

    doc.font('Helvetica').fontSize(10).fillColor('#111827');
    doc.text(`Peso: ${fmtKg(v.weight_kg)}`, x + pad, cy, { width: iw / 2 });
    doc.text(`Cubagem: ${fmtM3(v.volume_m3)}`, x + pad + iw / 2, cy, { width: iw / 2, align: 'right' });
    cy += 15;
    doc.text(`Medidas: ${fmtNum(v.height_cm)} × ${fmtNum(v.width_cm)} × ${fmtNum(v.length_cm)} cm`, x + pad, cy, { width: iw });
    cy += 20;

    doc.fillColor('#6B7280').font('Helvetica-Bold').fontSize(8).text('CONTEÚDO', x + pad, cy, { width: iw });
    cy += 12;
    doc.font('Helvetica').fontSize(8.5).fillColor('#111827');
    const list = items.get(v.id) || [];
    const maxY = y + ch - pad - 12;
    for (let i = 0; i < list.length; i++) {
      if (cy > maxY - 11) {
        doc.fillColor('#6B7280').text(`+ ${list.length - i} item(ns)`, x + pad, cy, { width: iw });
        break;
      }
      const it = list[i];
      doc.text(fitText(doc, `${fmtNum(it.quantity)} ${it.unit || ''} · ${it.description || ''}`, iw), x + pad, cy, { width: iw, lineBreak: false });
      cy += 11;
    }
    doc.restore();
  });

  if (!volumes.length) {
    doc.addPage();
    doc.font('Helvetica').fontSize(12).text('Nenhum volume.', M, M);
  }

  doc.end();
  const buffer = await bufferPromise;
  return { buffer, filename: `etiquetas_volumes_${head.id ?? 'sem_id'}.pdf` };
}
