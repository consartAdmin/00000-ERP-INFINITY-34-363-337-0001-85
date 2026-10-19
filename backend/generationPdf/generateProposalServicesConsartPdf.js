// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generateProposalServicesConsartPdf.js — Proposta de Serviços (A4)    ║
// ║ CONSART ERP — PDFKit                                                ║
// ║ • Cabeçalho com a empresa Consart (cadastro de Empresas pelo CNPJ;  ║
// ║   sem cadastro, usa os dados fixos abaixo)                          ║
// ║ • Cliente, escopo, serviços, totais, condições, observações,        ║
// ║   assinatura                                                        ║
// ║ Retorna um Buffer com o PDF.                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import pool from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CONSART CONSULTORIA EMPRESARIAL LTDA (cadastro de Empresas)
const CONSART_CNPJ = '57134713000165';
const CONSART_FALLBACK = {
  trade_name: 'CONSART CONSULTORIA EMPRESARIAL',
  corporate_name: 'CONSART CONSULTORIA EMPRESARIAL LTDA',
  city: 'Belo Horizonte',
  state: 'MG',
  cnpj: CONSART_CNPJ,
};

const GREEN = '#0f6b5c';
const BORDER = '#cbd5e1';
const MUTED = '#475569';
const LINE = '#e2e8f0';

// ─────────────────────────────────────────────────────────────────────
// Formatação
// ─────────────────────────────────────────────────────────────────────

const clean = (v) => String(v ?? '').trim();
const join = (values, sep = ' · ') => values.map(clean).filter(Boolean).join(sep);

function money(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(n) {
  return Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 });
}

function dateBR(iso) {
  const m = clean(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : clean(iso);
}

function formatDoc(value) {
  const d = clean(value).replace(/\D+/g, '');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return clean(value);
}

function formatCep(value) {
  const d = clean(value).replace(/\D+/g, '');
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, '$1-$2') : clean(value);
}

// ─────────────────────────────────────────────────────────────────────
// Empresa (Consart) e logo
// ─────────────────────────────────────────────────────────────────────

async function findConsartEnterprise() {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM enterprises
        WHERE regexp_replace(cnpj, '\\D', '', 'g') = $1
        ORDER BY is_active DESC, id ASC
        LIMIT 1`,
      [CONSART_CNPJ]
    );
    return rows[0] || CONSART_FALLBACK;
  } catch (error) {
    console.warn('[PDF Proposta Serviços] Cadastro de empresa indisponível:', error.message);
    return CONSART_FALLBACK;
  }
}

function defaultLogo() {
  const candidates = [
    path.resolve(__dirname, '../public/imagens/brasaoConsartInfinity.png'),
    path.resolve(process.cwd(), 'public/imagens/brasaoConsartInfinity.png'),
    path.resolve(process.cwd(), 'backend/public/imagens/brasaoConsartInfinity.png'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function resolveLogo(logoUrl) {
  const source = clean(logoUrl);
  if (/^https?:\/\//i.test(source)) {
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      console.warn('[PDF Proposta Serviços] logo_url indisponível:', error.message);
    }
  }
  return defaultLogo();
}

// ─────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────

export async function generateProposalServicesConsartPdf(proposal) {
  const enterprise = await findConsartEnterprise();
  const logo = await resolveLogo(enterprise.logo_url);

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 24; // espaço do rodapé

  const ensureSpace = (h) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  // ── Cabeçalho ───────────────────────────────────────────────────
  const top = doc.y;
  let textX = left;
  if (logo) {
    try {
      doc.image(logo, left, top, { fit: [56, 56] });
      textX = left + 66;
    } catch (error) {
      console.warn('[PDF Proposta Serviços] logo inválido:', error.message);
    }
  }

  const companyAddress = join([
    join([enterprise.address, enterprise.address_number], ', '),
    enterprise.district,
    join([enterprise.city, enterprise.state], '/'),
    enterprise.zip_code ? `CEP ${formatCep(enterprise.zip_code)}` : '',
  ]);
  const companyContact = join([enterprise.phone || enterprise.whatsapp, enterprise.email, enterprise.website]);

  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111')
    .text(clean(enterprise.trade_name || enterprise.corporate_name), textX, top + 2, { width: 230 });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  if (clean(enterprise.corporate_name) && enterprise.corporate_name !== enterprise.trade_name) {
    doc.text(clean(enterprise.corporate_name), { width: 230 });
  }
  doc.text(`CNPJ ${formatDoc(enterprise.cnpj)}`, { width: 230 });
  if (companyAddress) doc.text(companyAddress, { width: 230 });
  if (companyContact) doc.text(companyContact, { width: 230 });
  const companyBottom = doc.y;

  doc.font('Helvetica-Bold').fontSize(17).fillColor(GREEN)
    .text('PROPOSTA DE SERVIÇOS', left, top, { width, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#334155')
    .text(`Nº ${proposal.number}`, { width, align: 'right' })
    .text(`Emissão: ${dateBR(proposal.issue_date)}`, { width, align: 'right' })
    .text(`Válida até: ${dateBR(proposal.valid_until)}`, { width, align: 'right' });

  const headerBottom = Math.max(companyBottom, doc.y, top + 58) + 8;
  doc.moveTo(left, headerBottom).lineTo(right, headerBottom).lineWidth(2.5).strokeColor(GREEN).stroke();
  doc.y = headerBottom + 14;

  // ── Caixas de texto ─────────────────────────────────────────────
  const PAD = 9;

  function measureLines(lines, w) {
    return lines.reduce((h, l) => {
      doc.font(l.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      return h + doc.heightOfString(l.text, { width: w, lineGap: 2 });
    }, 0);
  }

  function drawBox(x, y, w, h, title, lines) {
    doc.roundedRect(x, y, w, h, 5).lineWidth(0.8).strokeColor(BORDER).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GREEN)
      .text(title.toUpperCase(), x + PAD, y + PAD, { width: w - PAD * 2, characterSpacing: 0.6 });
    let cy = y + PAD + 13;
    for (const l of lines) {
      doc.font(l.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#111')
        .text(l.text, x + PAD, cy, { width: w - PAD * 2, lineGap: 2 });
      cy = doc.y;
    }
  }

  const boxHeight = (lines, w) => PAD * 2 + 13 + measureLines(lines, w - PAD * 2);

  function fullBox(title, lines) {
    lines = lines.filter((l) => clean(l.text));
    if (!lines.length) return;
    const h = boxHeight(lines, width);
    ensureSpace(h);
    const y = doc.y;
    drawBox(left, y, width, h, title, lines);
    doc.x = left;
    doc.y = y + h + 12;
  }

  // ── Cliente + Proposta ──────────────────────────────────────────
  const c = proposal.customer || {};
  const customerAddress = join([
    join([join([c.street_type, c.street_name], ' '), c.street_number], ', '),
    c.address_complement,
    c.neighborhood,
    join([c.city, c.state], '/'),
    c.postal_code ? formatCep(c.postal_code) : '',
  ]);
  const customerLines = [
    { text: clean(c.legal_name || c.trade_name || proposal.customer_name), bold: true },
    { text: c.trade_name && c.legal_name && c.trade_name !== c.legal_name ? c.trade_name : '' },
    {
      text: join([
        c.tax_id || proposal.customer_tax_id ? `CNPJ/CPF ${formatDoc(c.tax_id || proposal.customer_tax_id)}` : '',
        c.state_registration ? `IE ${c.state_registration}` : '',
      ]),
    },
    { text: customerAddress },
    {
      text: join([
        proposal.contact_name ? `A/C: ${proposal.contact_name}` : '',
        c.email,
        c.phone_number || c.mobile_number,
      ]),
    },
  ].filter((l) => clean(l.text));

  const s = proposal.seller || {};
  const proposalLines = [
    { text: clean(proposal.title), bold: true },
    { text: proposal.seller_name ? `Vendedor: ${proposal.seller_name}` : '' },
    { text: join([s.email, s.mobile || s.phone]) },
  ].filter((l) => clean(l.text));

  const gap = 12;
  const w1 = Math.round((width - gap) * 0.6);
  const w2 = width - gap - w1;
  const pairH = Math.max(boxHeight(customerLines, w1), boxHeight(proposalLines, w2));
  const pairY = doc.y;
  drawBox(left, pairY, w1, pairH, 'Cliente', customerLines);
  drawBox(left + w1 + gap, pairY, w2, pairH, 'Proposta', proposalLines);
  doc.x = left;
  doc.y = pairY + pairH + 12;

  fullBox('Apresentação / Escopo', [{ text: proposal.scope }]);

  // ── Itens ───────────────────────────────────────────────────────
  const cols = [
    { key: 'n', label: '#', w: 22, align: 'center' },
    { key: 'desc', label: 'Serviço', w: 0, align: 'left' },
    { key: 'unit', label: 'Un.', w: 34, align: 'center' },
    { key: 'qty', label: 'Qtd', w: 48, align: 'right' },
    { key: 'price', label: 'Valor unit.', w: 70, align: 'right' },
    { key: 'disc', label: 'Desc.', w: 42, align: 'right' },
    { key: 'total', label: 'Total', w: 74, align: 'right' },
  ];
  cols[1].w = width - cols.reduce((a, col) => a + col.w, 0);

  function drawRow(values, { header = false } = {}) {
    const font = header ? 'Helvetica-Bold' : 'Helvetica';
    const size = header ? 8 : 9;
    doc.font(font).fontSize(size);
    const h = Math.max(
      ...cols.map((col) => doc.heightOfString(String(values[col.key] ?? ''), { width: col.w - 10 }))
    ) + 12;

    if (!header) ensureSpace(h);
    const y = doc.y;

    if (header) {
      doc.rect(left, y, width, h).fill(GREEN);
    } else {
      doc.moveTo(left, y + h).lineTo(right, y + h).lineWidth(0.6).strokeColor(LINE).stroke();
    }

    let x = left;
    for (const col of cols) {
      doc.font(font).fontSize(size).fillColor(header ? '#fff' : '#111')
        .text(String(values[col.key] ?? ''), x + 5, y + 6, { width: col.w - 10, align: col.align });
      x += col.w;
    }
    doc.x = left;
    doc.y = y + h;
  }

  const items = Array.isArray(proposal.items) ? proposal.items : [];
  const headerValues = Object.fromEntries(cols.map((col) => [col.key, col.label]));

  ensureSpace(60);
  drawRow(headerValues, { header: true });
  items.forEach((it, i) => {
    if (doc.y + 30 > bottom()) {
      doc.addPage();
      drawRow(headerValues, { header: true });
    }
    const disc = Number(it.discount_percent || 0);
    drawRow({
      n: i + 1,
      desc: join([it.service_code, it.description], ' - '),
      unit: clean(it.unit),
      qty: qty(it.quantity),
      price: money(it.unit_price),
      disc: disc ? `${qty(disc)}%` : '-',
      total: money(it.total),
    });
  });

  // ── Totais ──────────────────────────────────────────────────────
  ensureSpace(70);
  const totW = 230;
  const totX = right - totW;
  let ty = doc.y + 8;
  const totalLine = (label, value, big = false) => {
    doc.font(big ? 'Helvetica-Bold' : 'Helvetica').fontSize(big ? 13 : 9).fillColor(big ? GREEN : '#111');
    doc.text(label, totX, ty, { width: totW / 2 });
    doc.text(value, totX + totW / 2, ty, { width: totW / 2, align: 'right' });
    ty += big ? 20 : 15;
  };
  totalLine('Subtotal', `R$ ${money(proposal.subtotal)}`);
  if (Number(proposal.discount_total)) totalLine('Descontos', `- R$ ${money(proposal.discount_total)}`);
  doc.moveTo(totX, ty).lineTo(right, ty).lineWidth(1.5).strokeColor(GREEN).stroke();
  ty += 6;
  totalLine('TOTAL', `R$ ${money(proposal.total)}`, true);
  doc.x = left;
  doc.y = ty + 10;

  // ── Condições e observações ─────────────────────────────────────
  fullBox('Condições comerciais', [
    { text: join([proposal.payment_method, proposal.payment_terms], ' - ') ? `Pagamento: ${join([proposal.payment_method, proposal.payment_terms], ' - ')}` : '' },
    {
      text: join([
        proposal.delivery_time ? `Prazo de execução: ${proposal.delivery_time}` : '',
      ]),
    },
    { text: proposal.execution_place ? `Local de execução: ${proposal.execution_place}` : '' },
    { text: `Validade da proposta: ${proposal.valid_days} dias (até ${dateBR(proposal.valid_until)})` },
  ]);
  fullBox('Observações', [{ text: proposal.notes }]);

  // ── Assinaturas ─────────────────────────────────────────────────
  ensureSpace(80);
  const sigY = doc.y + 40;
  const sigW = 210;
  const sigs = [
    [clean(enterprise.trade_name || enterprise.corporate_name), proposal.seller_name ? `${proposal.seller_name} - Vendedor` : ''],
    [clean(c.legal_name || c.trade_name || proposal.customer_name), 'De acordo (assinatura / data)'],
  ];
  sigs.forEach(([name, sub], i) => {
    const x = i === 0 ? left + 20 : right - 20 - sigW;
    doc.moveTo(x, sigY).lineTo(x + sigW, sigY).lineWidth(0.8).strokeColor('#111').stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#111')
      .text(name, x, sigY + 4, { width: sigW, align: 'center' });
    if (sub) doc.text(sub, { width: sigW, align: 'center' });
  });

  // ── Rodapé em todas as páginas ──────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const fy = doc.page.height - 50;
    doc.page.margins.bottom = 0; // escrever no rodapé sem abrir página nova
    doc.moveTo(left, fy - 4).lineTo(right, fy - 4).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b');
    doc.text(`Proposta de Serviços ${proposal.number} · Consart ERP`, left, fy, { width: width / 2, lineBreak: false });
    doc.text(`Página ${i - range.start + 1} de ${range.count}`, left + width / 2, fy, {
      width: width / 2, align: 'right', lineBreak: false,
    });
  }

  doc.end();
  return done;
}
