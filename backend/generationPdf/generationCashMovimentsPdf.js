// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generationCashMovimentsPdf.js — Relatório de Caixa (A4 landscape)    ║
// ║ CONSART ERP — PDFKit — layout padrão (consartPdfTheme.js)            ║
// ║ ✅ Categoria/Subcategoria removidas                                  ║
// ║ ✅ Plano de Contas exibido no lugar                                  ║
// ║ ✅ Dashboard por Plano de Contas                                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import fs from 'node:fs';
import path from 'node:path';
import moment from 'moment';
import { fileURLToPath } from 'node:url';
import enterpriseApi from '../repositories/enterprise/enterprise.index.js';
import {
  C, SERIES, PAGE,
  createThemedDoc, drawFullHeader, drawCompactHeader, drawFooters, drawKpis,
  drawPanel, drawHorizontalBars, drawDonut, drawTotalsBox, makeTable,
  contentWidth, contentBottom, resolveLogo, DEFAULT_LOGO_PATH, money, number, nowBR,
} from './consartPdfTheme.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Helpers de formatação

const cleanText = (value) => String(value ?? '').trim();

function formatCnpj(value) {
  const digits = cleanText(value).replace(/\D+/g, '');
  if (digits.length !== 14) return cleanText(value);
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function formatZipCode(value) {
  const digits = cleanText(value).replace(/\D+/g, '');
  if (digits.length !== 8) return cleanText(value);
  return digits.replace(/^(\d{5})(\d{3})$/, '$1-$2');
}

function joinNonEmpty(values, separator = ', ') {
  return values.map(cleanText).filter(Boolean).join(separator);
}

function buildCompanyHeader(enterprise = {}, legacyCompany = {}) {
  const street = joinNonEmpty([enterprise.address, enterprise.address_number]);
  const cityState = joinNonEmpty([enterprise.city, enterprise.state], ' - ');
  const zipCode = formatZipCode(enterprise.zip_code);
  const address = joinNonEmpty([
    street,
    enterprise.address_complement,
    enterprise.district,
    cityState,
    zipCode ? `CEP ${zipCode}` : '',
  ]);

  const phoneParts = [];
  if (cleanText(enterprise.phone)) phoneParts.push(`Telefone: ${cleanText(enterprise.phone)}`);
  if (cleanText(enterprise.whatsapp)) phoneParts.push(`WhatsApp: ${cleanText(enterprise.whatsapp)}`);

  const digitalParts = [];
  if (cleanText(enterprise.email)) digitalParts.push(`E-mail: ${cleanText(enterprise.email)}`);
  if (cleanText(enterprise.website)) digitalParts.push(`Site: ${cleanText(enterprise.website)}`);

  return {
    name: cleanText(enterprise.trade_name)
      || cleanText(enterprise.corporate_name)
      || cleanText(legacyCompany.name)
      || 'Empresa não informada',
    corporateName: cleanText(enterprise.corporate_name),
    cnpj: formatCnpj(enterprise.cnpj) || cleanText(legacyCompany.cnpj),
    stateRegistration: cleanText(enterprise.state_registration),
    address: address || cleanText(legacyCompany.address),
    contacts: phoneParts.join(' | ') || cleanText(legacyCompany.contacts),
    site: digitalParts.join(' | ') || cleanText(legacyCompany.site),
    footer: cleanText(enterprise.pdf_footer),
    paperclipPath: legacyCompany.paperclipPath || null,
    logoPath: cleanText(enterprise.logo_url) || legacyCompany.logoPath || '',
  };
}

function getPlanoContas(r = {}) {
  if (r.transfer_id) return 'Transferência entre contas';

  return (
    r.plano_contas ||
    r.plano_de_contas ||
    r.chart_account_name ||
    r.chart_account_title ||
    r.chart_account_description ||
    r.conta_contabil ||
    r.conta_plano ||
    r.account_plan ||
    r.account_name ||
    'Não Informado'
  );
}


const REPORT_TITLE = 'Relatório de Movimentações de Caixa';
const PAPERCLIP_PATH = path.resolve(__dirname, '../public/imagens/paperclip.png');

// "Período: 01/10/2026 a 31/10/2026" -> "01/10/2026 a 31/10/2026"
const stripLabel = (value, label) => cleanText(value).replace(new RegExp(`^${label}\\s*:\\s*`, 'i'), '');

function drawPaperclip(doc, x, y, size = 8) {
  if (fs.existsSync(PAPERCLIP_PATH)) {
    doc.image(PAPERCLIP_PATH, x, y, { width: size, height: size });
    return;
  }
  doc.save().lineWidth(0.9).strokeColor(C.muted)
    .roundedRect(x + 1.5, y, size * 0.55, size, 2).stroke().restore();
}

const isSaida = (r) => String(r.tipo_movimentacao || '').toUpperCase().startsWith('SAI');

// ============================================================================
// API principal
export async function generateCaixaPdf(payload = {}, options = {}) {
  const {
    rows = [],
    company = {},
    title = REPORT_TITLE,
    periodLabel = '',
    filtersLabel = '',
  } = payload;

  const {
    output = 'response',
    res = null,
    filename = `relatorio_caixa_${moment().format('DD-MM-YYYY')}.pdf`,
    dir = path.resolve(__dirname, '../../public/pdfs'),
    // onProgress({ index, total, row, rowTotal }) a cada linha desenhada
    onProgress = null,
  } = options;

  const enterprise = await enterpriseApi.findForPdf({
    enterpriseId: payload.enterpriseId ?? company.enterpriseId ?? company.id ?? null,
  });

  if (!enterprise) {
    throw new Error('Nenhuma empresa ativa foi encontrada para gerar o cabeçalho do PDF.');
  }

  const comp = buildCompanyHeader(enterprise, company);
  const logo = await resolveLogo(comp.logoPath);
  // logo da empresa vai num quadro branco; o brasão CONSART fica direto no azul
  const logoTile = logo !== DEFAULT_LOGO_PATH;

  const { doc, done } = createThemedDoc({ title, subject: comp.name });
  const generatedAt = nowBR();

  // ---------- Totais (antes de desenhar, para os KPIs) ----------
  let totalGeral = 0;
  let totalEntradas = 0;
  let totalSaidas = 0;
  let totalJuros = 0;
  let totalMulta = 0;
  let totalEncargos = 0;
  // Transferências entre contas: listadas, mas fora dos totais e do dashboard
  let totalTransferencias = 0;
  let comAnexo = 0;
  const totaisPorPlanoContas = {};

  const lines = rows.map((r) => {
    const valor = Number(r.valor || 0);
    const multa = Number(r.multa || 0);
    const juros = Number(r.juros || 0);
    const encargos = Number(r.encargos || 0);
    const total = valor + multa + juros + encargos;
    const planoContas = getPlanoContas(r);

    if (r.tem_anexo) comAnexo += 1;

    if (r.transfer_id) {
      if (isSaida(r)) totalTransferencias += total;
    } else {
      totalGeral += total;
      totalJuros += juros;
      totalMulta += multa;
      totalEncargos += encargos;
      if (isSaida(r)) totalSaidas += total;
      else totalEntradas += total;
      totaisPorPlanoContas[planoContas] = (totaisPorPlanoContas[planoContas] || 0) + total;
    }

    return { r, valor, multa, juros, encargos, total, planoContas };
  });

  // ---------- Cabeçalho ----------
  const subtitle = joinNonEmpty([comp.name, comp.cnpj ? `CNPJ ${comp.cnpj}` : ''], '  ·  ');
  const info = [
    ['Período', stripLabel(periodLabel, 'Per[ií]odo') || 'Todos os períodos'],
    ['Filtros', stripLabel(filtersLabel, 'Filtros') || 'Nenhum'],
    ['Movimentações', number(rows.length, 0)],
  ];

  let y = drawFullHeader(doc, { title, subtitle, info, logo, logoTile }) + 14;

  y = drawKpis(doc, y, [
    { label: 'Movimentações', value: number(rows.length, 0), hint: `${number(comAnexo, 0)} com anexo`, color: SERIES[0] },
    { label: 'Entradas', value: money(totalEntradas), hint: 'Sem transferências', color: SERIES[1] },
    { label: 'Saídas', value: money(totalSaidas), hint: 'Sem transferências', color: C.red },
    { label: 'Juros + multa', value: money(totalJuros + totalMulta), hint: `Juros ${money(totalJuros)} · Multa ${money(totalMulta)}`, color: SERIES[2] },
    { label: 'Total', value: money(totalGeral), hint: totalTransferencias > 0 ? `Transferências fora: ${money(totalTransferencias)}` : 'Entradas + saídas', color: SERIES[5] },
  ]) + 16;

  // ---------- Tabela ----------
  const continuation = { title, subtitle: 'Movimentações (continuação)', logo, logoTile };
  const table = makeTable(doc, {
    title: 'Movimentações',
    continuation,
    rowH: 16,
    fontSize: 6.5,
    headFontSize: 7,
    columns: [
      { label: 'ID', w: 44 },
      { label: 'Data', w: 46 },
      { label: 'Tipo', w: 40 },
      { label: 'Conta', w: 50 },
      { label: 'Tipo Doc', w: 38 },
      { label: 'Nº Doc', w: 44 },
      { label: 'Plano de Contas', w: 110 },
      { label: 'Fornecedor' },
      { label: 'Observação' },
      { label: 'Valor', w: 54, align: 'right' },
      { label: 'Multa', w: 40, align: 'right' },
      { label: 'Juros', w: 40, align: 'right' },
      { label: 'Encargos', w: 44, align: 'right' },
      { label: 'Total', w: 58, align: 'right', bold: true },
    ],
  });

  y = table.section(y);

  if (!rows.length) {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text('Nenhuma movimentação encontrada para o período/filtros informados.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
    y += 40;
  }

  let rowIndex = 0;

  for (const line of lines) {
    const { r } = line;
    const saida = isSaida(r);
    const tipoColor = r.transfer_id ? C.muted : (saida ? C.red : C.green);

    y = table.row(y, [
      r.tem_anexo ? `     ${r.id ?? ''}` : String(r.id ?? ''),
      r.data_hora ? moment(r.data_hora).format('DD/MM/YYYY') : '',
      { text: r.tipo_movimentacao || '', color: tipoColor, bold: true },
      r.conta_caixa || '',
      r.tipo_documento || '',
      r.numero_documento || '',
      line.planoContas,
      r.fornecedor || '',
      r.observacao || '',
      money(line.valor),
      line.multa ? money(line.multa) : '-',
      line.juros ? money(line.juros) : '-',
      line.encargos ? money(line.encargos) : '-',
      money(line.total),
    ], { index: rowIndex, color: r.transfer_id ? C.muted : C.text });

    if (r.tem_anexo) drawPaperclip(doc, PAGE.margin + 4, y - 16 + 4);

    rowIndex += 1;
    if (onProgress) {
      onProgress({ index: rowIndex, total: rows.length, row: r, rowTotal: line.total });
      // devolve o event loop para o progresso sair na resposta em stream
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  if (rows.length) {
    y = table.total(y, [
      'TOTAL', '', '', '', '', '', `${number(rows.length, 0)} movimentações`, '', '',
      money(lines.reduce((s, l) => s + (l.r.transfer_id ? 0 : l.valor), 0)),
      money(totalMulta), money(totalJuros), money(totalEncargos), money(totalGeral),
    ]);
  }

  // ---------- Resumo ----------
  const boxes = [
    { label: 'Entradas', value: money(totalEntradas), color: C.green },
    { label: 'Saídas', value: money(totalSaidas), color: C.red },
    { label: 'Total juros', value: money(totalJuros) },
    { label: 'Total multa', value: money(totalMulta) },
  ];
  if (totalTransferencias > 0) boxes.push({ label: 'Transferências (fora)', value: money(totalTransferencias) });
  boxes.push({ label: 'Total de movimentações', value: money(totalGeral) });

  const boxH = boxes.length * 18 + 12;
  if (y + 12 + boxH > contentBottom(doc)) {
    y = table.newPage();
  } else {
    y += 12;
  }
  drawTotalsBox(doc, y, boxes);

  // ---------- Dashboard por Plano de Contas ----------
  const planoOrd = Object.entries(totaisPorPlanoContas)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  doc.addPage();
  y = drawCompactHeader(doc, { title, subtitle: 'Totais por Plano de Contas', logo, logoTile }) + 14;

  const fullW = contentWidth(doc);
  const gap = 10;
  const panelH = 220;
  const w1 = fullW * 0.56;
  const w2 = fullW - w1 - gap;

  const topBars = planoOrd.slice(0, 9);
  const a1 = drawPanel(doc, PAGE.margin, y, w1, panelH, 'Total por Plano de Contas', `Top ${topBars.length} por valor`);
  drawHorizontalBars(doc, a1, topBars, { labelW: 150, valueW: 70 });

  const topDonut = planoOrd.slice(0, 7);
  if (planoOrd.length > 7) {
    topDonut.push({ label: 'Outros', value: planoOrd.slice(7).reduce((s, d) => s + d.value, 0) });
  }
  const a2 = drawPanel(doc, PAGE.margin + w1 + gap, y, w2, panelH, 'Participação no total', 'Percentual de cada plano de contas');
  drawDonut(doc, a2, topDonut, 'total');

  y += panelH + 16;

  const planTable = makeTable(doc, {
    title: 'Totais por Plano de Contas',
    continuation: { title, subtitle: 'Totais por Plano de Contas (continuação)', logo, logoTile },
    columns: [
      { label: 'Plano de Contas' },
      { label: '% do total', w: 100, align: 'right' },
      { label: 'Total', w: 140, align: 'right', bold: true },
    ],
  });

  y = planTable.section(y);

  planoOrd.forEach((p, i) => {
    y = planTable.row(y, [
      p.label,
      `${number(totalGeral ? (p.value / totalGeral) * 100 : 0, 1)}%`,
      money(p.value),
    ], { index: i });
  });

  planTable.total(y, ['TOTAL', '100,0%', money(totalGeral)]);

  drawFooters(doc, { title, generatedAt });
  doc.end();

  const pdfData = await done;

  if (output === 'response' && res) {
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename.replace(/["\r\n]/g, '')}"`,
      'Content-Length': pdfData.length,
    });
    res.end(pdfData);
    return;
  }

  if (output === 'file') {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, filename);
    await fs.promises.writeFile(full, pdfData);
    return full;
  }

  if (output === 'buffer') return pdfData;

  return;
}

export default { generateCaixaPdf };
