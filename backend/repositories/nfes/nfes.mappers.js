// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfes.mappers.js — PlugNotas / linha do banco → NF-e da tela          ║
// ╚══════════════════════════════════════════════════════════════════════╝

import tecnoSpeedApi from '../tecnoSpeedNfe/tecnoSpeedNfe.index.js';
import { findDeepValue } from './nfes.utils.js';

/* =====================================================================
 * 🔎 Helper: mapeia status PlugNotas/Tecno → status interno NF-e
 * ===================================================================== */
export function mapPlugNotasStatus(statusRaw, cStatRaw) {
  const cStat = cStatRaw != null ? String(cStatRaw) : null;
  const s = (statusRaw || '').toString().toUpperCase();

  if (cStat === '100') return 'AUTORIZADA';
  if (cStat === '101' || cStat === '135') return 'CANCELADA';

  if (s.includes('REJEIT')) return 'REJEITADA';
  if (s.includes('PROCESS') || s.includes('PENDENTE')) return 'EM_PROCESSAMENTO';

  return s || 'DESCONHECIDO';
}

/* =====================================================================
 * 🔎 Mapeia objeto da PlugNotas → formato NF-e da tela
 * ===================================================================== */
export function mapPlugNotasToNfe(n) {
  if (!n) return null;

  const dest = n?.destinatario || n?.cliente || n?.tomador || {};
  const totalRaw = n?.valor?.total ?? n?.valor?.vNF ?? n?.total ?? n?.valorNfe ?? 0;

  const chave =
    n?.chaveAcesso ??
    n?.chave_acesso ??
    n?.chave ??
    n?.chaveNfe ??
    n?.chaveNFe ??
    n?.chaveNFE ??
    null;

  const statusRaw =
    n?.status ??
    n?.situacao ??
    n?.situacaoNfe ??
    n?.descricaoSituacao ??
    n?.descricaoStatus ??
    null;

  const cStatRaw =
    n?.cStat ??
    n?.cstat ??
    n?.statusSefaz ??
    n?.codStatus ??
    findDeepValue(n, ['cStat', 'cstat', 'statusSefaz', 'codStatus', 'codigoStatus']);

  const messageRaw =
    n?.mensagem ??
    n?.message ??
    n?.xMotivo ??
    n?.motivo ??
    n?.erro ??
    n?.error ??
    findDeepValue(n, [
      'mensagem', 'message', 'xMotivo', 'motivo', 'erro', 'error',
      'descricaoStatus', 'descricaoSituacao',
    ]);

  const statusNorm = mapPlugNotasStatus(statusRaw, cStatRaw);

  const tpAmbRaw = n?.tpAmb ?? n?.tipoAmbiente ?? null;
  let ambiente = n?.ambiente || n?.environment || null;

  if (!ambiente && tpAmbRaw != null) {
    const v = String(tpAmbRaw);
    ambiente = v === '1' ? 'PRODUCAO' : 'HOMOLOGACAO';
  }

  if (!ambiente && typeof tecnoSpeedApi.getEffectiveConfig === 'function') {
    try {
      const eff = tecnoSpeedApi.getEffectiveConfig();
      if (eff?.ambiente) ambiente = eff.ambiente;
    } catch {
      // ignora
    }
  }

  const numeroRaw =
    n?.nfe_number ??
    n?.nfeNumero ??
    n?.numeroNfe ??
    n?.numero ??
    n?.numNfe ??
    null;

  let numero = null;
  if (numeroRaw != null && numeroRaw !== '') {
    const nn = Number(numeroRaw);
    numero = Number.isFinite(nn) ? nn : numeroRaw;
  }

  const xmlUrl = n?.xml ?? n?.linkXml ?? n?.xmlUrl ?? n?.urlXml ?? null;
  const pdfUrl = n?.pdf ?? n?.linkDanfe ?? n?.linkPdf ?? n?.urlDanfe ?? null;

  // ⚠️ referencia.numeroPedido costuma ser o "número do pedido", não necessariamente order_id
  const pedidoRef = n?.referencia?.numeroPedido || null;

  return {
    order_id: pedidoRef,
    order_number: pedidoRef,
    issue_date: n?.dataEmissao || n?.createdAt || null,

    customer_name: dest?.razaoSocial || dest?.nome || '-',
    customer_tax_id: dest?.cpfCnpj || dest?.documento || '-',

    customer_email:
      dest?.email ||
      dest?.emailDestinatario ||
      n?.email ||
      null,

    nfe_status: statusNorm,
    nfe_cstat: cStatRaw != null ? String(cStatRaw) : null,
    nfe_message: messageRaw != null ? String(messageRaw) : null,
    nfe_key: chave,
    nfe_number: numero,
    nfe_protocol: n?.protocolo ?? n?.protocoloAutorizacao ?? null,

    nfe_xml_url: xmlUrl,
    nfe_danfe_url: pdfUrl,
    nfe_environment: ambiente || 'N/D',
    nfe_plugnotas_id: n?.id || n?._id || n?.documentId || null,

    items_count: Array.isArray(n?.itens) ? n.itens.length : 0,
    total_amount: Number(totalRaw) || 0,
  };
}

/* ============================
 * 2) FALLBACK: BANCO + /RESUMO
 * ============================ */
export function rowDbToNfe(row) {
  return {
    order_id: row.order_id,
    order_number: row.order_number,
    issue_date: row.nfe_issue_at || row.issue_date,
    customer_name: row.customer_name,
    customer_tax_id: row.customer_tax_id,
    customer_email: row.customer_email || null,

    nfe_status: row.nfe_status || 'DESCONHECIDO',
    nfe_cstat: row.nfe_cstat || null,
    nfe_message: row.nfe_message || null,
    nfe_key: row.nfe_key,
    nfe_number: row.nfe_number,
    nfe_protocol: row.nfe_protocol,
    nfe_xml_url: row.nfe_xml_url,
    nfe_danfe_url: row.nfe_danfe_url,
    nfe_environment: row.nfe_environment || 'N/D',
    nfe_plugnotas_id: row.nfe_plugnotas_id,
    items_count: Number(row.items_count || 0),
    total_amount: Number(row.total_amount || 0),
  };
}
