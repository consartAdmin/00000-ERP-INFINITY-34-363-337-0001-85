// ╔════════════════════════════════════════════════════════════════════╗
// ║ pdvSalesApi.js — Warehouse PDV Sales API (CONSART ERP | ESM)      ║
// ║ Tabelas:                                                          ║
// ║   public."pdvSales"                                               ║
// ║                                                                    ║
// ║ Este módulo NÃO cria pool: você deve passar pgPool em cada call.  ║
// ╚════════════════════════════════════════════════════════════════════╝

import { PDV_SALES_TABLE } from '../../catalog/schema_catalog.pdvSales.js';

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

function mapRowToSale(row) {
  if (!row) return null;
  return {
    saleId: row.sale_id,
    status: row.status,
    terminalId: row.terminal_id,
    operatorId: row.operator_id,
    customerName: row.customer_name,
    customerTaxId: row.customer_tax_id,
    recebido: row.recebido,
    troco: row.troco,
    pagamento: row.pagamento,
    pagamentosJson: row.pagamentos_json,
    idIntegracao: row.id_integracao,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nfceStatus: row.nfce_status,
    nfceId: row.nfce_id,
    nfceKey: row.nfce_key,
    nfceNumber: row.nfce_number,
    nfceProtocol: row.nfce_protocol,
    nfceEnvironment: row.nfce_environment,
    nfcePdfUrl: row.nfce_pdf_url,
    nfceXmlUrl: row.nfce_xml_url,
    nfceIntegrationId: row.nfce_integration_id
  };
}

/* ------------------------------------------------------------------------- */
/* Basic fetchers                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Busca uma venda PDV pelo sale_id.
 */
export async function getSaleById(pgPool, saleId) {
  const client = await pgPool.connect();
  try {
    const { rows } = await client.query(
      `
      SELECT *
      FROM ${PDV_SALES_TABLE}
      WHERE sale_id = $1
    `,
      [saleId]
    );

    return rows[0] ? mapRowToSale(rows[0]) : null;
  } finally {
    client.release();
  }
}

/**
 * Alias comum: getById (para quem preferir)
 */
export async function getById(pgPool, saleId) {
  return getSaleById(pgPool, saleId);
}

/**
 * Busca uma venda PDV pelo id_integracao (muito usado para NFC-e).
 */
export async function getSaleByIntegrationId(pgPool, idIntegracao) {
  const client = await pgPool.connect();
  try {
    const { rows } = await client.query(
      `
      SELECT *
      FROM ${PDV_SALES_TABLE}
      WHERE id_integracao = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
      [idIntegracao]
    );

    return rows[0] ? mapRowToSale(rows[0]) : null;
  } finally {
    client.release();
  }
}

/**
 * Alias comum: getByIdIntegracao (para uso em controladores antigos)
 */
export async function getByIdIntegracao(pgPool, idIntegracao) {
  return getSaleByIntegrationId(pgPool, idIntegracao);
}

/**
 * Função específica para o fluxo de NFC-e:
 * carrega somente o cabeçalho da venda que será usado para montar o JSON.
 */
export async function getSaleForNfce(pgPool, { saleId, idIntegracao } = {}) {
  if (!saleId && !idIntegracao) {
    throw new Error(
      '[pdvSalesApi.getSaleForNfce] É necessário informar saleId ou idIntegracao.'
    );
  }

  if (saleId) {
    return getSaleById(pgPool, saleId);
  }

  return getSaleByIntegrationId(pgPool, idIntegracao);
}

/* ------------------------------------------------------------------------- */
/* Listagem / relatórios                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Lista vendas PDV em um intervalo de datas (para relatórios).
 * - startDate / endDate: Date ou string ISO.
 * - filters: { status, nfceStatus, terminalId, operatorId, minValor, maxValor }
 */
export async function listSalesBetweenDates(
  pgPool,
  { startDate, endDate, filters = {} } = {}
) {
  const client = await pgPool.connect();
  try {
    const where = [];
    const params = [];
    let idx = 1;

    if (startDate) {
      where.push(`"created_at" >= $${idx++}`);
      params.push(
        startDate instanceof Date ? startDate.toISOString() : String(startDate)
      );
    }

    if (endDate) {
      where.push(`"created_at" <= $${idx++}`);
      params.push(
        endDate instanceof Date ? endDate.toISOString() : String(endDate)
      );
    }

    if (filters.status) {
      where.push(`"status" = $${idx++}`);
      params.push(filters.status);
    }

    if (filters.nfceStatus) {
      where.push(`"nfce_status" = $${idx++}`);
      params.push(filters.nfceStatus);
    }

    if (filters.terminalId) {
      where.push(`"terminal_id" = $${idx++}`);
      params.push(filters.terminalId);
    }

    if (filters.operatorId) {
      where.push(`"operator_id" = $${idx++}`);
      params.push(filters.operatorId);
    }

    if (filters.minValor != null) {
      where.push(`"recebido" >= $${idx++}`);
      params.push(filters.minValor);
    }

    if (filters.maxValor != null) {
      where.push(`"recebido" <= $${idx++}`);
      params.push(filters.maxValor);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const sql = `
      SELECT *
      FROM ${PDV_SALES_TABLE}
      ${whereSql}
      ORDER BY created_at ASC, sale_id ASC
    `;

    const { rows } = await client.query(sql, params);
    return rows.map(mapRowToSale);
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------------- */
/* Insert / Update                                                           */
/* ------------------------------------------------------------------------- */

/**
 * Cria um novo cabeçalho de venda PDV.
 * params = {
 *   status, terminalId, operatorId, customerName, customerTaxId,
 *   recebido, troco, pagamento, pagamentosJson, idIntegracao
 * }
 */
export async function createSale(pgPool, params = {}) {
  const client = await pgPool.connect();
  try {
    const {
      status = 'ABERTA',
      terminalId = null,
      operatorId = null,
      customerName = null,
      customerTaxId = null,
      recebido = 0,
      troco = 0,
      pagamento = null,
      pagamentosJson = null,
      idIntegracao = null
    } = params;

    const { rows } = await client.query(
      `
      INSERT INTO ${PDV_SALES_TABLE} (
        status,
        terminal_id,
        operator_id,
        customer_name,
        customer_tax_id,
        recebido,
        troco,
        pagamento,
        pagamentos_json,
        id_integracao,
        created_at,
        updated_at,
        nfce_status
      )
      VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,
        NOW(), NOW(),
        'PENDENTE'
      )
      RETURNING *
    `,
      [
        status,
        terminalId,
        operatorId,
        customerName,
        customerTaxId,
        recebido,
        troco,
        pagamento,
        pagamentosJson,
        idIntegracao
      ]
    );

    return mapRowToSale(rows[0]);
  } finally {
    client.release();
  }
}

/**
 * Atualiza apenas o status interno da venda (ABERTA / FECHADA / CANCELADA).
 */
export async function updateSaleStatus(pgPool, saleId, status) {
  const client = await pgPool.connect();
  try {
    const { rows } = await client.query(
      `
      UPDATE ${PDV_SALES_TABLE}
      SET status = $2,
          updated_at = NOW()
      WHERE sale_id = $1
      RETURNING *
    `,
      [saleId, status]
    );

    return rows[0] ? mapRowToSale(rows[0]) : null;
  } finally {
    client.release();
  }
}

/**
 * Atualiza os campos da NFC-e para uma venda (status, chave, número, urls, etc.).
 * params = {
 *   saleId, nfceStatus, nfceId, nfceKey, nfceNumber,
 *   nfceProtocol, nfceEnvironment, nfcePdfUrl, nfceXmlUrl, nfceIntegrationId
 * }
 */
export async function updateNfceInfo(pgPool, params = {}) {
  const {
    saleId,
    nfceStatus,
    nfceId,
    nfceKey,
    nfceNumber,
    nfceProtocol,
    nfceEnvironment,
    nfcePdfUrl,
    nfceXmlUrl,
    nfceIntegrationId
  } = params;

  if (!saleId) {
    throw new Error('[pdvSalesApi.updateNfceInfo] saleId é obrigatório.');
  }

  const client = await pgPool.connect();
  try {
    const { rows } = await client.query(
      `
      UPDATE ${PDV_SALES_TABLE}
      SET
        nfce_status        = COALESCE($2, nfce_status),
        nfce_id            = COALESCE($3, nfce_id),
        nfce_key           = COALESCE($4, nfce_key),
        nfce_number        = COALESCE($5, nfce_number),
        nfce_protocol      = COALESCE($6, nfce_protocol),
        nfce_environment   = COALESCE($7, nfce_environment),
        nfce_pdf_url       = COALESCE($8, nfce_pdf_url),
        nfce_xml_url       = COALESCE($9, nfce_xml_url),
        nfce_integration_id= COALESCE($10, nfce_integration_id),
        updated_at         = NOW()
      WHERE sale_id = $1
      RETURNING *
    `,
      [
        saleId,
        nfceStatus,
        nfceId,
        nfceKey,
        nfceNumber,
        nfceProtocol,
        nfceEnvironment,
        nfcePdfUrl,
        nfceXmlUrl,
        nfceIntegrationId
      ]
    );

    return rows[0] ? mapRowToSale(rows[0]) : null;
  } finally {
    client.release();
  }
}

/**
 * Helper para marcar uma venda como AUTORIZADA na NFC-e.
 */
export async function markNfceAuthorized(
  pgPool,
  saleId,
  {
    nfceId,
    nfceKey,
    nfceNumber,
    nfceProtocol,
    nfceEnvironment,
    nfcePdfUrl,
    nfceXmlUrl,
    nfceIntegrationId
  } = {}
) {
  return updateNfceInfo(pgPool, {
    saleId,
    nfceStatus: 'AUTORIZADA',
    nfceId,
    nfceKey,
    nfceNumber,
    nfceProtocol,
    nfceEnvironment,
    nfcePdfUrl,
    nfceXmlUrl,
    nfceIntegrationId
  });
}

/**
 * Helper para marcar uma venda como REJEITADA e guardar o status.
 * Você pode expandir depois para salvar código/motivo da rejeição
 * em outra tabela de logs.
 */
export async function markNfceRejected(pgPool, saleId, { nfceProtocol } = {}) {
  return updateNfceInfo(pgPool, {
    saleId,
    nfceStatus: 'REJEITADA',
    nfceProtocol
  });
}

/* ------------------------------------------------------------------------- */
/* Export default (opcional, estilo "namespace")                             */
/* ------------------------------------------------------------------------- */

const pdvSalesApi = {
  getSaleById,
  getById,
  getSaleByIntegrationId,
  getByIdIntegracao,
  getSaleForNfce,
  listSalesBetweenDates,
  createSale,
  updateSaleStatus,
  updateNfceInfo,
  markNfceAuthorized,
  markNfceRejected
};

export default pdvSalesApi;
