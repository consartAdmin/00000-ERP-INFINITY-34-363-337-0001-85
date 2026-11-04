// ╔══════════════════════════════════════════════════════════════════════╗
// ║ consartPdfTheme.js — Layout padrão dos PDFs do CONSART ERP           ║
// ║ PDFKit | ESM                                                        ║
// ║ Modelo: Relatório de Comissões por NF-e                              ║
// ║ - Cabeçalho azul-marinho (logo, título, subtítulo, filtros)          ║
// ║ - Faixa verde-água                                                  ║
// ║ - Cards de KPI, painéis com gráficos, tabelas com cabeçalho azul     ║
// ║ - Rodapé "CONSART ERP · título · Gerado em · Página X de N"          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import PDFDocument from 'pdfkit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_LOGO_PATH = path.resolve(__dirname, '../public/imagens/brasaoConsart.png');
export const BRAND = 'CONSART ERP';

/* ======================================================================
   Paleta / medidas
====================================================================== */

export const C = {
    navy: '#0f2747',
    blue: '#174a7e',
    teal: '#14b8a6',
    text: '#1e293b',
    muted: '#64748b',
    border: '#dbe3ee',
    soft: '#f4f7fb',
    zebra: '#f8fafc',
    white: '#ffffff',
    totalFill: '#e6eef8',
    headerSub: '#c7d4e6',
    headerLabel: '#9fb3cc',
    grid: '#edf1f6',
    red: '#ef4444',
    green: '#16a34a',
    amber: '#f59e0b',
};

export const SERIES = ['#174a7e', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#84cc16', '#64748b'];

export const PAGE = { margin: 28, headerH: 74, compactHeaderH: 46, footerH: 26 };

/* ======================================================================
   Formatação
====================================================================== */

export const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

export function money(value) {
    return num(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function moneyShort(value) {
    const v = num(value);
    if (Math.abs(v) >= 1000000) return `R$ ${(v / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
    if (Math.abs(v) >= 1000) return `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
    return money(v);
}

export function number(value, digits = 2) {
    return num(value).toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function percent(value, digits = 2) {
    return `${number(value, digits)}%`;
}

export function isoDay(value) {
    if (!value) return '';
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

// Datas SQL/ISO/BR -> DD/MM/AAAA, sem new Date('AAAA-MM-DD') (evita troca de dia por fuso)
export function dateBR(value) {
    if (!value) return '-';
    const raw = value instanceof Date ? isoDay(value) : String(value).trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[1]}/${br[2]}/${br[3]}`;
    return '-';
}

export function nowBR() {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

export function safe(value, fallback = '-') {
    const s = String(value ?? '').trim();
    return s || fallback;
}

export function periodLabel(dateStart, dateEnd) {
    if (!dateStart && !dateEnd) return 'Todos os períodos';
    if (dateStart && dateEnd) return `${dateBR(dateStart)} a ${dateBR(dateEnd)}`;
    if (dateStart) return `A partir de ${dateBR(dateStart)}`;
    return `Até ${dateBR(dateEnd)}`;
}

// Corta o texto para caber em uma linha (o ellipsis do PDFKit só funciona com height)
export function fit(doc, text, width) {
    const s = String(text ?? '');
    if (width <= 0 || doc.widthOfString(s) <= width) return s;

    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (doc.widthOfString(`${s.slice(0, mid).trimEnd()}…`) <= width) lo = mid;
        else hi = mid - 1;
    }
    return `${s.slice(0, lo).trimEnd()}…`;
}

/* ======================================================================
   Documento
====================================================================== */

/**
 * Cria o PDFDocument no padrão (A4, margens, bufferPages para o rodapé).
 * Retorna { doc, done } — done() é uma Promise<Buffer> resolvida no 'end'.
 */
export function createThemedDoc({ title = 'Relatório', layout = 'landscape', subject, author = BRAND } = {}) {
    const doc = new PDFDocument({
        size: 'A4',
        layout,
        margin: PAGE.margin,
        bufferPages: true,
        info: { Title: title, Author: author, ...(subject ? { Subject: subject } : {}) },
    });

    const chunks = [];
    const done = new Promise((resolve, reject) => {
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });

    return { doc, done };
}

// Limite inferior útil da página (acima do rodapé)
export function contentBottom(doc) {
    return doc.page.height - PAGE.footerH - 10;
}

export function contentWidth(doc) {
    return doc.page.width - PAGE.margin * 2;
}

/* ======================================================================
   Logo
====================================================================== */

/**
 * Resolve um logo (URL http(s), caminho, file:// ou Buffer).
 * Sem logo válido, cai no brasão CONSART.
 */
export async function resolveLogo(source) {
    if (Buffer.isBuffer(source)) return source;
    const s = String(source ?? '').trim();
    if (!s) return DEFAULT_LOGO_PATH;

    if (/^https?:\/\//i.test(s)) {
        try {
            const response = await fetch(s);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return Buffer.from(await response.arrayBuffer());
        } catch (error) {
            console.warn('[PDF] Não foi possível carregar o logo:', error.message);
            return DEFAULT_LOGO_PATH;
        }
    }

    const file = s.startsWith('file://') ? fileURLToPath(s) : (path.isAbsolute(s) ? s : path.resolve(process.cwd(), s));
    return fs.existsSync(file) ? file : DEFAULT_LOGO_PATH;
}

/**
 * Desenha o logo. Com tile=true desenha um quadrado branco atrás
 * (para logos de empresa com fundo/texto escuro sobre o azul-marinho).
 */
export function drawLogo(doc, x, y, size, logo = DEFAULT_LOGO_PATH, { tile = false } = {}) {
    try {
        const ok = Buffer.isBuffer(logo) || (typeof logo === 'string' && fs.existsSync(logo));
        if (!ok) return false;

        if (tile) {
            doc.roundedRect(x, y, size, size, 6).fill(C.white);
            const pad = 4;
            doc.image(logo, x + pad, y + pad, { fit: [size - pad * 2, size - pad * 2], align: 'center', valign: 'center' });
        } else {
            doc.image(logo, x, y, { fit: [size, size], align: 'center', valign: 'center' });
        }
        return true;
    } catch {
        // logo inválido: segue sem imagem
        return false;
    }
}

/* ======================================================================
   Cabeçalho / rodapé
====================================================================== */

/**
 * Cabeçalho completo (1ª página).
 * opts: { title, subtitle, brand, info: [[label, value], ...], logo, logoTile }
 * Retorna o y logo abaixo da faixa verde-água.
 */
export function drawFullHeader(doc, opts = {}) {
    const {
        title = 'Relatório',
        subtitle = '',
        brand = BRAND,
        info = [],
        logo = DEFAULT_LOGO_PATH,
        logoTile = false,
    } = opts;

    const W = doc.page.width;
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.rect(0, 0, W, PAGE.headerH).fill(C.navy);
    doc.rect(0, PAGE.headerH, W, 3).fill(C.teal);

    const hasLogo = drawLogo(doc, PAGE.margin, 13, 48, logo, { tile: logoTile });
    const tx = PAGE.margin + (hasLogo ? 60 : 0);

    const lines = info.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '').slice(0, 4);
    const infoW = lines.length ? 260 : 0;
    const titleW = W - tx - PAGE.margin - infoW - 12;

    doc.font('Helvetica-Bold').fontSize(17).fillColor(C.white);
    doc.text(fit(doc, title, titleW), tx, 20, { lineBreak: false });

    const sub = [brand, subtitle].filter(Boolean).join('  ·  ');
    doc.font('Helvetica').fontSize(9).fillColor(C.headerSub);
    doc.text(fit(doc, sub, titleW), tx, 44, { lineBreak: false });

    if (lines.length) {
        const rx = W - PAGE.margin - infoW;
        const step = lines.length > 3 ? 13 : 15;
        let ly = lines.length > 3 ? 12 : 16;

        lines.forEach(([label, value]) => {
            doc.font('Helvetica').fontSize(8).fillColor(C.headerLabel)
                .text(`${label}:`, rx, ly, { width: 90, align: 'right', lineBreak: false });
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white);
            doc.text(fit(doc, value, 164), rx + 96, ly - 0.5, { width: 164, lineBreak: false });
            ly += step;
        });
    }

    doc.page.margins.bottom = oldBottom;
    return PAGE.headerH + 3;
}

/**
 * Cabeçalho compacto (páginas seguintes).
 * opts: { title, subtitle, logo, logoTile }
 */
export function drawCompactHeader(doc, opts = {}) {
    const { title = 'Relatório', subtitle = '', logo = DEFAULT_LOGO_PATH, logoTile = false } = opts;
    const W = doc.page.width;
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    doc.rect(0, 0, W, PAGE.compactHeaderH).fill(C.navy);
    doc.rect(0, PAGE.compactHeaderH, W, 2).fill(C.teal);

    const hasLogo = drawLogo(doc, PAGE.margin, 8, 30, logo, { tile: logoTile });
    const tx = PAGE.margin + (hasLogo ? 40 : 0);
    const tw = W - tx - PAGE.margin;

    doc.font('Helvetica-Bold').fontSize(12).fillColor(C.white);
    doc.text(fit(doc, title, tw), tx, 12, { lineBreak: false });

    if (subtitle) {
        doc.font('Helvetica').fontSize(8).fillColor(C.headerSub);
        doc.text(fit(doc, subtitle, tw), tx, 28, { lineBreak: false });
    }

    doc.page.margins.bottom = oldBottom;
    return PAGE.compactHeaderH + 2;
}

/**
 * Rodapé em todas as páginas. Chame no fim, antes de doc.end().
 * opts: { title, brand, generatedAt, extra }
 */
export function drawFooters(doc, opts = {}) {
    const { title = '', brand = BRAND, generatedAt = nowBR(), extra = '' } = typeof opts === 'string' ? { generatedAt: opts } : opts;
    const range = doc.bufferedPageRange();

    for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);

        const W = doc.page.width;
        const y = doc.page.height - PAGE.footerH + 4;

        // evita que o texto do rodapé crie páginas novas
        const oldBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;

        doc.moveTo(PAGE.margin, y - 6).lineTo(W - PAGE.margin, y - 6)
            .strokeColor(C.border).lineWidth(0.6).stroke();

        const left = [brand, title, extra].filter(Boolean).join('  ·  ');
        doc.font('Helvetica').fontSize(7.5).fillColor(C.muted);
        doc.text(fit(doc, left, W / 2 - 120 - PAGE.margin), PAGE.margin, y, { lineBreak: false });
        doc.text(`Gerado em ${generatedAt}`, W / 2 - 100, y, { width: 200, align: 'center', lineBreak: false });
        doc.text(`Página ${i + 1 - range.start} de ${range.count}`, W - PAGE.margin - 120, y, { width: 120, align: 'right', lineBreak: false });

        doc.page.margins.bottom = oldBottom;
    }
}

/* ======================================================================
   Blocos
====================================================================== */

/**
 * Título de seção (texto azul-marinho + traço verde-água). Retorna y abaixo.
 */
export function drawSectionTitle(doc, y, title, { x = PAGE.margin } = {}) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.navy).text(title, x, y, { lineBreak: false });
    doc.rect(x, y + 15, 34, 2).fill(C.teal);
    return y + 24;
}

/**
 * Linha de cards de KPI. kpis: [{ label, value, hint, color }]
 */
export function drawKpis(doc, y, kpis, { h = 58, gap = 10, x = PAGE.margin, width } = {}) {
    if (!kpis?.length) return y;
    const totalW = width ?? contentWidth(doc);
    const w = (totalW - gap * (kpis.length - 1)) / kpis.length;

    kpis.forEach((k, i) => {
        const kx = x + i * (w + gap);

        doc.roundedRect(kx, y, w, h, 6).lineWidth(1).fillAndStroke(C.white, C.border);
        doc.rect(kx, y + 8, 3, h - 16).fill(k.color || SERIES[i % SERIES.length]);

        doc.font('Helvetica').fontSize(8).fillColor(C.muted)
            .text(String(k.label || '').toUpperCase(), kx + 14, y + 11, { width: w - 24, lineBreak: false, characterSpacing: 0.4 });

        doc.font('Helvetica-Bold').fontSize(15).fillColor(k.valueColor || C.text);
        doc.text(fit(doc, k.value, w - 24), kx + 14, y + 26, { width: w - 24, lineBreak: false });

        if (k.hint) {
            doc.font('Helvetica').fontSize(7).fillColor(C.muted);
            doc.text(fit(doc, k.hint, w - 24), kx + 14, y + 44, { width: w - 24, lineBreak: false });
        }
    });

    return y + h;
}

/**
 * Painel branco com título; devolve a área interna { cx, cy, cw, ch }.
 */
export function drawPanel(doc, x, y, w, h, title, subtitle) {
    doc.roundedRect(x, y, w, h, 6).lineWidth(1).fillAndStroke(C.white, C.border);

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.text)
        .text(title, x + 12, y + 10, { width: w - 24, lineBreak: false });

    if (subtitle) {
        doc.font('Helvetica').fontSize(7).fillColor(C.muted)
            .text(subtitle, x + 12, y + 23, { width: w - 24, lineBreak: false });
    }

    return { cx: x + 12, cy: y + 38, cw: w - 24, ch: h - 48 };
}

export function drawEmpty(doc, area, text = 'Sem dados para o período.') {
    doc.font('Helvetica').fontSize(8).fillColor(C.muted)
        .text(text, area.cx, area.cy + area.ch / 2 - 4, { width: area.cw, align: 'center' });
}

/* ======================================================================
   Gráficos
====================================================================== */

export function drawHorizontalBars(doc, area, data, { format = moneyShort, color = SERIES[0], labelW = 78, valueW = 62 } = {}) {
    if (!data.length) return drawEmpty(doc, area);

    const max = Math.max(...data.map((d) => Math.abs(d.value)), 0.0001);
    const barMaxW = area.cw - labelW - valueW - 8;
    const rowH = Math.min(22, area.ch / data.length);
    const barH = Math.min(12, rowH - 6);

    data.forEach((d, i) => {
        const ry = area.cy + i * rowH;
        const by = ry + (rowH - barH) / 2;
        const bw = Math.max(2, (Math.abs(d.value) / max) * barMaxW);

        doc.font('Helvetica').fontSize(7.5).fillColor(C.text);
        doc.text(fit(doc, d.label, labelW - 6), area.cx, by + 2, { width: labelW - 6, lineBreak: false });

        doc.roundedRect(area.cx + labelW, by, barMaxW, barH, 2).fill(C.soft);
        doc.roundedRect(area.cx + labelW, by, bw, barH, 2).fill(d.color || color);

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.text)
            .text(format(d.value), area.cx + labelW + barMaxW + 6, by + 2, { width: valueW, lineBreak: false });
    });
}

function arcPath(cx, cy, rOuter, rInner, a0, a1) {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;

    return [
        `M ${p(rOuter, a0)}`,
        `A ${rOuter} ${rOuter} 0 ${large} 1 ${p(rOuter, a1)}`,
        `L ${p(rInner, a1)}`,
        `A ${rInner} ${rInner} 0 ${large} 0 ${p(rInner, a0)}`,
        'Z',
    ].join(' ');
}

export function drawDonut(doc, area, data, centerLabel, { format = moneyShort } = {}) {
    const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
    if (!data.length || total <= 0) return drawEmpty(doc, area);

    const r = Math.min(area.ch / 2, 58);
    const cx = area.cx + r + 2;
    const cy = area.cy + area.ch / 2;

    let a = -Math.PI / 2;

    data.forEach((d, i) => {
        const span = (Math.max(0, d.value) / total) * Math.PI * 2;
        const color = d.color || SERIES[i % SERIES.length];
        // um único item ocupa o círculo inteiro: desenha em duas metades
        if (span >= Math.PI * 2 - 0.0001) {
            doc.path(arcPath(cx, cy, r, r * 0.6, a, a + Math.PI)).fill(color);
            doc.path(arcPath(cx, cy, r, r * 0.6, a + Math.PI, a + Math.PI * 2)).fill(color);
        } else if (span > 0) {
            doc.path(arcPath(cx, cy, r, r * 0.6, a, a + span)).fill(color);
        }
        a += span;
    });

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.text)
        .text(format(total), cx - r * 0.6, cy - 8, { width: r * 1.2, align: 'center', lineBreak: false });
    doc.font('Helvetica').fontSize(6.5).fillColor(C.muted)
        .text(centerLabel, cx - r * 0.6, cy + 3, { width: r * 1.2, align: 'center', lineBreak: false });

    const lx = cx + r + 14;
    const lw = area.cx + area.cw - lx;
    const lh = Math.min(16, area.ch / data.length);
    let ly = cy - (data.length * lh) / 2;

    data.forEach((d, i) => {
        doc.rect(lx, ly + 2, 7, 7).fill(d.color || SERIES[i % SERIES.length]);

        doc.font('Helvetica').fontSize(7.5).fillColor(C.text);
        doc.text(fit(doc, d.label, lw - 54), lx + 11, ly + 1, { width: lw - 50, lineBreak: false });

        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.muted)
            .text(`${number((Math.max(0, d.value) / total) * 100, 1)}%`, lx + lw - 38, ly + 1, { width: 38, align: 'right', lineBreak: false });

        ly += lh;
    });
}

export function drawColumns(doc, area, data, { format = moneyShort, color = SERIES[1] } = {}) {
    if (!data.length) return drawEmpty(doc, area);

    const max = Math.max(...data.map((d) => d.value), 0.0001);
    const axisW = 44;
    const labelH = 14;
    const plotX = area.cx + axisW;
    const plotW = area.cw - axisW;
    const plotH = area.ch - labelH;
    const baseY = area.cy + plotH;

    // grade + eixo
    for (let i = 0; i <= 4; i += 1) {
        const gy = baseY - (plotH * i) / 4;
        doc.moveTo(plotX, gy).lineTo(plotX + plotW, gy).strokeColor('#e8edf4').lineWidth(0.5).stroke();
        doc.font('Helvetica').fontSize(6).fillColor(C.muted)
            .text(format((max * i) / 4), area.cx, gy - 3, { width: axisW - 4, align: 'right', lineBreak: false });
    }

    const slot = plotW / data.length;
    const bw = Math.max(2, Math.min(18, slot * 0.65));
    const labelEvery = Math.ceil(data.length / 10);

    data.forEach((d, i) => {
        const h = (Math.max(0, d.value) / max) * plotH;
        const bx = plotX + i * slot + (slot - bw) / 2;

        if (h > 0) doc.rect(bx, baseY - h, bw, h).fill(d.color || color);

        if (i % labelEvery === 0) {
            doc.font('Helvetica').fontSize(6).fillColor(C.muted)
                .text(d.label, plotX + i * slot - 10, baseY + 4, { width: slot + 20, align: 'center', lineBreak: false });
        }
    });
}

/* ======================================================================
   Tabelas
====================================================================== */

/**
 * Distribui a largura: colunas sem w dividem o espaço restante;
 * se as fixas passarem do total, tudo é escalado proporcionalmente.
 */
export function fitColumns(columns, width) {
    const fixed = columns.reduce((s, c) => s + (c.w || 0), 0);
    const flex = columns.filter((c) => !c.w);

    if (!flex.length || fixed >= width) {
        const scale = fixed > 0 ? width / fixed : 1;
        const each = flex.length ? 40 : 0;
        return columns.map((c) => ({ ...c, w: (c.w || each) * scale }));
    }

    const each = (width - fixed) / flex.length;
    return columns.map((c) => ({ ...c, w: c.w || each }));
}

/**
 * Tabela no padrão: cabeçalho azul, zebra, linha de total.
 *
 * makeTable(doc, {
 *   title,                         // título da seção (e do cabeçalho de continuação)
 *   columns: [{ label, w?, align?, bold? }],
 *   continuation: { title, logo, logoTile }  // cabeçalho compacto nas páginas novas
 *   onNewPage,                     // callback após nova página
 *   rowH, headerH, fontSize, x, width
 * })
 * -> { section(y), head(y), row(y, values, opts), total(y, values), ensure(y, h), columns, width }
 *
 * values podem ser texto ou { text, color, bold }.
 */
export function makeTable(doc, opts = {}) {
    const {
        title = '',
        rowH = 17,
        headerH = 20,
        fontSize = 7,
        headFontSize = 7.5,
        continuation = {},
        onNewPage,
    } = opts;

    const x0 = opts.x ?? PAGE.margin;
    const width = opts.width ?? contentWidth(doc);
    const columns = fitColumns(opts.columns || [], width);

    const head = (y) => {
        doc.rect(x0, y, width, headerH).fill(C.blue);
        doc.font('Helvetica-Bold').fontSize(headFontSize).fillColor(C.white);

        let cx = x0;
        columns.forEach((col) => {
            doc.text(fit(doc, col.label, col.w - 8), cx + 4, y + (headerH - headFontSize) / 2 + 0.5, {
                width: col.w - 8, align: col.align || 'left', lineBreak: false,
            });
            cx += col.w;
        });

        return y + headerH;
    };

    const newPage = () => {
        doc.addPage();
        const top = drawCompactHeader(doc, {
            title: continuation.title || title,
            subtitle: continuation.subtitle ?? (title ? `${title} (continuação)` : ''),
            logo: continuation.logo,
            logoTile: continuation.logoTile,
        }) + 12;
        onNewPage?.();
        return top;
    };

    const ensure = (y, needed, { withHead = true } = {}) => {
        if (y + needed <= contentBottom(doc)) return y;
        const top = newPage();
        return withHead ? head(top) : top;
    };

    const row = (y, values, { index = 0, bold = false, fill = null, color = C.text, height = rowH } = {}) => {
        const yy = ensure(y, height);

        doc.rect(x0, yy, width, height).fill(fill || (index % 2 ? C.zebra : C.white));
        doc.moveTo(x0, yy + height).lineTo(x0 + width, yy + height).strokeColor(C.grid).lineWidth(0.5).stroke();

        let cx = x0;
        columns.forEach((col, i) => {
            const v = values[i];
            const cell = v && typeof v === 'object' && !Array.isArray(v) ? v : { text: v };
            doc.font(bold || col.bold || cell.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(cell.color || color);
            doc.text(fit(doc, cell.text ?? '', col.w - 8), cx + 4, yy + (height - fontSize) / 2, {
                width: col.w - 8,
                align: col.align || 'left',
                lineBreak: false,
            });
            cx += col.w;
        });

        return yy + height;
    };

    const total = (y, values) => row(y, values, { bold: true, fill: C.totalFill, color: C.navy });

    const section = (y, sectionTitle = title) => {
        const yy = ensure(y, 26 + headerH + rowH * 2, { withHead: false });
        if (!sectionTitle) return head(yy);
        return head(drawSectionTitle(doc, yy, sectionTitle, { x: x0 }));
    };

    return { section, head, row, total, ensure, newPage, columns, width };
}

/**
 * Bloco de totais em cards pequenos alinhados à direita.
 * items: [{ label, value, color }]
 */
export function drawTotalsBox(doc, y, items, { width = 260 } = {}) {
    const lineH = 18;
    const h = items.length * lineH + 12;
    const x = doc.page.width - PAGE.margin - width;

    doc.roundedRect(x, y, width, h, 6).lineWidth(1).fillAndStroke(C.white, C.border);
    doc.rect(x, y + 8, 3, h - 16).fill(C.teal);

    items.forEach((it, i) => {
        const ly = y + 8 + i * lineH;
        const last = i === items.length - 1 && it.strong !== false;
        doc.font('Helvetica').fontSize(8.5).fillColor(C.muted)
            .text(it.label, x + 14, ly + 3, { width: width * 0.55, lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(last ? 10 : 9).fillColor(it.color || (last ? C.navy : C.text))
            .text(it.value, x + width * 0.45, ly + (last ? 2 : 3), { width: width * 0.55 - 12, align: 'right', lineBreak: false });
    });

    return y + h;
}

export default {
    C, SERIES, PAGE, BRAND, DEFAULT_LOGO_PATH,
    num, money, moneyShort, number, percent, isoDay, dateBR, nowBR, safe, periodLabel, fit,
    createThemedDoc, contentBottom, contentWidth, resolveLogo, drawLogo,
    drawFullHeader, drawCompactHeader, drawFooters, drawSectionTitle, drawKpis, drawPanel, drawEmpty,
    drawHorizontalBars, drawDonut, drawColumns, fitColumns, makeTable, drawTotalsBox,
};
