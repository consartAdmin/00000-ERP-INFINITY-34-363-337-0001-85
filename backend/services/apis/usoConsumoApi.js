// ╔══════════════════════════════════════════════════════════════════════╗
// ║ usoConsumoApi.js — Service/DAL Uso e Consumo                        ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

import { generateDanfeFromXml } from '../danfeConsartService.js';

import {
  emitirNFeUsoConsumo,
  consultarNFe,
} from './tecnoSpeedNfeApi.js';

const TB_USO = 'public."usoConsumo"';
const TB_USO_ITEMS = 'public."usoConsumoItems"';

function safeText(value) {
  return String(value ?? '').trim();
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function list({ q = '', limit = 50, offset = 0 } = {}) {
  const params = [];
  let where = 'WHERE 1=1';

  if (q) {
    params.push(`%${q}%`);

    where += ` AND (
      uc.number ILIKE $${params.length}
      OR uc.department ILIKE $${params.length}
      OR uc.responsible ILIKE $${params.length}
      OR uc.reason ILIKE $${params.length}
      OR COALESCE(ii.nfe_number::text, '') ILIKE $${params.length}
      OR COALESCE(ii.nfe_key, '') ILIKE $${params.length}
    )`;
  }

  params.push(limit);
  const limitParam = params.length;

  params.push(offset);
  const offsetParam = params.length;

  const sql = `
    SELECT
      uc.*,
      ii.nfe_number,
      ii.nfe_key,
      ii.nfe_status,
      ii.nfe_protocol,
      ii.nfe_environment,
      ii.xml_url,
      ii.danfe_url,
      ii.issued_at,
      ii.issued_date
    FROM ${TB_USO} uc
    LEFT JOIN public."invoicesIssued" ii
      ON ii.invoice_id = uc.invoice_id
    ${where}
    ORDER BY uc.created_at DESC, uc.uso_consumo_id DESC
    LIMIT $${limitParam}
    OFFSET $${offsetParam}
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function getById(id) {
  const usoId = Number(id);

  if (!usoId) {
    throw new Error('uso_consumo_id inválido.');
  }

  const headerSql = `
    SELECT
      uc.*,
      ii.nfe_number,
      ii.nfe_key,
      ii.nfe_status,
      ii.nfe_protocol,
      ii.nfe_environment,
      ii.xml_url,
      ii.danfe_url,
      ii.issued_at,
      ii.issued_date
    FROM ${TB_USO} uc
    LEFT JOIN public."invoicesIssued" ii
      ON ii.invoice_id = uc.invoice_id
    WHERE uc.uso_consumo_id = $1
  `;

  const itemsSql = `
    SELECT *
    FROM ${TB_USO_ITEMS}
    WHERE uso_consumo_id = $1
    ORDER BY uso_consumo_item_id ASC
  `;

  const [headerResult, itemsResult] = await Promise.all([
    pool.query(headerSql, [usoId]),
    pool.query(itemsSql, [usoId]),
  ]);

  return {
    header: headerResult.rows[0] || null,
    items: itemsResult.rows,
  };
}

export async function emitNfe(usoConsumoId) {
  const id = Number(usoConsumoId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('uso_consumo_id inválido.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /*
     * Impede dois cliques simultâneos de emitirem duas NF-e para
     * o mesmo registro.
     */
    await client.query(
      `SELECT pg_advisory_xact_lock($1::bigint)`,
      [id]
    );

    const existingResult = await client.query(
      `
        SELECT
          uc.uso_consumo_id,
          uc.status,
          uc.invoice_id,
          ii.nfe_number,
          ii.nfe_key,
          ii.nfe_status,
          ii.nfe_provider_id
        FROM public."usoConsumo" uc
        LEFT JOIN public."invoicesIssued" ii
          ON ii.invoice_id = uc.invoice_id
        WHERE uc.uso_consumo_id = $1
        LIMIT 1
      `,
      [id]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      throw new Error(
        `Registro de Uso e Consumo ${id} não encontrado.`
      );
    }

    if (existing.invoice_id) {
      throw new Error(
        `Este Uso e Consumo já possui uma NF-e vinculada. ` +
        `NF-e: ${existing.nfe_number || 'em processamento'}; ` +
        `status: ${existing.nfe_status || 'PROCESSANDO'}.`
      );
    }

    if (String(existing.status || '').toUpperCase() !== 'FINALIZADO') {
      throw new Error(
        'Somente registros finalizados podem emitir NF-e.'
      );
    }

    /*
     * Envia para a PlugNotas.
     *
     * A função utiliza um idIntegracao estável:
     * USOCONSUMO-{uso_consumo_id}
     *
     * Portanto, se a PlugNotas tiver recebido anteriormente, uma nova
     * tentativa poderá recuperar o documento já existente.
     */
    const emission = await emitirNFeUsoConsumo(id);

    if (!emission?.ok) {
      throw new Error(
        emission?.message ||
        'A PlugNotas não aceitou a emissão da NF-e.'
      );
    }

    const providerId = String(
      emission.plugnotas_id || ''
    ).trim();

    if (!providerId) {
      throw new Error(
        'A PlugNotas aceitou a solicitação, mas não retornou o ID do documento.'
      );
    }

    const nfeNumber = Number(emission.nfe_number);
    const totalAmount = Number(emission.total_amount || 0);
    const environment = String(
      emission.nfe_environment || process.env.NFE_AMBIENTE || 'homologacao'
    ).trim();

    if (!Number.isInteger(nfeNumber) || nfeNumber <= 0) {
      throw new Error(
        'A emissão não retornou um número de NF-e válido.'
      );
    }

    /*
     * Cria o registro local da NF-e.
     *
     * order_id permanece NULL porque a origem é usoConsumo,
     * e não a tabela orders.
     */
    const invoiceResult = await client.query(
      `
        INSERT INTO public."invoicesIssued" (
          order_id,
          nfe_number,
          nfe_key,
          nfe_status,
          nfe_protocol,
          nfe_environment,
          xml_url,
          danfe_url,
          issued_at,
          issued_date,
          total_amount,
          nfe_provider_id,
          created_at,
          updated_at
        )
        VALUES (
          NULL,
          $1,
          NULL,
          'PROCESSANDO',
          NULL,
          $2,
          NULL,
          NULL,
          NULL,
          NULL,
          $3,
          $4,
          NOW(),
          NOW()
        )
        RETURNING *
      `,
      [
        nfeNumber,
        environment,
        totalAmount,
        providerId,
      ]
    );

    const invoice = invoiceResult.rows[0];

    /*
     * Vincula definitivamente a NF-e ao Uso e Consumo.
     */
    const updateResult = await client.query(
      `
        UPDATE public."usoConsumo"
        SET invoice_id = $1,
            updated_at = NOW()
        WHERE uso_consumo_id = $2
          AND invoice_id IS NULL
        RETURNING *
      `,
      [
        invoice.invoice_id,
        id,
      ]
    );

    if (!updateResult.rowCount) {
      throw new Error(
        'Não foi possível vincular a NF-e ao registro de Uso e Consumo.'
      );
    }

    await client.query('COMMIT');

    return {
      uso_consumo: updateResult.rows[0],
      invoice,
      plugnotas: {
        id: providerId,
        status: 'PROCESSANDO',
        environment,
      },
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(
        '[usoConsumoApi][emitNfe][ROLLBACK_ERROR]',
        rollbackError
      );
    }

    console.error(
      '[usoConsumoApi][emitNfe][ERROR]',
      error
    );

    throw error;
  } finally {
    client.release();
  }
}

export async function finishBudgetAsUsoConsumo(budgetId, payload = {}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const id = Number(budgetId);
    if (!id) throw new Error('budgetId inválido.');

    const department = safeText(payload.department);
    const responsible = safeText(payload.responsible);
    const reason = safeText(payload.reason);
    const cfop = safeText(payload.cfop || '5.949');

    if (!department) throw new Error('Departamento é obrigatório.');
    if (!responsible) throw new Error('Responsável é obrigatório.');
    if (!reason) throw new Error('Motivo é obrigatório.');
    if (!cfop) throw new Error('CFOP é obrigatório.');

    const budgetSql = `
  SELECT *
  FROM public.budgets
  WHERE budget_id = $1
  LIMIT 1
`;

    const budgetResult = await client.query(budgetSql, [id]);
    const budget = budgetResult.rows[0];

    if (!budget) {
      throw new Error(`Orçamento ${id} não encontrado.`);
    }

    const budgetRealId = Number(budget.budget_id);

    /*
     * Itens vindos de budgetsItems (tabela ATUAL). Antes lia a legada
     * "budgetItens", congelada no orçamento 160 — qualquer orçamento novo
     * caía em "Este orçamento não possui itens". Verificado no schema
     * em 16/09/2026.
     *
     * Dois cuidados na migração:
     *  - a coluna de SKU passou a ser product_code (era sku);
     *  - a unidade passou a ser unit_code (era unit), então vai aliasada
     *    para não quebrar o `item.unit` lido mais abaixo;
     *  - p.product_code foi removido do SELECT: com bi.* ele colidiria pelo
     *    mesmo nome e um produto ausente em products sobrescreveria o código
     *    do item com NULL.
     */
    const itemsSql = `
  SELECT
    bi.*,
    bi.unit_code AS unit,
    p.description AS product_description,
    p.cost_price,
    fc.ncm_code AS ncm,
    fp.icms_cst AS cst_icms
  FROM public."budgetsItems" bi
  LEFT JOIN public.products p
    ON p.product_code::text = bi.product_code::text
  LEFT JOIN public."productsFiscalV2" pf
    ON pf.product_code::text = bi.product_code::text
   AND pf.is_current = TRUE
   AND pf.is_active = TRUE
  LEFT JOIN public."fiscalClassificationV2" fc
    ON fc.fiscal_classification_id = pf.fiscal_classification_id
   AND fc.is_active = TRUE
  LEFT JOIN public."fiscalProfileV2" fp
    ON fp.fiscal_profile_id = fc.fiscal_profile_id
   AND fp.is_active = TRUE
  WHERE bi.budget_id = $1
  ORDER BY bi.budget_item_id ASC
`;

    const itemsResult = await client.query(itemsSql, [budgetRealId]);
    const items = itemsResult.rows;

    if (!items.length) {
      throw new Error('Este orçamento não possui itens.');
    }

    const totalAmount = items.reduce((acc, item) => {
      const qty = safeNumber(item.quantity || item.qty);
      const cost = safeNumber(item.cost_price || item.unit_price || item.price);
      return acc + qty * cost;
    }, 0);

    const number = `UC-${String(Date.now()).slice(-8)}`;

    const insertUsoSql = `
      INSERT INTO ${TB_USO} (
        budget_id,
        number,
        department,
        responsible,
        reason,
        cfop,
        status,
        total_amount
      )
      VALUES ($1,$2,$3,$4,$5,$6,'FINALIZADO',$7)
      RETURNING *
    `;

    const usoResult = await client.query(insertUsoSql, [
      budgetRealId,
      number,
      department,
      responsible,
      reason,
      cfop,
      totalAmount,
    ]);

    const uso = usoResult.rows[0];

    for (const item of items) {
      const productCode = safeText(item.product_code || item.sku);
      const description = safeText(item.description || item.product_description);
      const quantity = safeNumber(item.quantity || item.qty);
      const costPrice = safeNumber(item.cost_price || item.unit_price || item.price);
      const totalCost = quantity * costPrice;
      const unit = safeText(item.unit || item.unidade || item.unit_sale);
      const lotCode = safeText(item.lot_code || item.lote);
      const productGradeId = item.product_grade_id || item.grade_id || null;
      const gradeLabel = safeText(item.grade_label || item.grade || item.grade_name);

      if (!productCode || quantity <= 0) continue;

      await client.query(
        `
        INSERT INTO ${TB_USO_ITEMS} (
          uso_consumo_id,
          budget_item_id,
          product_code,
          description,
          product_grade_id,
          grade_label,
          lot_code,
          unit,
          quantity,
          cost_price,
          total_cost,
          cfop,
          ncm,
          cst_icms
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        `,
        [
          uso.uso_consumo_id,
          item.budget_item_id || item.id || null,
          productCode,
          description,
          productGradeId,
          gradeLabel,
          lotCode,
          unit,
          quantity,
          costPrice,
          totalCost,
          cfop,
          item.ncm || null,
          item.cst_icms || null,
        ]
      );

      const stockSql = `
        UPDATE public."productsStock" ps
        SET stock_qty = COALESCE(stock_qty, 0) - $1
        FROM public.products p
        WHERE p.product_stock_id = ps.product_stock_id
          AND p.product_code::text = $2
        RETURNING ps.stock_qty
      `;

      const stockResult = await client.query(stockSql, [quantity, productCode]);
      const newStock = stockResult.rows[0]?.stock_qty ?? null;

      await client.query(
        `
        INSERT INTO public."productMovements" (
          product_code,
          movement_type,
          origin_module,
          origin_table,
          origin_id,
          quantity,
          previous_stock,
          new_stock,
          unit,
          lot_code,
          notes,
          metadata,
          created_at
        )
        VALUES (
          $1,
          'USO_CONSUMO',
          'usoConsumo',
          'usoConsumo',
          $2,
          $3,
          NULL,
          $4,
          $5,
          $6,
          $7,
          $8::jsonb,
          NOW()
        )
        `,
        [
          productCode,
          uso.uso_consumo_id,
          quantity * -1,
          newStock,
          unit,
          lotCode,
          `Uso e consumo finalizado a partir do orçamento ${budgetRealId}. CFOP ${cfop}.`,
          JSON.stringify({
            budget_id: budgetRealId,
            uso_consumo_id: uso.uso_consumo_id,
            department,
            responsible,
            reason,
            cfop,
            product_grade_id: productGradeId,
            grade_label: gradeLabel,
          }),
        ]
      );
    }

    await client.query(
      `
  UPDATE public.budgets
  SET status = 'USO_CONSUMO',
      updated_at = NOW()
  WHERE budget_id = $1
  `,
      [budgetRealId]
    );

    await client.query('COMMIT');

    return await getById(uso.uso_consumo_id);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[usoConsumoApi][finishBudgetAsUsoConsumo][ERROR]', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function refreshNfeStatus(usoConsumoId) {
  const id = Number(usoConsumoId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('uso_consumo_id inválido.');
  }

  /*
   * Local helpers used to support different PlugNotas response formats.
   */
  const firstValue = (...values) => {
    for (const value of values) {
      if (
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ''
      ) {
        return value;
      }
    }

    return null;
  };

  const normalizeText = (value) =>
    String(value || '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const normalizeNfeStatus = (providerStatus) => {
    const status = normalizeText(providerStatus);

    if (
      status.includes('AUTORIZ') ||
      status.includes('CONCLUID') ||
      status === 'EMITIDA' ||
      status === 'EMITIDO'
    ) {
      return 'AUTORIZADA';
    }

    if (
      status.includes('REJEIT') ||
      status.includes('DENEG') ||
      status.includes('FALHA') ||
      status.includes('ERRO')
    ) {
      return 'REJEITADA';
    }

    if (status.includes('CANCEL')) {
      return 'CANCELADA';
    }

    if (
      status.includes('PROCESS') ||
      status.includes('PENDENT') ||
      status.includes('AGUARD') ||
      status.includes('ENVIAD') ||
      status.includes('CADASTR') ||
      !status
    ) {
      return 'PROCESSANDO';
    }

    console.warn(
      '[usoConsumoApi][refreshNfeStatus] Status desconhecido da PlugNotas:',
      providerStatus
    );

    return 'PROCESSANDO';
  };

  const validAccessKey = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 44 ? digits : null;
  };

  const validUrl = (value) => {
    const url = String(value || '').trim();

    return /^https?:\/\//i.test(url)
      ? url
      : null;
  };

  const validDate = (value) => {
    if (!value) return null;

    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? null
      : date.toISOString();
  };

  /*
   * Load the linked invoice.
   */
  const localResult = await pool.query(
    `
      SELECT
        uc.uso_consumo_id,
        uc.number AS uso_consumo_number,
        uc.invoice_id,
        ii.nfe_number,
        ii.nfe_key,
        ii.nfe_status,
        ii.nfe_protocol,
        ii.nfe_environment,
        ii.nfe_provider_id,
        ii.xml_url,
        ii.danfe_url,
        ii.issued_at,
        ii.issued_date
      FROM public."usoConsumo" uc
      LEFT JOIN public."invoicesIssued" ii
        ON ii.invoice_id = uc.invoice_id
      WHERE uc.uso_consumo_id = $1
      LIMIT 1
    `,
    [id]
  );

  const local = localResult.rows[0];

  if (!local) {
    throw new Error(
      `Registro de Uso e Consumo ${id} não encontrado.`
    );
  }

  if (!local.invoice_id) {
    throw new Error(
      'Este registro de Uso e Consumo ainda não possui NF-e.'
    );
  }

  const providerId = String(
    local.nfe_provider_id || ''
  ).trim();

  if (!providerId) {
    throw new Error(
      'A NF-e não possui o identificador da PlugNotas.'
    );
  }

  /*
   * Consult PlugNotas.
   */
  const consultation = await consultarNFe(providerId);

  if (!consultation?.ok) {
    const providerError =
      consultation?.error?.message ||
      consultation?.error?.mensagem ||
      consultation?.error ||
      'Falha ao consultar a NF-e na PlugNotas.';

    throw new Error(
      typeof providerError === 'string'
        ? providerError
        : JSON.stringify(providerError)
    );
  }

  const firstObject = (value) => {
    if (Array.isArray(value)) {
      return value[0] || {};
    }

    return value || {};
  };

  const root = firstObject(consultation.data);

  const payload = firstObject(
    root.data ||
    root.retorno ||
    root
  );

  const document = firstObject(
    payload.documents ||
    payload.documentos ||
    payload.notas ||
    payload.nfe ||
    payload.documento ||
    payload
  );

  const authorization =
    document.autorizacao ||
    document.authorization ||
    payload.autorizacao ||
    payload.authorization ||
    {};

  const rawStatus = firstValue(
    document.status,
    document.situacao,
    document.statusNFe,
    document.status_nfe,
    document.state,
    payload.status,
    payload.situacao,
    root.status,
    local.nfe_status
  );

  const normalizedStatus = normalizeNfeStatus(rawStatus);

  const accessKey = validAccessKey(
    firstValue(
      document.chave,
      document.chaveAcesso,
      document.chave_acesso,
      document.nfeKey,
      document.nfe_key,
      authorization.chave,
      authorization.chaveAcesso,
      payload.chave,
      payload.chaveAcesso,
      root.chave,
      local.nfe_key
    )
  );

  const protocol = firstValue(
    document.protocolo,
    document.numeroProtocolo,
    document.nfeProtocol,
    document.nfe_protocol,
    authorization.protocolo,
    authorization.numeroProtocolo,
    authorization.numero,
    payload.protocolo,
    payload.numeroProtocolo,
    root.protocolo,
    local.nfe_protocol
  );

  const xmlUrl = validUrl(
    firstValue(
      document.xmlUrl,
      document.xml_url,
      document.urlXml,
      document.xml,
      payload.xmlUrl,
      payload.xml_url,
      payload.urlXml,
      local.xml_url
    )
  );

  const danfeUrl = validUrl(
    firstValue(
      document.danfeUrl,
      document.danfe_url,
      document.pdfUrl,
      document.pdf_url,
      document.urlPdf,
      document.pdf,
      payload.danfeUrl,
      payload.danfe_url,
      payload.pdfUrl,
      payload.urlPdf,
      local.danfe_url
    )
  );

  const authorizedAt = validDate(
    firstValue(
      document.dataAutorizacao,
      document.data_autorizacao,
      document.authorizedAt,
      document.issuedAt,
      authorization.data,
      authorization.dataAutorizacao,
      payload.dataAutorizacao,
      local.issued_at
    )
  );

  /*
   * Update the local NF-e.
   */
  const updateResult = await pool.query(
    `
    UPDATE public."invoicesIssued"
    SET nfe_status = $1::varchar(20),

        nfe_key = COALESCE(
          $2::varchar(44),
          nfe_key
        ),

        nfe_protocol = COALESCE(
          $3::varchar(80),
          nfe_protocol
        ),

        xml_url = COALESCE(
          $4::text,
          xml_url
        ),

        danfe_url = COALESCE(
          $5::text,
          danfe_url
        ),

        issued_at = CASE
          WHEN $1::varchar(20) = 'AUTORIZADA'
            THEN COALESCE(
              $6::timestamptz,
              issued_at,
              NOW()
            )
          ELSE issued_at
        END,

        issued_date = CASE
          WHEN $1::varchar(20) = 'AUTORIZADA'
            THEN COALESCE(
              $6::timestamptz,
              issued_at,
              NOW()
            )::date
          ELSE issued_date
        END,

        updated_at = NOW()
    WHERE invoice_id = $7::bigint
    RETURNING *
  `,
    [
      normalizedStatus,
      accessKey,
      protocol ? String(protocol) : null,
      xmlUrl,
      danfeUrl,
      authorizedAt,
      Number(local.invoice_id),
    ]
  );

  const invoice = updateResult.rows[0];

  if (!invoice) {
    throw new Error(
      'Não foi possível atualizar a NF-e no banco de dados.'
    );
  }

  console.log(
    '[usoConsumoApi][refreshNfeStatus]',
    {
      uso_consumo_id: id,
      invoice_id: invoice.invoice_id,
      provider_id: providerId,
      provider_status: rawStatus,
      local_status: normalizedStatus,
      nfe_number: invoice.nfe_number,
      nfe_key: invoice.nfe_key,
    }
  );

  return {
    uso_consumo_id: id,
    invoice,
    provider: {
      id: providerId,
      raw_status: rawStatus,
      status: normalizedStatus,
      response: root,
    },
  };
}

export async function retryNfe(usoConsumoId) {
  const id = Number(usoConsumoId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('uso_consumo_id inválido.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `SELECT pg_advisory_xact_lock($1::bigint)`,
      [id]
    );

    const currentResult = await client.query(
      `
        SELECT
          uc.uso_consumo_id,
          uc.invoice_id,
          ii.nfe_number,
          ii.nfe_status,
          ii.nfe_provider_id,
          ii.nfe_retry_count
        FROM public."usoConsumo" uc
        LEFT JOIN public."invoicesIssued" ii
          ON ii.invoice_id = uc.invoice_id
        WHERE uc.uso_consumo_id = $1
        LIMIT 1
      `,
      [id]
    );

    const current = currentResult.rows[0];

    if (!current) {
      throw new Error(
        `Registro de Uso e Consumo ${id} não encontrado.`
      );
    }

    if (!current.invoice_id) {
      throw new Error(
        'Este Uso e Consumo não possui NF-e para reenvio.'
      );
    }

    if (
      String(current.nfe_status || '').toUpperCase() !==
      'REJEITADA'
    ) {
      throw new Error(
        'Somente uma NF-e rejeitada pode ser reenviada.'
      );
    }

    const nfeNumber = Number(current.nfe_number);

    if (!Number.isInteger(nfeNumber) || nfeNumber <= 0) {
      throw new Error(
        'A NF-e rejeitada não possui numeração válida.'
      );
    }

    const nextRetry =
      Number(current.nfe_retry_count || 0) + 1;

    /*
     * Identificador estável por tentativa.
     *
     * Se a PlugNotas receber a nota e o banco falhar depois,
     * repetir a operação utiliza o mesmo idIntegracao.
     */
    const idIntegracao =
      `USOCONSUMO-${id}-R${nextRetry}`;

    const emission = await emitirNFeUsoConsumo(id, {
      retry: true,
      nfeNumber,
      idIntegracao,
    });

    if (!emission?.ok) {
      throw new Error(
        emission?.message ||
        'A PlugNotas não aceitou o reenvio da NF-e.'
      );
    }

    const providerId = String(
      emission.plugnotas_id || ''
    ).trim();

    if (!providerId) {
      throw new Error(
        'A PlugNotas não retornou o identificador do novo envio.'
      );
    }

    const updateResult = await client.query(
      `
        UPDATE public."invoicesIssued"
        SET nfe_provider_id = $1,
            nfe_status = 'PROCESSANDO',
            nfe_key = NULL,
            nfe_protocol = NULL,
            xml_url = NULL,
            danfe_url = NULL,
            issued_at = NULL,
            issued_date = NULL,
            nfe_retry_count = $2,
            updated_at = NOW()
        WHERE invoice_id = $3
          AND nfe_status = 'REJEITADA'
        RETURNING *
      `,
      [
        providerId,
        nextRetry,
        current.invoice_id,
      ]
    );

    if (!updateResult.rowCount) {
      throw new Error(
        'Não foi possível atualizar a NF-e para o novo processamento.'
      );
    }

    await client.query('COMMIT');

    return {
      uso_consumo_id: id,
      invoice: updateResult.rows[0],
      retry: {
        attempt: nextRetry,
        id_integracao: idIntegracao,
        provider_id: providerId,
        status: 'PROCESSANDO',
      },
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(
        '[usoConsumoApi][retryNfe][ROLLBACK_ERROR]',
        rollbackError
      );
    }

    console.error(
      '[usoConsumoApi][retryNfe][ERROR]',
      error
    );

    throw error;
  } finally {
    client.release();
  }
}

export async function generateDanfeConsart(usoConsumoId) {
  const id = Number(usoConsumoId);

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('uso_consumo_id inválido.');
  }

  const { rows } = await pool.query(
    `
      SELECT
        uc.uso_consumo_id,
        uc.number AS uso_consumo_number,
        uc.department,
        uc.responsible,
        uc.reason,

        ii.invoice_id,
        ii.nfe_number,
        ii.nfe_key,
        ii.nfe_status,
        ii.nfe_protocol,
        ii.nfe_provider_id
      FROM public."usoConsumo" uc
      INNER JOIN public."invoicesIssued" ii
        ON ii.invoice_id = uc.invoice_id
      WHERE uc.uso_consumo_id = $1::bigint
      LIMIT 1
    `,
    [id]
  );

  const invoice = rows[0];

  if (!invoice) {
    throw new Error(
      'Uso e Consumo ou NF-e vinculada não encontrado.'
    );
  }

  if (
    String(invoice.nfe_status || '').toUpperCase() !==
    'AUTORIZADA'
  ) {
    throw new Error(
      'O DANFE somente pode ser gerado para uma NF-e autorizada.'
    );
  }

  if (!invoice.nfe_provider_id) {
    throw new Error(
      'Identificador da NF-e na PlugNotas não encontrado.'
    );
  }

  const baseUrl = String(
    process.env.PLUGNOTAS_BASE_URL ||
    'https://api.plugnotas.com.br'
  ).replace(/\/+$/, '');

  const ambiente = String(
    process.env.NFE_AMBIENTE || 'homologacao'
  ).toLowerCase();

  const apiKey =
    ambiente === 'producao'
      ? (
        process.env.PLUGNOTAS_API_KEY_REAL ||
        process.env.PLUGNOTAS_API_KEY
      )
      : (
        process.env.PLUGNOTAS_API_KEY_HOMOLOG ||
        process.env.PLUGNOTAS_API_KEY
      );

  if (!apiKey) {
    throw new Error(
      'Chave da API PlugNotas não configurada.'
    );
  }

  const xmlResponse = await fetch(
    `${baseUrl}/nfe/${encodeURIComponent(
      invoice.nfe_provider_id
    )}/xml`,
    {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/xml, text/xml',
      },
      signal: AbortSignal.timeout(60000),
    }
  );

  const xmlContent = await xmlResponse.text();

  if (!xmlResponse.ok) {
    console.error(
      '[usoConsumoApi][generateDanfeConsart][XML ERROR]',
      {
        status: xmlResponse.status,
        response: xmlContent,
      }
    );

    throw new Error(
      `Erro ao baixar XML da PlugNotas: HTTP ${xmlResponse.status}.`
    );
  }

  if (
    !xmlContent ||
    (
      !xmlContent.includes('<NFe') &&
      !xmlContent.includes('<nfeProc')
    )
  ) {
    throw new Error(
      'A PlugNotas não retornou um XML válido.'
    );
  }

  const danfe = await generateDanfeFromXml({
    numero: String(invoice.nfe_number || ''),
    serie: String(process.env.NFE_SERIE || '1'),
    chave: String(invoice.nfe_key || ''),
    xmlContent,

    prot: {
      protocolo: invoice.nfe_protocol || '',
    },

    complementaryInfo: [
      'RETIRADA DE MERCADORIAS PARA USO E CONSUMO INTERNO.',
      `CONTROLE INTERNO: ${invoice.uso_consumo_number || id
      }.`,
      `DEPARTAMENTO: ${invoice.department || 'NÃO INFORMADO'
      }.`,
      `RESPONSÁVEL: ${invoice.responsible || 'NÃO INFORMADO'
      }.`,
      invoice.reason
        ? `MOTIVO: ${String(invoice.reason).trim()}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  });

  if (!Buffer.isBuffer(danfe?.buffer)) {
    throw new Error(
      'O gerador Consart não retornou um PDF válido.'
    );
  }

  return {
    buffer: danfe.buffer,
    filename:
      danfe.filename ||
      `DANFE-NFE-${invoice.nfe_number || id}.pdf`,
  };
}