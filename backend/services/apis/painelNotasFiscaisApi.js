// ╔═════════════════════════════════════════════════════════════════════════╗
// ║ backend/services/apis/painelNotasFiscaisApi.js                        ║
// ║ Painel NF-e — leitura de XMLs/PDFs locais + filtros + paginação       ║
// ║ CONSART ERP | ESM                                                     ║
// ╚═════════════════════════════════════════════════════════════════════════╝
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

// ───────────────────────────────────────────────────────────────────────────
// Setup ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// /backend/services/apis -> sobe 2 níveis até /backend
const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(BACKEND_DIR, 'public');

const XML_SUBDIR = 'painelNotasFiscais/xmlAntigasBh3';
const PDF_SUBDIR = 'painelNotasFiscais/pdf';

const XML_DIR = path.join(PUBLIC_DIR, XML_SUBDIR);
const PDF_DIR = path.join(PUBLIC_DIR, PDF_SUBDIR);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  trimValues: true,
});

const LOG_ON = String(process.env.NFE_PAINEL_LOG || '0') === '1';
const log = (...args) => {
  if (LOG_ON) console.warn('[painelNotasFiscaisApi]', ...args);
};

// ───────────────────────────────────────────────────────────────────────────
// Utils
function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {}
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function toNumberSafe(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const s = String(value).trim();
  if (!s) return null;

  // aceita "1.234,56" e "1234.56"
  const normalized = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.')
    : s.replace(/[^\d.-]/g, '');

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function normalizeDateForCompare(value) {
  if (!value) return 0;
  const s = String(value).trim();

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return parsed;

  // tenta YYYY-MM-DD HH:mm:ss
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s)) {
    const iso = s.replace(' ', 'T');
    const ts = Date.parse(iso);
    if (!Number.isNaN(ts)) return ts;
  }

  // tenta DD/MM/YYYY HH:mm
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (br) {
    const [, dd, mm, yyyy, hh = '00', mi = '00'] = br;
    const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:00`;
    const ts = Date.parse(iso);
    if (!Number.isNaN(ts)) return ts;
  }

  return 0;
}

function publicXmlUrl(fileName) {
  return `/public/${XML_SUBDIR}/${encodeURIComponent(fileName)}`;
}

function publicPdfUrl(fileName) {
  return `/public/${PDF_SUBDIR}/${encodeURIComponent(fileName)}`;
}

function getNodeValue(...values) {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
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
      cliente: getNodeValue(dest?.xNome, dest?.nome, '-') || '-',
      cnpj: getNodeValue(dest?.CNPJ, dest?.CPF, '-') || '-',
      numero: getNodeValue(ide?.nNF, ide?.numero, '-') || '-',
      emissao: getNodeValue(ide?.dhEmi, ide?.dEmi, '-') || '-',
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

// ───────────────────────────────────────────────────────────────────────────
// XMLs locais
export function listXmlFiles() {
  ensureDir(XML_DIR);
  const files = fs.readdirSync(XML_DIR).filter((f) => f.toLowerCase().endsWith('.xml'));
  return files;
}

export function readXmlItem(fileName) {
  const abs = path.join(XML_DIR, fileName);
  const stat = fs.statSync(abs);
  const xml = fs.readFileSync(abs, 'utf8');
  const meta = extrairCampos(xml);

  return {
    nome: fileName,
    caminho: publicXmlUrl(fileName),
    mtime: stat.mtime.toISOString(),
    mtimeMs: stat.mtimeMs,
    tamanhoBytes: stat.size,
    ...meta,
  };
}

export function listAllXmlItems() {
  const files = listXmlFiles();
  return files.map(readXmlItem);
}

// ───────────────────────────────────────────────────────────────────────────
// PDFs locais
export function listPdfFiles() {
  ensureDir(PDF_DIR);
  const files = fs.readdirSync(PDF_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
  return files.map((nome) => {
    const abs = path.join(PDF_DIR, nome);
    const stat = fs.statSync(abs);

    return {
      nome,
      caminho: publicPdfUrl(nome),
      mtime: stat.mtime.toISOString(),
      mtimeMs: stat.mtimeMs,
      tamanhoBytes: stat.size,
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Filtro
export function filtrarXmlItems(items = [], { filtro = '', campo = 'all' } = {}) {
  const term = String(filtro || '').trim().toLowerCase();
  if (!term) return items;

  return items.filter((item) => {
    const nome = String(item.nome || '').toLowerCase();
    const cliente = String(item.cliente || '').toLowerCase();
    const numero = String(item.numero || '').toLowerCase();
    const cnpj = String(item.cnpj || '').toLowerCase();
    const valor = String(item.valorTotal ?? '').toLowerCase();

    switch (campo) {
      case 'cliente':
        return cliente.includes(term);

      case 'numero':
        return numero.includes(term);

      case 'valor':
        return valor.includes(term);

      case 'all':
      default:
        return (
          nome.includes(term) ||
          cliente.includes(term) ||
          numero.includes(term) ||
          cnpj.includes(term) ||
          valor.includes(term)
        );
    }
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Ordenação
export function ordenarXmlItems(items = [], ordenarPor = 'mtime', sentido = 'desc') {
  const order = String(sentido || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const factor = order === 'asc' ? 1 : -1;

  const list = [...items];

  list.sort((a, b) => {
    let va;
    let vb;

    switch (ordenarPor) {
      case 'nome':
        va = String(a.nome || '').toLowerCase();
        vb = String(b.nome || '').toLowerCase();
        break;

      case 'cliente':
        va = String(a.cliente || '').toLowerCase();
        vb = String(b.cliente || '').toLowerCase();
        break;

      case 'numero':
        va = Number(String(a.numero || '').replace(/\D/g, '')) || 0;
        vb = Number(String(b.numero || '').replace(/\D/g, '')) || 0;
        break;

      case 'emissao':
        va = normalizeDateForCompare(a.emissao);
        vb = normalizeDateForCompare(b.emissao);
        break;

      case 'valor':
        va = toNumberSafe(a.valorTotal) ?? -1;
        vb = toNumberSafe(b.valorTotal) ?? -1;
        break;

      case 'mtime':
      default:
        va = Number(a.mtimeMs || 0);
        vb = Number(b.mtimeMs || 0);
        break;
    }

    if (va < vb) return -1 * factor;
    if (va > vb) return  1 * factor;
    return 0;
  });

  return list;
}

// ───────────────────────────────────────────────────────────────────────────
// Paginação
export function paginate(items = [], page = 1, pageSize = 50) {
  const currentPage = Math.max(1, Number(page) || 1);
  const limit = Math.min(500, Math.max(1, Number(pageSize) || 50));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const offset = (currentPage - 1) * limit;
  const rows = items.slice(offset, offset + limit);

  return {
    total,
    page: currentPage,
    pageSize: limit,
    totalPages,
    itens: rows,
    arquivos: rows,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// API principal XML
export function listNotasXML({
  filtro = '',
  campo = 'all',
  page = 1,
  pageSize = 50,
  ordenarPor = 'mtime',
  sentido = 'desc',
} = {}) {
  let items = listAllXmlItems();
  items = filtrarXmlItems(items, { filtro, campo });
  items = ordenarXmlItems(items, ordenarPor, sentido);
  return paginate(items, page, pageSize);
}

// ───────────────────────────────────────────────────────────────────────────
// API principal PDFs
export function listDanfes({
  page = 1,
  pageSize = 50,
  ordenarPor = 'mtime',
  sentido = 'desc',
} = {}) {
  const files = listPdfFiles();
  const sorted = [...files].sort((a, b) => {
    const factor = String(sentido || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    let va;
    let vb;

    switch (ordenarPor) {
      case 'nome':
        va = String(a.nome || '').toLowerCase();
        vb = String(b.nome || '').toLowerCase();
        break;
      case 'mtime':
      default:
        va = Number(a.mtimeMs || 0);
        vb = Number(b.mtimeMs || 0);
        break;
    }

    if (va < vb) return -1 * factor;
    if (va > vb) return  1 * factor;
    return 0;
  });

  return paginate(sorted, page, pageSize);
}

// ───────────────────────────────────────────────────────────────────────────
// Painel unificado
export function listarPainel({
  tipo = 'both',
  fonte = 'local',
  q = '',
  page = 1,
  pageSize = 50,
  campo = 'all',
  ordenarPor = 'mtime',
  sentido = 'desc',
} = {}) {
  if (fonte !== 'local') {
    throw new Error(`Fonte não suportada no momento: ${fonte}`);
  }

  const tipoNorm = String(tipo || 'both').toLowerCase();

  if (tipoNorm === 'xml' || tipoNorm === 'xmls') {
    return {
      tipo: 'xml',
      fonte: 'local',
      ...listNotasXML({
        filtro: q,
        campo,
        page,
        pageSize,
        ordenarPor,
        sentido,
      }),
    };
  }

  if (tipoNorm === 'pdf' || tipoNorm === 'danfe' || tipoNorm === 'danfes') {
    return {
      tipo: 'pdf',
      fonte: 'local',
      ...listDanfes({
        page,
        pageSize,
        ordenarPor,
        sentido,
      }),
    };
  }

  // both => retorna XMLs como principal e PDFs em bloco extra
  const xmls = listNotasXML({
    filtro: q,
    campo,
    page,
    pageSize,
    ordenarPor,
    sentido,
  });

  const danfes = listDanfes({
    page: 1,
    pageSize: 20,
    ordenarPor: 'mtime',
    sentido: 'desc',
  });

  return {
    tipo: 'both',
    fonte: 'local',
    ...xmls,
    extras: {
      danfes: danfes.itens,
      totalDanfes: danfes.total,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Paths auxiliares
export function getXmlDir() {
  ensureDir(XML_DIR);
  return XML_DIR;
}

export function getPdfDir() {
  ensureDir(PDF_DIR);
  return PDF_DIR;
}

export function publicPathToAbsolute(publicPath = '') {
  if (!publicPath.startsWith('/public/')) return publicPath;
  return path.join(PUBLIC_DIR, publicPath.replace(/^\/public\//, ''));
}

export function isPublicPath(value) {
  return typeof value === 'string' && value.startsWith('/public/');
}

export function getXmlAbsolutePathByPublicPath(publicPath = '') {
  return publicPathToAbsolute(publicPath);
}

export function getPdfAbsolutePathByName(fileName = '') {
  return path.join(PDF_DIR, path.basename(String(fileName || '')));
}

export function existsXmlByPublicPath(publicPath = '') {
  return fileExists(getXmlAbsolutePathByPublicPath(publicPath));
}

export default {
  extrairCampos,
  listXmlFiles,
  readXmlItem,
  listAllXmlItems,
  listPdfFiles,
  filtrarXmlItems,
  ordenarXmlItems,
  paginate,
  listNotasXML,
  listDanfes,
  listarPainel,
  getXmlDir,
  getPdfDir,
  isPublicPath,
  publicPathToAbsolute,
  getXmlAbsolutePathByPublicPath,
  getPdfAbsolutePathByName,
  existsXmlByPublicPath,
};