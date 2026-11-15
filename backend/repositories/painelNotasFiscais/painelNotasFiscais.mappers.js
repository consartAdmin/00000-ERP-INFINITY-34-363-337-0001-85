// ╔══════════════════════════════════════════════════════════════════════╗
// ║ painelNotasFiscais.mappers.js — XML da NF-e → campos do painel       ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { XMLParser } from 'fast-xml-parser';
import { log, onlyDigits, toNumberSafe, getNodeValue } from './painelNotasFiscais.utils.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  trimValues: true,
  // Mantém os valores como texto: sem isso o parser converte CNPJ/CPF em
  // número (perde os zeros à esquerda, ex.: 00268769000195 → 268769000195)
  // e a chave de 44 dígitos vira notação científica (3.12e+43).
  parseTagValue: false,
});

// CNPJ/CPF só com dígitos; completa zeros perdidos em XMLs antigos.
function normalizarDocumento(value) {
  const digits = onlyDigits(value);
  if (!digits) return '-';
  if (digits.length > 11 && digits.length < 14) return digits.padStart(14, '0');
  if (digits.length < 11) return digits.padStart(11, '0');
  return digits;
}

// ───────────────────────────────────────────────────────────────────────────
// Extração do XML
export function extrairCampos(xmlStr = '') {
  try {
    const j = parser.parse(xmlStr);

    const nfeProc = j?.nfeProc || {};
    const NFe = nfeProc?.NFe || j?.NFe || {};
    const infNFe = NFe?.infNFe || {};

    const ide = infNFe?.ide || {};
    const dest = infNFe?.dest || {};
    const total = infNFe?.total || {};
    const ICMSTot = total?.ICMSTot || {};
    const prot = nfeProc?.protNFe?.infProt || {};

    const chave =
      getNodeValue(
        prot?.chNFe,
        infNFe?.Id ? String(infNFe.Id).replace(/^NFe/i, '') : '',
      ) || '';

    const valorTotal =
      toNumberSafe(
        getNodeValue(
          ICMSTot?.vNF,
          ICMSTot?.vProd,
          total?.vNF,
          infNFe?.vNF,
        )
      );

    return {
      chave: onlyDigits(chave),
      cliente: String(getNodeValue(dest?.xNome, dest?.nome, '-') || '-'),
      cnpj: normalizarDocumento(getNodeValue(dest?.CNPJ, dest?.CPF)),
      numero: String(getNodeValue(ide?.nNF, ide?.numero, '-') || '-'),
      emissao: String(getNodeValue(ide?.dhEmi, ide?.dEmi, '-') || '-'),
      valorTotal,
    };
  } catch (err) {
    log('Falha ao extrair XML:', err.message);
    return {
      chave: '',
      cliente: '-',
      cnpj: '-',
      numero: '-',
      emissao: '-',
      valorTotal: null,
    };
  }
}
