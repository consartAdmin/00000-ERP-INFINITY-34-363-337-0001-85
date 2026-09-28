// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfesPlugNotas.repository.js — tryListFromPlugNotas (paginação real)  ║
// ║ Fonte: TecnoSpeed/PlugNotas via tecnoSpeedNfeApi.listarNFe           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import tecnoSpeedApi from '../../services/apis/tecnoSpeedNfeApi.js';
import { LIST_DEBUG } from './nfes.constants.js';
import { mapPlugNotasToNfe } from './nfes.mappers.js';

/* =====================
 * 1) TENTATIVA PLUGNOTAS (com paginação real)
 * ===================== */
export async function tryListFromPlugNotas({ q, limit, offset }) {
  const pageSize = Math.max(1, Number(limit) || 20);

  // TecnoSpeed/PlugNotas geralmente é 1-based
  let page = Math.max(1, Math.floor((Number(offset) || 0) / pageSize) + 1);

  // Vamos acumular até preencher "limit" (ou acabar)
  const target = pageSize;
  let collected = [];
  let total = 0;

  // Segurança anti-loop
  let safety = 0;

  while (collected.length < target && safety < 10) {
    safety++;

    const resp = await tecnoSpeedApi.listarNFe({ page, pageSize, q });

    if (!resp?.ok) {
      if (LIST_DEBUG) {
        console.error('[NFES] tryListFromPlugNotas falhou:', resp?.status, resp?.error);
      }
      return {
        ok: false,
        status: resp?.status || 500,
        error: resp?.error,
        meta: resp?.meta,
      };
    }

    // Total vindo da API (se existir)
    total = Number(resp?.total || resp?.data?.total || total || 0);

    // Pega itens em qualquer formato
    let rawItems = [];
    if (Array.isArray(resp.data?.itens)) rawItems = resp.data.itens;
    else if (Array.isArray(resp.data)) rawItems = resp.data;
    else if (Array.isArray(resp.data?.docs)) rawItems = resp.data.docs;
    else if (Array.isArray(resp.data?.items)) rawItems = resp.data.items;

    if (LIST_DEBUG) {
      console.log('[NFES] PlugNotas page', page, 'pageSize', pageSize, 'items', rawItems.length, 'total', total);
    }

    // Se não veio nada, acabou.
    if (!rawItems.length) break;

    collected = collected.concat(rawItems);

    // Se já retornou tudo que tinha, para
    if (total && collected.length >= total) break;

    // Próxima página
    page++;
  }

  const rows = collected.map(mapPlugNotasToNfe).filter(Boolean);

  // Se a API não forneceu total, usa o que coletou
  const finalTotal = total || rows.length;

  // Respeita "limit" da página atual (offset já foi tratado via page)
  const pageRows = rows.slice(0, pageSize);

  return { ok: true, rows: pageRows, total: finalTotal };
}
