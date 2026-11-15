// ╔══════════════════════════════════════════════════════════════════════╗
// ║ painelNotasFiscaisQuery.repository.js — filtro, ordenação, paginação ║
// ║ listNotasXML / listDanfes / listarPainel                             ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { toNumberSafe, normalizeDateForCompare } from './painelNotasFiscais.utils.js';
import { listAllXmlItems, listPdfFiles } from './painelNotasFiscaisFiles.repository.js';

// ───────────────────────────────────────────────────────────────────────────
// Filtro
// Texto sem acento e em minúsculas (busca "joao" acha "JOÃO")
function semAcento(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const digitos = (value) => String(value ?? '').replace(/\D/g, '');

// Valor digitado em pt-BR ("1.625,71", "R$ 1625,71", "1625.71") → número
function valorDigitado(term) {
  const limpo = String(term || '').replace(/[^\d.,-]/g, '');
  if (!limpo) return null;
  return toNumberSafe(limpo);
}

// "2023-12-05T15:59:00-03:00" / "2023-12-05" → "2023-12-05"
function dataEmissaoIso(value) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? '').trim());
  return m ? m[1] : '';
}

function bateValor(item, term) {
  const alvo = valorDigitado(term);
  const valor = toNumberSafe(item.valorTotal);
  if (alvo === null || valor === null) return false;

  // Com centavos digitados ("1625,71"): valor exato; sem ("1625"): parte inteira
  const temCentavos = /[.,]\d{1,2}$/.test(String(term).trim());
  return temCentavos
    ? Math.abs(valor - alvo) < 0.005
    : Math.trunc(valor) === Math.trunc(alvo);
}

function bateNumero(item, term) {
  const alvo = digitos(term).replace(/^0+/, '');
  if (!alvo) return false;
  return digitos(item.numero).replace(/^0+/, '').includes(alvo);
}

function bateDocumento(item, term) {
  const alvo = digitos(term);
  return !!alvo && digitos(item.cnpj).includes(alvo);
}

function bateArquivo(item, term) {
  const alvo = semAcento(term);
  const alvoDigitos = digitos(term);
  return semAcento(item.nome).includes(alvo) ||
    (alvoDigitos.length >= 4 && String(item.chave || '').includes(alvoDigitos));
}

export function filtrarXmlItems(items = [], {
  filtro = '',
  campo = 'all',
  dataDe = '',
  dataAte = '',
} = {}) {
  const term = String(filtro || '').trim();
  const de = dataEmissaoIso(dataDe);
  const ate = dataEmissaoIso(dataAte);

  if (!term && !de && !ate) return items;

  const termTexto = semAcento(term);

  return items.filter((item) => {
    if (de || ate) {
      const emissao = dataEmissaoIso(item.emissao);
      if (!emissao) return false;
      if (de && emissao < de) return false;
      if (ate && emissao > ate) return false;
    }

    if (!term) return true;

    switch (campo) {
      case 'cliente':
        return semAcento(item.cliente).includes(termTexto);

      case 'cnpj':
        return bateDocumento(item, term);

      case 'numero':
        return bateNumero(item, term);

      case 'valor':
        return bateValor(item, term);

      case 'arquivo':
        return bateArquivo(item, term);

      case 'all':
      default:
        return (
          semAcento(item.cliente).includes(termTexto) ||
          bateArquivo(item, term) ||
          bateNumero(item, term) ||
          (digitos(term).length >= 3 && bateDocumento(item, term)) ||
          (/\d[.,]\d{1,2}$/.test(term) && bateValor(item, term))
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
        va = semAcento(a.cliente);
        vb = semAcento(b.cliente);
        break;

      case 'cnpj':
        va = digitos(a.cnpj);
        vb = digitos(b.cnpj);
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

    // Empate (ex.: mesmo cliente): mantém as notas na ordem do número
    const na = Number(digitos(a.numero)) || 0;
    const nb = Number(digitos(b.numero)) || 0;
    return (na - nb) * factor;
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
  dataDe = '',
  dataAte = '',
  page = 1,
  pageSize = 50,
  ordenarPor = 'mtime',
  sentido = 'desc',
} = {}) {
  let items = listAllXmlItems();
  items = filtrarXmlItems(items, { filtro, campo, dataDe, dataAte });
  items = ordenarXmlItems(items, ordenarPor, sentido);

  // Soma do valor das notas filtradas (todas as páginas)
  const valorTotalFiltrado = items.reduce(
    (acc, item) => acc + (toNumberSafe(item.valorTotal) || 0),
    0,
  );

  return {
    ...paginate(items, page, pageSize),
    valorTotalFiltrado: Math.round(valorTotalFiltrado * 100) / 100,
  };
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
