// ╔══════════════════════════════════════════════════════════════════════╗
// ║ edi.js — EDI PROCEDA (NOTFIS, OCOREN, CONEMB, DOCCOB)               ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ ✅ Gera OCOREN / CONEMB / DOCCOB (layout 3.1, posições fixas)       ║
// ║ ✅ Importa NOTFIS e cria os CT-es digitados                          ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { mountTmsPage, api, ask, download, notifyOk, notifyInfo } from './tmsEngine.js';
import { fDate } from './tmsCommon.js';

const EDI_TYPES = [
  { value: 'NOTFIS', label: 'NOTFIS — notas fiscais (recebido do cliente)' },
  { value: 'OCOREN', label: 'OCOREN — ocorrências de entrega' },
  { value: 'CONEMB', label: 'CONEMB — conhecimentos embarcados' },
  { value: 'DOCCOB', label: 'DOCCOB — cobrança (fatura)' },
];
const DIRECTIONS = [{ value: 'IMPORTACAO', label: 'Importação' }, { value: 'EXPORTACAO', label: 'Exportação' }];
const DIR_LABEL = Object.fromEntries(DIRECTIONS.map((d) => [d.value, d.label]));
const STATUS_LABEL = { GERADO: 'Gerado', IMPORTADO: 'Importado', ERRO: 'Erro' };

async function generate(page) {
  const customers = await api('/lookups/customers');
  const { rows: invoices } = await api('/freightInvoices?limit=200&status=EMITIDA');
  const v = await ask({
    title: '📤 Gerar arquivo EDI',
    fields: [
      { key: 'edi_type', label: 'Arquivo', type: 'select', noEmpty: true, options: EDI_TYPES.filter((t) => t.value !== 'NOTFIS'), w: 40 },
      { key: 'customer_id', label: 'Cliente tomador (OCOREN / CONEMB; vazio = todos)', type: 'select', options: customers.map((c) => ({ value: c.id, label: c.label })), w: 40 },
      fDate('date_from', 'Período de', { w: 19 }), fDate('date_to', 'até', { w: 19 }),
      {
        key: 'freight_invoice_id', label: 'Fatura (só DOCCOB)', type: 'select', w: 40,
        options: invoices.map((i) => ({ value: i.freight_invoice_id, label: `Fatura ${i.freight_invoice_id} · ${i.customer_name}` })),
      },
    ],
    confirmLabel: '📤 Gerar',
  });
  if (!v) return;
  const c = customers.find((x) => String(x.id) === String(v.customer_id));
  const f = await api('/edi/export', { method: 'POST', body: { ...v, customer_name: c?.name } });
  notifyOk(`${f.file_name} gerado com ${f.records} registro(s).`);
  await download(`/edi/${f.file_id}/download`, f.file_name);
  await page.reloadAll();
}

/** Lê o arquivo do disco no padrão dos EDIs (ISO-8859-1) */
function pickTextFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.TXT,.edi,.EDI,text/plain';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve({ file_name: file.name, content: String(reader.result || '') });
      reader.onerror = () => resolve(null);
      reader.readAsText(file, 'ISO-8859-1');
    };
    input.click();
  });
}

async function importNotfis(page) {
  const f = await pickTextFile();
  if (!f) return;
  const out = await api('/edi/import-notfis', { method: 'POST', body: f });
  notifyInfo('NOTFIS importado', [out.result, 'Complete os CT-es digitados na tela de CT-e e emita.']);
  await page.reloadAll();
}

mountTmsPage({
  title: 'EDI — Troca de arquivos com clientes',
  subtitle: 'Arquivos no padrão PROCEDA 3.1: receba as notas (NOTFIS) e envie ocorrências, conhecimentos e cobranças.',
  tabs: [{
    key: 'files', label: '🔁 Arquivos', resource: 'edi', pk: 'file_id',
    searchPlaceholder: 'Nome do arquivo, cliente...',
    toolbar: [{ label: '📤 Gerar arquivo', run: generate }, { label: '📥 Importar NOTFIS', run: importNotfis }],
    filters: [
      { key: 'edi_type', label: 'Tipo', options: EDI_TYPES.map((t) => ({ value: t.value, label: t.value })) },
      { key: 'direction', label: 'Sentido', options: DIRECTIONS },
      { key: 'period', type: 'daterange', label: 'Data de' },
    ],
    columns: [
      { key: 'created_at', label: 'Data', fmt: 'datetime', width: 140 },
      { key: 'edi_type', label: 'Tipo', width: 80 },
      { key: 'direction', label: 'Sentido', fmt: 'badge', labels: DIR_LABEL, width: 110 },
      { key: 'file_name', label: 'Arquivo', width: 200 },
      { key: 'customer_name', label: 'Cliente', width: 200 },
      { key: 'records', label: 'Registros', fmt: 'int', width: 90 },
      { key: 'result', label: 'Resultado', width: 280 },
      { key: 'status', label: 'Situação', fmt: 'badge', labels: STATUS_LABEL, width: 100 },
    ],
    actions: [{ label: '⬇️ Baixar', run: (r) => download(`/edi/${r.file_id}/download`, r.file_name) }],
  }],
});
