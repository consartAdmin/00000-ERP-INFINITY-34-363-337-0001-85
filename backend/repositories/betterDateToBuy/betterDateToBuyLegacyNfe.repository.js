// ╔════════════════════════════════════════════════════════════════════╗
// ║ betterDateToBuyLegacyNfe.repository.js — NF-e do sistema antigo    ║
// ║ XMLs da tela "Notas Fiscais Sistema Antigo"                        ║
// ║ (public/painelNotasFiscais/xmlAntigasBh3) entram no histórico de   ║
// ║ compras da Melhor Data de Compra.                                  ║
// ║                                                                    ║
// ║ Conta só NF-e de venda: saída (tpNF 1), finalidade normal          ║
// ║ (finNFe 1, sem devolução), autorizada (cStat 100/150) e que não    ║
// ║ seja para a própria empresa (mesma raiz de CNPJ do emitente).      ║
// ║ O cliente é achado pelo CNPJ/CPF do destinatário (customers.tax_id)║
// ║ — feito no SQL do histórico.                                       ║
// ║                                                                    ║
// ║ Os XMLs são lidos uma vez e ficam em memória; relê quando a pasta  ║
// ║ muda (quantidade de arquivos ou data da pasta).                    ║
// ╚════════════════════════════════════════════════════════════════════╝

import fs from 'node:fs';
import path from 'node:path';
import { XML_DIR } from '../painelNotasFiscais/painelNotasFiscais.constants.js';

// Leitura por expressão (sem parser): só alguns campos fixos do layout
// da NF-e, bem mais rápido para milhares de arquivos.
const tag = (xml, name) => {
  const m = new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(xml);
  return m ? m[1].trim() : '';
};
const block = (xml, name) => {
  const m = new RegExp(`<(?:\\w+:)?${name}[\\s>][\\s\\S]*?</(?:\\w+:)?${name}>`).exec(xml);
  return m ? m[0] : '';
};

const EMPTY = Object.freeze({ docs: [], dates: [], numbers: [], totals: [] });

let cache = { key: null, data: EMPTY };

const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');

// Uma NF-e (XML) → venda ou null
export function parseLegacySale(xml) {
  const ide = block(xml, 'ide');
  if (tag(ide, 'tpNF') !== '1') return null;
  if ((tag(ide, 'finNFe') || '1') !== '1') return null;
  if (!['100', '150'].includes(tag(block(xml, 'infProt'), 'cStat'))) return null;

  const dest = block(xml, 'dest');
  const doc = onlyDigits(tag(dest, 'CNPJ') || tag(dest, 'CPF'));
  const emit = onlyDigits(tag(block(xml, 'emit'), 'CNPJ'));
  if (!doc) return null;
  if (doc.length === 14 && emit.length === 14 && doc.slice(0, 8) === emit.slice(0, 8)) return null;

  const date = (tag(ide, 'dhEmi') || tag(ide, 'dEmi')).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  return {
    doc,
    date,
    number: tag(ide, 'nNF'),
    total: Number(tag(block(xml, 'ICMSTot'), 'vNF')) || 0,
  };
}

function folderKey() {
  try {
    const stat = fs.statSync(XML_DIR);
    const files = fs.readdirSync(XML_DIR).filter((f) => f.toLowerCase().endsWith('.xml'));
    return { key: `${files.length}:${stat.mtimeMs}`, files };
  } catch {
    return { key: 'none', files: [] };
  }
}

// Vendas do sistema antigo em colunas (para unnest no SQL)
export function getLegacySales() {
  const { key, files } = folderKey();
  if (cache.key === key) return cache.data;

  const data = { docs: [], dates: [], numbers: [], totals: [] };
  const seen = new Set();

  for (const file of files) {
    try {
      const sale = parseLegacySale(fs.readFileSync(path.join(XML_DIR, file), 'utf8'));
      if (!sale) continue;

      const dedupe = sale.number || file;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      data.docs.push(sale.doc);
      data.dates.push(sale.date);
      data.numbers.push(sale.number);
      data.totals.push(sale.total);
    } catch (err) {
      console.warn('[betterDateToBuy] XML antigo ignorado:', file, err.message);
    }
  }

  cache = { key, data };
  console.log(`[betterDateToBuy] NF-e do sistema antigo: ${data.docs.length} vendas de ${files.length} XMLs`);
  return data;
}

export function legacyParams() {
  const s = getLegacySales();
  return [s.docs, s.dates, s.numbers, s.totals];
}
