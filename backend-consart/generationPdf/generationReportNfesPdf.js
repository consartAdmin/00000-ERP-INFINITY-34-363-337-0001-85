// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: generationReportNfesPdf.js                                    ║
// ║ MODULE: PDF - Relatório de NF-es                                    ║
// ║ CONSART ERP — layout padrão (consartPdfTheme.js)                    ║
// ║ Gera PDF com resumo e listagem detalhada das NF-es filtradas        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import fs from 'node:fs';
import path from 'node:path';

import {
  C, SERIES, PAGE,
  createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, number, nowBR,
} from './consartPdfTheme.js';

function moneyBR(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateTimeBR(value) {
  if (!value) return '';
  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
      const [ymd, hm] = raw.split('T');
      const [y, m, da] = ymd.split('-');
      return `${da}/${m}/${y} ${hm.slice(0, 5)}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const [y, m, da] = raw.slice(0, 10).split('-');
      return `${da}/${m}/${y}`;
    }
    return raw;
  }

  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');

  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function onlyDateBR(value) {
  if (!value) return '';
  const d = new Date(value);

  if (Number.isNaN(d.getTime())) {
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
      const [y, m, da] = raw.slice(0, 10).split('-');
      return `${da}/${m}/${y}`;
    }
    return raw;
  }

  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

function normalizeStatus(status) {
  return String(status || '').trim().toUpperCase();
}

function getStatusLabel(status) {
  const s = normalizeStatus(status);
  if (!s) return 'SEM STATUS';
  if (s === 'CONCLUIDO' || s === 'CONCLUÍDO') return 'CONCLUÍDO';
  return s;
}

function getStatusColor(status) {
  const s = normalizeStatus(status);
  if (s === 'AUTORIZADA' || s === 'CONCLUIDO' || s === 'CONCLUÍDO') return C.green;
  if (s.includes('CANCEL')) return '#1d4ed8';
  if (s.includes('REJEIT')) return C.red;
  if (s.includes('PROCESS')) return C.amber;
  return C.text;
}

function buildSummary(rows = []) {
  const summary = {
    totalNotas: rows.length,
    valorTotal: 0,
    concluidas: 0,
    canceladas: 0,
    rejeitadas: 0,
    processando: 0,
    outras: 0,
  };

  for (const row of rows) {
    const status = normalizeStatus(row.nfe_status);
    const total = Number(row.total_amount || 0);

    summary.valorTotal += total;

    if (status === 'AUTORIZADA' || status === 'CONCLUIDO' || status === 'CONCLUÍDO') {
      summary.concluidas += 1;
      continue;
    }
    if (status.includes('CANCEL')) {
      summary.canceladas += 1;
      continue;
    }
    if (status.includes('REJEIT')) {
      summary.rejeitadas += 1;
      continue;
    }
    if (status.includes('PROCESS')) {
      summary.processando += 1;
      continue;
    }
    summary.outras += 1;
  }

  return summary;
}

function getColumns() {
  return [
    {
      key: 'order_number',
      label: 'Pedido',
      w: 46,
      align: 'center',
      getter: (r) => r.order_number || r.order_id || '',
    },
    {
      key: 'issue_date',
      label: 'Emissão',
      w: 68,
      getter: (r) => onlyDateBR(r.issue_date || r.created_at || ''),
    },
    {
      key: 'nfe_number',
      label: 'Nº NF-e',
      w: 50,
      align: 'center',
      getter: (r) => r.nfe_number || '',
    },
    {
      key: 'serie',
      label: 'Série',
      w: 38,
      align: 'center',
      getter: (r) => r.serie || '',
    },
    {
      key: 'customer_name',
      label: 'Cliente',
      w: 140,
      getter: (r) => r.customer_name || '',
    },
    {
      key: 'customer_tax_id',
      label: 'CNPJ/CPF',
      w: 86,
      align: 'center',
      getter: (r) => r.customer_tax_id || '',
    },
    {
      key: 'nfe_key',
      label: 'Chave de Acesso',
      w: 196,
      getter: (r) => r.nfe_key || '',
    },
    {
      key: 'total_amount',
      label: 'Total (R$)',
      w: 62,
      align: 'right',
      getter: (r) => moneyBR(r.total_amount || 0),
    },
    {
      key: 'nfe_status',
      label: 'Status',
      w: 72,
      getter: (r) => getStatusLabel(r.nfe_status),
    },
    {
      key: 'nfe_environment',
      label: 'Ambiente',
      w: 62,
      align: 'center',
      getter: (r) => {
        const env = String(r.nfe_environment || r.environment || '').toUpperCase();
        if (env.startsWith('PROD')) return 'PRODUÇÃO';
        if (env.startsWith('HOM')) return 'HOMOLOG.';
        return env || 'N/D';
      },
    },
    {
      key: 'protocol',
      label: 'Protocolo',
      w: 84,
      getter: (r) => r.protocol || '',
    },
  ];
}

async function writeToTarget(buffer, output) {
  if (output?.type === 'response' && output.res) {
    output.res.end(buffer);
    return;
  }

  if (output?.type === 'stream' && output.stream) {
    await new Promise((resolve, reject) => {
      output.stream.on('error', reject);
      output.stream.end(buffer, resolve);
    });
    return;
  }

  if (output?.type === 'file' && output.filePath) {
    fs.mkdirSync(path.dirname(output.filePath), { recursive: true });
    await fs.promises.writeFile(output.filePath, buffer);
    return;
  }

  throw new Error('Saída PDF inválida. Use response, stream ou file.');
}

const REPORT_TITLE = 'Relatório de NF-es';

/**
 * Gera relatório PDF de NF-es.
 *
 * @param {Object} params
 * @param {Array<Object>} params.rows
 * @param {Object} [params.filters]
 * @param {Object} params.output
 * @param {'response'|'stream'|'file'} params.output.type
 * @param {import('express').Response} [params.output.res]
 * @param {import('stream').Writable} [params.output.stream]
 * @param {string} [params.output.filePath]
 */
export async function generateReportNfesPdf({
  rows = [],
  filters = {},
  output,
} = {}) {
  if (!['response', 'stream', 'file'].includes(output?.type)) {
    throw new Error('Saída PDF inválida. Use response, stream ou file.');
  }

  const { doc, done } = createThemedDoc({ title: REPORT_TITLE });
  const generatedAt = nowBR();

  const dataIni = filters.dataIni ? onlyDateBR(filters.dataIni) : '';
  const dataFim = filters.dataFim ? onlyDateBR(filters.dataFim) : '';

  let y = drawFullHeader(doc, {
    title: REPORT_TITLE,
    subtitle: 'Relação das NF-es para conferência antes do envio à contabilidade',
    info: [
      ['Período', dataIni || dataFim ? `${dataIni || '...'} a ${dataFim || '...'}` : 'Todos os períodos'],
      ['Status', filters.status || 'Todos'],
      ['Busca', filters.q || 'Todos'],
      ['Ordem', `${filters.sortBy || 'pedido'} / ${String(filters.sortOrder || 'desc').toUpperCase()}`],
    ],
  }) + 14;

  const summary = buildSummary(rows);

  y = drawKpis(doc, y, [
    { label: 'Total NF-es', value: number(summary.totalNotas, 0), hint: summary.processando ? `${summary.processando} em processamento` : 'Notas no relatório', color: SERIES[0] },
    { label: 'Valor total', value: `R$ ${moneyBR(summary.valorTotal)}`, hint: 'Soma das notas', color: SERIES[5] },
    { label: 'Concluídas', value: number(summary.concluidas, 0), hint: 'Autorizadas', color: C.green },
    { label: 'Canceladas', value: number(summary.canceladas, 0), hint: 'Canceladas na SEFAZ', color: '#1d4ed8' },
    { label: 'Rejeitadas', value: number(summary.rejeitadas, 0), hint: summary.outras ? `${summary.outras} com outro status` : 'Rejeitadas na SEFAZ', color: summary.rejeitadas ? C.red : SERIES[7] },
  ]) + 16;

  const cols = getColumns();
  const table = makeTable(doc, {
    title: 'Listagem detalhada das NF-es',
    continuation: { title: REPORT_TITLE, subtitle: 'Listagem detalhada das NF-es (continuação)' },
    rowH: 18,
    fontSize: 6.5,
    columns: cols.map((c) => ({ label: c.label, w: c.w, align: c.align, bold: c.key === 'total_amount' })),
  });

  y = table.section(y);

  if (!rows.length) {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text('Nenhuma NF-e encontrada para os filtros informados.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
  }

  rows.forEach((row, index) => {
    y = table.row(y, cols.map((col) => {
      const v = String((typeof col.getter === 'function' ? col.getter(row) : row[col.key]) ?? '');
      if (col.key === 'nfe_status') return { text: v, color: getStatusColor(v), bold: true };
      return v;
    }), { index });
  });

  if (rows.length) {
    table.total(y, cols.map((col, i) => {
      if (i === 0) return 'TOTAL';
      if (col.key === 'customer_name') return `${number(rows.length, 0)} NF-e(s)`;
      if (col.key === 'total_amount') return moneyBR(summary.valorTotal);
      return '';
    }));
  }

  drawFooters(doc, { title: REPORT_TITLE, generatedAt });
  doc.end();

  await writeToTarget(await done, output);
}

export default generateReportNfesPdf;
