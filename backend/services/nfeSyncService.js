// ╔══════════════════════════════════════════════════════════════╗
// ║ nfeSyncService.js — Sincroniza dados da NF-e na tabela orders║
// ║ Atualiza: status, chave, protocolo, xml, pdf, ambiente       ║
// ╚══════════════════════════════════════════════════════════════╝

import pool from '../config/db.js';
import tecnospeedNfeApi from './tecnoSpeedNfeApi.js';

// Mapeia status + cStat da PlugNotas para o seu nfe_status interno
function mapPlugNotasStatus(status, cStat) {
  if (cStat === 100) return 'AUTORIZADA';
  if (cStat === 101 || cStat === 135) return 'CANCELADA';
  if (status === 'REJEITADO') return 'REJEITADA';
  if (status === 'PROCESSANDO') return 'EM_PROCESSAMENTO';
  return 'DESCONHECIDO';
}

/**
 * Sincroniza dados de NF-e de uma ordem usando PlugNotas
 * @param {number} orderId - order_id da tabela public.orders
 */
export async function syncOrderNfeFromPlugNotas(orderId) {
  // 1) Buscar ordem
  const { rows } = await pool.query(
    `
      SELECT order_id,
             number,
             nfe_plugnotas_id
        FROM public.orders
       WHERE order_id = $1
    `,
    [orderId]
  );

  if (!rows.length) {
    throw new Error(`Pedido com order_id=${orderId} não encontrado.`);
  }

  const order = rows[0];

  if (!order.nfe_plugnotas_id && !order.number) {
    throw new Error(
      `Ordem ${orderId} não possui nfe_plugnotas_id nem number para montar o idIntegracao.`
    );
  }

  // 2) Consultar na PlugNotas
  //    ⚠️ Adapte o método conforme a sua tecnospeedNfeApi.js
  //    Exemplo genérico:
  const resumo = await tecnospeedNfeApi.consultarNFe({
    id: order.nfe_plugnotas_id || undefined,
    idIntegracao: `ORD-${order.number}`
  });

  const r = Array.isArray(resumo) ? resumo[0] : resumo;

  if (!r) {
    throw new Error(
      `Nenhum resumo retornado na PlugNotas para order_id=${orderId} (plugnotas_id=${order.nfe_plugnotas_id})`
    );
  }

  const novoStatus = mapPlugNotasStatus(r.status, r.cStat);
  const ambiente = (process.env.NFE_AMBIENTE || 'producao').toUpperCase();

  // 3) Atualizar linha na orders
  await pool.query(
    `
      UPDATE public.orders
         SET nfe_status      = $1,
             nfe_key         = $2,
             nfe_number      = $3,
             nfe_protocol    = $4,
             nfe_xml_url     = $5,
             nfe_danfe_url   = $6,
             nfe_environment = $7,
             updated_at      = now()
       WHERE order_id        = $8
    `,
    [
      novoStatus,
      r.chave,
      r.numero,
      r.protocolo,
      r.xml,
      r.pdf,
      ambiente,
      orderId
    ]
  );

  return {
    order_id: orderId,
    nfe_status: novoStatus,
    nfe_key: r.chave,
    nfe_number: r.numero,
    nfe_protocol: r.protocolo,
    nfe_xml_url: r.xml,
    nfe_danfe_url: r.pdf,
    nfe_environment: ambiente
  };
}
