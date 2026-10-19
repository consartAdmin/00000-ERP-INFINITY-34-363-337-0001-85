// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generateContractConsartPdf.js — Contrato de Prestação de Serviços    ║
// ║ (A4) — CONSART ERP — PDFKit                                          ║
// ║ • Cabeçalho com a empresa Consart (cadastro de Empresas pelo CNPJ;  ║
// ║   sem cadastro, usa os dados fixos abaixo), sem linha de endereço   ║
// ║ • Partes, resumo, objeto, serviços, valor, cláusulas ({CAMPO}       ║
// ║   trocado pelos dados do contrato), local/data, assinaturas e       ║
// ║   testemunhas                                                       ║
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
const BLANK = '________';

const BILLING_LABELS = {
  MENSAL: 'mensalmente',
  UNICO: 'em valor único',
  PARCELADO: 'de forma parcelada',
};

const TOTAL_LABELS = {
  MENSAL: 'VALOR MENSAL',
  UNICO: 'VALOR TOTAL',
  PARCELADO: 'VALOR TOTAL',
};

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

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function dateLong(iso) {
  const m = clean(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} de ${MONTHS[Number(m[2]) - 1]} de ${m[1]}` : '';
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

// ── Valor por extenso (reais e centavos) ──────────────────────────
const UNITS = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
  'setecentos', 'oitocentos', 'novecentos'];

function below1000(n) {
  if (n === 100) return 'cem';
  const parts = [];
  if (n >= 100) parts.push(HUNDREDS[Math.floor(n / 100)]);
  const rest = n % 100;
  if (rest >= 20) {
    parts.push(TENS[Math.floor(rest / 10)]);
    if (rest % 10) parts.push(UNITS[rest % 10]);
  } else if (rest) {
    parts.push(UNITS[rest]);
  }
  return parts.join(' e ');
}

function integerWords(n) {
  if (n === 0) return 'zero';
  const scales = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
  const groups = [];
  let rest = n;
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }

  const words = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const g = groups[i];
    if (!g) continue;
    const [singular, plural] = scales[i] || ['', ''];
    let w = i === 1 && g === 1 ? 'mil' : below1000(g);
    if (i >= 1 && !(i === 1 && g === 1)) w += ` ${g === 1 ? singular : plural}`;
    words.push({ w, g });
  }

  // "e" antes do último grupo quando ele é < 100 ou centena redonda (ex.: mil e quinhentos)
  return words.map(({ w, g }, idx) => {
    const last = idx === words.length - 1;
    return idx > 0 && last && (g < 100 || g % 100 === 0) ? `e ${w}` : w;
  }).join(' ');
}

function moneyWords(value) {
  const cents = Math.round(Math.abs(Number(value || 0)) * 100);
  const reais = Math.floor(cents / 100);
  const centavos = cents % 100;
  const parts = [];
  if (reais) {
    const w = integerWords(reais);
    const de = reais >= 1_000_000 && reais % 1_000_000 === 0 ? ' de' : '';
    parts.push(`${w}${de} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (centavos) parts.push(`${integerWords(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  return parts.length ? parts.join(' e ') : 'zero reais';
}

const ORDINALS = ['PRIMEIRA', 'SEGUNDA', 'TERCEIRA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÉTIMA', 'OITAVA',
  'NONA', 'DÉCIMA', 'DÉCIMA PRIMEIRA', 'DÉCIMA SEGUNDA', 'DÉCIMA TERCEIRA', 'DÉCIMA QUARTA',
  'DÉCIMA QUINTA', 'DÉCIMA SEXTA', 'DÉCIMA SÉTIMA', 'DÉCIMA OITAVA', 'DÉCIMA NONA', 'VIGÉSIMA'];

const ordinal = (i) => ORDINALS[i] || `${i + 1}ª`;

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
    console.warn('[PDF Contrato] Cadastro de empresa indisponível:', error.message);
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
      console.warn('[PDF Contrato] logo_url indisponível:', error.message);
    }
  }
  return defaultLogo();
}

// ─────────────────────────────────────────────────────────────────────
// Campos automáticos das cláusulas ({CAMPO})
// ─────────────────────────────────────────────────────────────────────

function placeholderValues(contract, enterprise) {
  const c = contract.customer || {};
  const months = Number(contract.term_months || 0);
  return {
    CONTRATANTE: clean(c.legal_name || c.trade_name || contract.customer_name),
    CONTRATANTE_DOC: formatDoc(c.tax_id || contract.customer_tax_id),
    CONTRATADA: clean(enterprise.corporate_name || enterprise.trade_name),
    CONTRATADA_DOC: formatDoc(enterprise.cnpj),
    VALOR: `R$ ${money(contract.total)}`,
    VALOR_EXTENSO: moneyWords(contract.total),
    COBRANCA: BILLING_LABELS[contract.billing_type] || '',
    FORMA_PAGAMENTO: clean(contract.payment_method),
    CONDICAO_PAGAMENTO: clean(contract.payment_terms),
    DIA_VENCIMENTO: contract.due_day ? String(contract.due_day) : '',
    INICIO: dateBR(contract.start_date),
    FIM: contract.end_date ? dateBR(contract.end_date) : (months ? '' : 'prazo indeterminado'),
    VIGENCIA: months ? `${months} (${integerWords(months)}) ${months === 1 ? 'mês' : 'meses'}` : 'prazo indeterminado',
    INDICE_REAJUSTE: clean(contract.readjustment_index),
    LOCAL_EXECUCAO: clean(contract.execution_place),
    PRAZO_EXECUCAO: clean(contract.delivery_time),
    FORO: clean(contract.forum_city),
  };
}

function fillPlaceholders(textValue, values) {
  return String(textValue ?? '').replace(/\{([A-Z_]+)\}/g, (match, key) => {
    if (!(key in values)) return match;
    return clean(values[key]) || BLANK;
  });
}

// ─────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────

export async function generateContractConsartPdf(contract) {
  const enterprise = await findConsartEnterprise();
  const logo = await resolveLogo(enterprise.logo_url);
  const values = placeholderValues(contract, enterprise);

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const chunks = [];
  doc.on('data', (ch) => chunks.push(ch));
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
      console.warn('[PDF Contrato] logo inválido:', error.message);
    }
  }

  const companyContact = join([enterprise.phone || enterprise.whatsapp, enterprise.email, enterprise.website]);

  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111')
    .text(clean(enterprise.trade_name || enterprise.corporate_name), textX, top + 2, { width: 220 });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  if (clean(enterprise.corporate_name) && enterprise.corporate_name !== enterprise.trade_name) {
    doc.text(clean(enterprise.corporate_name), { width: 220 });
  }
  doc.text(`CNPJ ${formatDoc(enterprise.cnpj)}`, { width: 220 });
  if (companyContact) doc.text(companyContact, { width: 220 });
  const companyBottom = doc.y;

  doc.font('Helvetica-Bold').fontSize(14).fillColor(GREEN)
    .text('CONTRATO DE PRESTAÇÃO', left, top, { width, align: 'right' })
    .text('DE SERVIÇOS', { width, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#334155')
    .text(`Nº ${contract.number}`, { width, align: 'right' })
    .text(`Emissão: ${dateBR(contract.issue_date)}`, { width, align: 'right' });
  if (contract.proposal_number) doc.text(`Ref. Proposta nº ${contract.proposal_number}`, { width, align: 'right' });

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

  function pairBoxes(title1, lines1, title2, lines2) {
    lines1 = lines1.filter((l) => clean(l.text));
    lines2 = lines2.filter((l) => clean(l.text));
    const gap = 12;
    const w1 = Math.round((width - gap) / 2);
    const w2 = width - gap - w1;
    const h = Math.max(boxHeight(lines1, w1), boxHeight(lines2, w2));
    ensureSpace(h);
    const y = doc.y;
    drawBox(left, y, w1, h, title1, lines1);
    drawBox(left + w1 + gap, y, w2, h, title2, lines2);
    doc.x = left;
    doc.y = y + h + 12;
  }

  // ── Partes ──────────────────────────────────────────────────────
  const c = contract.customer || {};
  const customerAddress = join([
    join([join([c.street_type, c.street_name], ' '), c.street_number], ', '),
    c.address_complement,
    c.neighborhood,
    join([c.city, c.state], '/'),
    c.postal_code ? `CEP ${formatCep(c.postal_code)}` : '',
  ]);

  pairBoxes(
    'Contratada',
    [
      { text: values.CONTRATADA, bold: true },
      { text: `CNPJ ${values.CONTRATADA_DOC}` },
      { text: companyContact },
      { text: contract.seller_name ? `Responsável comercial: ${contract.seller_name}` : '' },
    ],
    'Contratante',
    [
      { text: values.CONTRATANTE, bold: true },
      {
        text: join([
          values.CONTRATANTE_DOC ? `CNPJ/CPF ${values.CONTRATANTE_DOC}` : '',
          c.state_registration ? `IE ${c.state_registration}` : '',
        ]),
      },
      { text: customerAddress },
      {
        text: join([
          contract.contact_name ? `A/C: ${contract.contact_name}` : '',
          c.email,
          c.phone_number || c.mobile_number,
        ]),
      },
    ]
  );

  doc.font('Helvetica').fontSize(9.5).fillColor('#111').text(
    'As partes acima qualificadas, doravante denominadas CONTRATADA e CONTRATANTE, têm entre si justo e '
    + 'contratado o presente Contrato de Prestação de Serviços, que se regerá pelas cláusulas e condições a seguir.',
    left, doc.y, { width, align: 'justify', lineGap: 2 }
  );
  doc.moveDown(0.8);

  // ── Resumo ──────────────────────────────────────────────────────
  const months = Number(contract.term_months || 0);
  fullBox('Resumo do contrato', [
    { text: clean(contract.title), bold: true },
    {
      text: join([
        `Vigência: ${months ? `${months} ${months === 1 ? 'mês' : 'meses'}` : 'prazo indeterminado'}`,
        contract.start_date ? `Início: ${dateBR(contract.start_date)}` : '',
        contract.end_date ? `Término: ${dateBR(contract.end_date)}` : '',
        contract.auto_renew ? 'Renovação automática' : '',
      ]),
    },
    {
      text: join([
        `Cobrança: ${{ MENSAL: 'Mensal', UNICO: 'Valor único', PARCELADO: 'Parcelada' }[contract.billing_type] || contract.billing_type}`,
        contract.payment_method ? `Pagamento: ${join([contract.payment_method, contract.payment_terms], ' - ')}` : '',
        contract.due_day ? `Vencimento: dia ${contract.due_day}` : '',
        contract.readjustment_index ? `Reajuste: ${contract.readjustment_index}` : '',
      ]),
    },
    {
      text: join([
        contract.execution_place ? `Local de execução: ${contract.execution_place}` : '',
        contract.delivery_time ? `Prazo de execução: ${contract.delivery_time}` : '',
      ]),
    },
  ]);

  fullBox('Objeto / Escopo', [{ text: fillPlaceholders(contract.object, values) }]);

  // ── Serviços contratados ────────────────────────────────────────
  const cols = [
    { key: 'n', label: '#', w: 22, align: 'center' },
    { key: 'desc', label: 'Serviço contratado', w: 0, align: 'left' },
    { key: 'unit', label: 'Un.', w: 34, align: 'center' },
    { key: 'qty', label: 'Qtd', w: 48, align: 'right' },
    { key: 'price', label: 'Valor unit.', w: 70, align: 'right' },
    { key: 'disc', label: 'Desc.', w: 42, align: 'right' },
    { key: 'total', label: 'Total', w: 74, align: 'right' },
  ];
  cols[1].w = width - cols.reduce((a, col) => a + col.w, 0);

  function drawRow(rowValues, { header = false } = {}) {
    const font = header ? 'Helvetica-Bold' : 'Helvetica';
    const size = header ? 8 : 9;
    doc.font(font).fontSize(size);
    const h = Math.max(
      ...cols.map((col) => doc.heightOfString(String(rowValues[col.key] ?? ''), { width: col.w - 10 }))
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
        .text(String(rowValues[col.key] ?? ''), x + 5, y + 6, { width: col.w - 10, align: col.align });
      x += col.w;
    }
    doc.x = left;
    doc.y = y + h;
  }

  const items = Array.isArray(contract.items) ? contract.items : [];
  if (items.length) {
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

    // ── Totais ────────────────────────────────────────────────────
    ensureSpace(80);
    const totW = 250;
    const totX = right - totW;
    let ty = doc.y + 8;
    const totalLine = (label, value, big = false) => {
      doc.font(big ? 'Helvetica-Bold' : 'Helvetica').fontSize(big ? 12 : 9).fillColor(big ? GREEN : '#111');
      doc.text(label, totX, ty, { width: totW / 2 });
      doc.text(value, totX + totW / 2, ty, { width: totW / 2, align: 'right' });
      ty += big ? 18 : 15;
    };
    totalLine('Subtotal', `R$ ${money(contract.subtotal)}`);
    if (Number(contract.discount_total)) totalLine('Descontos', `- R$ ${money(contract.discount_total)}`);
    doc.moveTo(totX, ty).lineTo(right, ty).lineWidth(1.5).strokeColor(GREEN).stroke();
    ty += 6;
    totalLine(TOTAL_LABELS[contract.billing_type] || 'VALOR TOTAL', `R$ ${money(contract.total)}`, true);
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED)
      .text(`(${values.VALOR_EXTENSO})`, left, ty, { width, align: 'right' });
    doc.x = left;
    doc.y = doc.y + 14;
  }

  // ── Cláusulas ───────────────────────────────────────────────────
  const clauses = Array.isArray(contract.clauses) ? contract.clauses : [];
  clauses.forEach((cl, i) => {
    const heading = `CLÁUSULA ${ordinal(i)} - ${clean(cl.title).toUpperCase()}`;
    const body = fillPlaceholders(cl.body, values);

    doc.font('Helvetica-Bold').fontSize(9.5);
    const headH = doc.heightOfString(heading, { width });
    doc.font('Helvetica').fontSize(9.5);
    const firstLines = Math.min(doc.heightOfString(body || ' ', { width, lineGap: 2 }), 40);
    ensureSpace(headH + firstLines + 6); // título nunca fica sozinho no pé da página

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(GREEN).text(heading, left, doc.y, { width });
    doc.moveDown(0.25);
    if (clean(body)) {
      doc.font('Helvetica').fontSize(9.5).fillColor('#111')
        .text(body, left, doc.y, { width, align: 'justify', lineGap: 2, paragraphGap: 4 });
    }
    doc.moveDown(0.7);
  });

  fullBox('Observações', [{ text: fillPlaceholders(contract.notes, values) }]);

  // ── Encerramento, local e data ──────────────────────────────────
  ensureSpace(60);
  doc.font('Helvetica').fontSize(9.5).fillColor('#111').text(
    'E, por estarem assim justas e contratadas, as partes assinam o presente instrumento em 2 (duas) vias '
    + 'de igual teor e forma, na presença das testemunhas abaixo.',
    left, doc.y, { width, align: 'justify', lineGap: 2 }
  );
  doc.moveDown(1);
  const city = clean(contract.signing_city) || join([enterprise.city, enterprise.state], '/') || BLANK;
  const signingDate = dateLong(contract.signing_date) || `____ de ______________ de ${new Date().getFullYear()}`;
  doc.text(`${city}, ${signingDate}.`, left, doc.y, { width, align: 'right' });

  // ── Assinaturas e testemunhas ───────────────────────────────────
  const sigW = 220;
  const drawSignatures = (rows) => {
    ensureSpace(70);
    const sigY = doc.y + 40;
    let maxY = sigY;
    rows.forEach(([name, sub], i) => {
      const x = i === 0 ? left + 10 : right - 10 - sigW;
      doc.moveTo(x, sigY).lineTo(x + sigW, sigY).lineWidth(0.8).strokeColor('#111').stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#111')
        .text(name, x, sigY + 4, { width: sigW, align: 'center' });
      doc.font('Helvetica').fontSize(8);
      if (sub) doc.text(sub, { width: sigW, align: 'center' });
      maxY = Math.max(maxY, doc.y);
    });
    doc.x = left;
    doc.y = maxY + 6;
  };

  drawSignatures([
    [values.CONTRATADA, `CONTRATADA · CNPJ ${values.CONTRATADA_DOC}`],
    [values.CONTRATANTE, `CONTRATANTE${values.CONTRATANTE_DOC ? ` · CNPJ/CPF ${values.CONTRATANTE_DOC}` : ''}`],
  ]);
  drawSignatures([
    ['TESTEMUNHA 1', 'Nome:                                CPF:'],
    ['TESTEMUNHA 2', 'Nome:                                CPF:'],
  ]);

  // ── Rodapé em todas as páginas ──────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const fy = doc.page.height - 50;
    doc.page.margins.bottom = 0; // escrever no rodapé sem abrir página nova
    doc.moveTo(left, fy - 4).lineTo(right, fy - 4).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b');
    doc.text(`Contrato ${contract.number} · Consart ERP · Rubricas: ______ / ______`, left, fy, { width: width * 0.7, lineBreak: false });
    doc.text(`Página ${i - range.start + 1} de ${range.count}`, left + width * 0.7, fy, {
      width: width * 0.3, align: 'right', lineBreak: false,
    });
  }

  doc.end();
  return done;
}
