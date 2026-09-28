// ╔══════════════════════════════════════════════════════════════════════╗
// ║ dreGerencialApi.js — API/DAL DRE Gerencial                          ║
// ║ CONSART ERP | PostgreSQL | ESM                                      ║
// ║ ✅ Considera qualquer SAÍDA ativa no DRE, independente da categoria   ║
// ║ ✅ Checkbox da movimentação sobrescreve regra da subcategoria         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../../config/db.js';

function toNum(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function monthRange(month) {
  const ref = String(month || '').trim();

  if (!/^\d{4}-\d{2}$/.test(ref)) {
    throw new Error('Informe o mês no formato YYYY-MM');
  }

  const start = `${ref}-01`;
  const endDate = new Date(`${start}T00:00:00`);
  endDate.setMonth(endDate.getMonth() + 1);

  return {
    start,
    end: endDate.toISOString().slice(0, 10),
  };
}

function calcIrpjCsll(baseLucro) {
  const lucro = Math.max(0, toNum(baseLucro));

  const irpjBase = lucro * 0.15;
  const irpjAdicional = Math.max(0, lucro - 20000) * 0.10;
  const irpj = irpjBase + irpjAdicional;
  const csll = lucro * 0.09;

  return {
    irpj: Number(irpj.toFixed(2)),
    csll: Number(csll.toFixed(2)),
    total: Number((irpj + csll).toFixed(2)),
  };
}

async function getResumo(month) {
  const { start, end } = monthRange(month);

  const vendasSql = `
    SELECT
      COALESCE(SUM(i.total_amount), 0)::numeric AS receita_bruta
    FROM public."invoicesIssued" i
    WHERE i.issued_date >= $1
      AND i.issued_date < $2
      AND i.cancelled_at IS NULL
      AND UPPER(COALESCE(i.nfe_status, '')) IN (
        'AUTORIZADA',
        'AUTORIZADO',
        'CONCLUIDO',
        'CONCLUÍDO'
      )
  `;

  const impostosSql = `
    SELECT
      COALESCE(SUM(
        oi.quantity * oi.unit_price * COALESCE(p.tax_icms_sale_percent, 0) / 100
      ), 0)::numeric AS icms_venda,

      COALESCE(SUM(
        oi.quantity * oi.unit_price * COALESCE(p.tax_pis_sale_percent, 0) / 100
      ), 0)::numeric AS pis_venda,

      COALESCE(SUM(
        oi.quantity * oi.unit_price * COALESCE(p.tax_cofins_sale_percent, 0) / 100
      ), 0)::numeric AS cofins_venda
    FROM public."invoicesIssued" i
    JOIN public."orderItems" oi
      ON oi.order_id = i.order_id
    LEFT JOIN public.products p
      ON p.product_code = oi.sku
    WHERE i.issued_date >= $1
      AND i.issued_date < $2
      AND i.cancelled_at IS NULL
      AND UPPER(COALESCE(i.nfe_status, '')) IN (
        'AUTORIZADA',
        'AUTORIZADO',
        'CONCLUIDO',
        'CONCLUÍDO'
      )
  `;

  const caixaSql = `
    WITH caixa_base AS (
      SELECT
        mc.*,
        COALESCE(cc.nome, mc.categoria::text) AS categoria_nome,
        COALESCE(cs.nome, mc.subcategoria::text) AS subcategoria_nome,
        cs.is_deductible AS subcategoria_is_deductible,

        CASE
          WHEN mc.is_deductible IS NOT NULL
            THEN mc.is_deductible
          WHEN cs.is_deductible IS NOT NULL
            THEN cs.is_deductible
          ELSE FALSE
        END AS is_deductible_final

      FROM public."movimentacoesCaixa" mc

      LEFT JOIN public."caixaCategorias" cc
        ON cc.id::text = mc.categoria::text
        OR UPPER(TRIM(cc.nome)) = UPPER(TRIM(mc.categoria::text))

      LEFT JOIN public."caixaSubCategorias" cs
        ON cs.id::text = mc.subcategoria::text
        OR UPPER(TRIM(cs.nome)) = UPPER(TRIM(mc.subcategoria::text))

      WHERE mc.data_hora >= $1
        AND mc.data_hora < $2
        AND mc.is_active IS TRUE
        AND UPPER(TRIM(COALESCE(mc.tipo_movimentacao, ''))) IN (
          'SAIDA',
          'SAÍDA',
          'DEBITO',
          'DÉBITO'
        )
    )

    SELECT
      COALESCE(SUM(
        CASE
          WHEN UPPER(TRIM(COALESCE(subcategoria_nome, ''))) IN ('C.M.V', 'CMV')
          THEN valor ELSE 0
        END
      ), 0)::numeric AS cmv,

      COALESCE(SUM(
        CASE
          WHEN UPPER(TRIM(COALESCE(subcategoria_nome, ''))) NOT IN ('C.M.V', 'CMV')
          THEN valor ELSE 0
        END
      ), 0)::numeric AS despesas_total,

      COALESCE(SUM(
        CASE
          WHEN UPPER(TRIM(COALESCE(subcategoria_nome, ''))) NOT IN ('C.M.V', 'CMV')
           AND is_deductible_final IS TRUE
          THEN valor ELSE 0
        END
      ), 0)::numeric AS despesas_dedutiveis,

      COALESCE(SUM(
        CASE
          WHEN UPPER(TRIM(COALESCE(subcategoria_nome, ''))) NOT IN ('C.M.V', 'CMV')
           AND is_deductible_final IS FALSE
          THEN valor ELSE 0
        END
      ), 0)::numeric AS despesas_nao_dedutiveis

    FROM caixa_base
  `;

  const [vendasRes, impostosRes, caixaRes] = await Promise.all([
    pool.query(vendasSql, [start, end]),
    pool.query(impostosSql, [start, end]),
    pool.query(caixaSql, [start, end]),
  ]);

  const receitaBruta = toNum(vendasRes.rows[0]?.receita_bruta);

  const icmsVenda = toNum(impostosRes.rows[0]?.icms_venda);
  const pisVenda = toNum(impostosRes.rows[0]?.pis_venda);
  const cofinsVenda = toNum(impostosRes.rows[0]?.cofins_venda);
  const impostosVenda = icmsVenda + pisVenda + cofinsVenda;

  const cmv = toNum(caixaRes.rows[0]?.cmv);
  const despesasTotal = toNum(caixaRes.rows[0]?.despesas_total);
  const despesasDedutiveis = toNum(caixaRes.rows[0]?.despesas_dedutiveis);
  const despesasNaoDedutiveis = toNum(caixaRes.rows[0]?.despesas_nao_dedutiveis);

  const receitaLiquida = receitaBruta - impostosVenda;
  const lucroBruto = receitaLiquida - cmv;
  const resultadoContabil = lucroBruto - despesasTotal;
  const lucroFiscalBase = resultadoContabil + despesasNaoDedutiveis;

  const impostosLucro = calcIrpjCsll(lucroFiscalBase);
  const lucroLiquidoEstimado = resultadoContabil - impostosLucro.total;

  return {
    periodo: { start, end },

    receita_bruta: Number(receitaBruta.toFixed(2)),

    impostos_venda: {
      icms: Number(icmsVenda.toFixed(2)),
      pis: Number(pisVenda.toFixed(2)),
      cofins: Number(cofinsVenda.toFixed(2)),
      total: Number(impostosVenda.toFixed(2)),
    },

    receita_liquida: Number(receitaLiquida.toFixed(2)),
    cmv: Number(cmv.toFixed(2)),
    lucro_bruto: Number(lucroBruto.toFixed(2)),

    despesas: {
      total: Number(despesasTotal.toFixed(2)),
      dedutiveis: Number(despesasDedutiveis.toFixed(2)),
      nao_dedutiveis: Number(despesasNaoDedutiveis.toFixed(2)),
    },

    resultado_antes_irpj_csll: Number(resultadoContabil.toFixed(2)),
    irpj_csll: impostosLucro,
    lucro_liquido_estimado: Number(lucroLiquidoEstimado.toFixed(2)),

    margens: {
      margem_bruta_percent:
        receitaBruta > 0 ? Number(((lucroBruto / receitaBruta) * 100).toFixed(2)) : 0,
      margem_liquida_percent:
        receitaBruta > 0 ? Number(((lucroLiquidoEstimado / receitaBruta) * 100).toFixed(2)) : 0,
    },
  };
}

async function listDespesas(month) {
  const { start, end } = monthRange(month);

  const { rows } = await pool.query(
    `
      SELECT
        mc.id AS expense_id,

        COALESCE(
          NULLIF(TRIM(mc.fornecedor), ''),
          NULLIF(TRIM(mc.observacao), ''),
          cs.nome,
          'Sem descrição'
        ) AS description,

        COALESCE(
          cc.nome,
          mc.categoria::text
        ) AS category,

        COALESCE(
          cs.nome,
          mc.subcategoria::text
        ) AS subcategoria,

        mc.valor AS amount,

        mc.data_hora::date AS due_date,

        mc.data_hora::date AS paid_date,

        CASE
          WHEN LOWER(COALESCE(mc.tipo_movimentacao, '')) IN
          ('saida', 'saída', 'debito', 'débito')
          THEN 'paid'
          ELSE 'pending'
        END AS status,

        date_trunc('month', mc.data_hora)::date AS reference_month,

        mc.tipo_movimentacao,
        mc.conta_caixa,
        mc.tipo_documento,
        mc.numero_documento,
        mc.fornecedor,
        mc.multa,
        mc.juros,
        mc.encargos,

        mc.is_deductible,

        cs.is_deductible AS subcategoria_is_deductible,

        CASE
          WHEN mc.is_deductible IS NOT NULL
            THEN mc.is_deductible
          WHEN cs.is_deductible IS NOT NULL
            THEN cs.is_deductible
          ELSE FALSE
        END AS is_deductible_final,

        cs.dre_tipo,

        mc.created_at,
        mc.updated_at

      FROM public."movimentacoesCaixa" mc

      LEFT JOIN public."caixaCategorias" cc
        ON cc.id::text = mc.categoria::text
        OR UPPER(TRIM(cc.nome)) = UPPER(TRIM(mc.categoria::text))

      LEFT JOIN public."caixaSubCategorias" cs
        ON cs.id::text = mc.subcategoria::text
        OR UPPER(TRIM(cs.nome)) = UPPER(TRIM(mc.subcategoria::text))

      WHERE mc.data_hora >= $1
        AND mc.data_hora < $2
        AND mc.is_active IS TRUE
        AND UPPER(TRIM(COALESCE(mc.tipo_movimentacao, ''))) IN (
          'SAIDA',
          'SAÍDA',
          'DEBITO',
          'DÉBITO'
        )

      ORDER BY mc.data_hora ASC,
               mc.id DESC
    `,
    [start, end]
  );

  return rows;
}

async function createDespesa(payload = {}) {
  const {
    description,
    category = 'Despesas',
    subcategoria,
    amount,
    due_date,
    status = 'paid',
    reference_month,
    notes,
    conta_caixa = 'DRE',
    tipo_documento = 'DRE',
    numero_documento = null,
    fornecedor = null,
    is_deductible = true,
  } = payload;

  const dataHora =
    due_date ||
    reference_month ||
    new Date().toISOString().slice(0, 10);

  const tipoMovimentacao =
    status === 'paid' || status === 'pago'
      ? 'saida'
      : 'pendente';

  const { rows } = await pool.query(
    `
      INSERT INTO public."movimentacoesCaixa"
      (
        data_hora,
        tipo_movimentacao,
        conta_caixa,
        valor,
        tipo_documento,
        numero_documento,
        fornecedor,
        observacao,
        categoria,
        subcategoria,
        is_deductible,
        is_active
      )
      VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)
      RETURNING *
    `,
    [
      dataHora,
      tipoMovimentacao,
      conta_caixa,
      toNum(amount),
      tipo_documento,
      numero_documento,
      fornecedor,
      notes || description || null,
      category || 'Despesas',
      subcategoria || 'Despesas Operacionais',
      is_deductible,
    ]
  );

  return rows[0];
}

async function updateDespesa(id, payload = {}) {
  const {
    description,
    category,
    subcategoria,
    amount,
    due_date,
    status,
    notes,
    conta_caixa,
    tipo_documento,
    numero_documento,
    fornecedor,
    is_deductible,
  } = payload;

  const tipoMovimentacao =
    status === undefined || status === null
      ? null
      : status === 'paid' || status === 'pago'
        ? 'saida'
        : 'pendente';

  const { rows } = await pool.query(
    `
      UPDATE public."movimentacoesCaixa"
      SET
        data_hora         = COALESCE($1, data_hora),
        tipo_movimentacao = COALESCE($2, tipo_movimentacao),
        conta_caixa       = COALESCE($3, conta_caixa),
        valor             = COALESCE($4, valor),
        tipo_documento    = COALESCE($5, tipo_documento),
        numero_documento  = COALESCE($6, numero_documento),
        fornecedor        = COALESCE($7, fornecedor),
        observacao        = COALESCE($8, observacao),
        categoria         = COALESCE($9, categoria),
        subcategoria      = COALESCE($10, subcategoria),
        is_deductible     = COALESCE($11, is_deductible),
        updated_at        = NOW()
      WHERE id = $12
        AND is_active IS TRUE
      RETURNING *
    `,
    [
      due_date || null,
      tipoMovimentacao,
      conta_caixa || null,
      amount === undefined ? null : toNum(amount),
      tipo_documento || null,
      numero_documento || null,
      fornecedor || null,
      notes || description || null,
      category || null,
      subcategoria || null,
      is_deductible === undefined ? null : is_deductible,
      Number(id),
    ]
  );

  return rows[0] || null;
}

async function deleteDespesa(id) {
  const { rows } = await pool.query(
    `
      UPDATE public."movimentacoesCaixa"
      SET is_active = FALSE,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [Number(id)]
  );

  return rows[0] || null;
}

export default {
  getResumo,
  listDespesas,
  createDespesa,
  updateDespesa,
  deleteDespesa,
};