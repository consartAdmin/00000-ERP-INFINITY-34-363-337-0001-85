// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesCommissionsFromInvoicesApi.js — NF-e → Commissions API         ║
// ║ CONSART ERP | PostgreSQL | ESM                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB_SCI = 'public."salesCommissionsFromInvoices"';
const TB_INVOICES = 'public."invoicesIssued"';
const TB_ORDERS = 'public."orders"';
const TB_ORDER_ITEMS = 'public."orderItems"';
const TB_PRICES = 'public."prices"';
const TB_PC = 'public."priceCommissions"';
const TB_SELLERS = 'public."sellers"';
const TB_BUDGETS = 'public."budgets"';
const TB_SELLER_BY_BUDGETS = 'public."sellerByBudgets"';
/*
 * Itens do orçamento: tabela ATUAL (budgetsItems).
 * Antes apontava para a legada "budgetItens", congelada no orçamento 160 —
 * o price_id do orçamento não era encontrado para nada recente.
 * A coluna de SKU lá é product_code (a legada usava sku).
 */
const TB_BUDGET_ITEMS = 'public."budgetsItems"';

const DEFAULT_PRICE_ID = 1;

function clampInt(n, def, min, max) {
    const x = Number(n);

    if (!Number.isFinite(x)) {
        return def;
    }

    return Math.min(max, Math.max(min, Math.trunc(x)));
}

export async function generateSalesCommissionsFromInvoices({
    dateStart = null,
    dateEnd = null,
    forceRegenerate = false,
} = {}) {
    if (forceRegenerate) {
        await pool.query(`DELETE FROM ${TB_SCI}`);
    }

    const sql = `
        WITH source_rows AS (
            SELECT
                ii.invoice_id,
                ii.order_id,
                oi.order_item_id,
                ii.issued_date AS issue_date,

                COALESCE(
                    NULLIF(regexp_replace(sb.seller_id::text, '[^0-9]', '', 'g'), '')::int,
                    NULLIF(regexp_replace(b.seller_id::text, '[^0-9]', '', 'g'), '')::int
                ) AS seller_id,

                COALESCE(s.name, 'SEM VENDEDOR') AS seller_name,

                LEFT(COALESCE(oi.sku::text, ''), 20) AS product_id,
                LEFT(COALESCE(oi.sku::text, ''), 40) AS product_code,
                oi.sku,

                COALESCE(
                    oi.price_id,
                    o.price_id,
                    bi.price_id,
                    $3::int
                ) AS price_id,

                COALESCE(p.name, 'VAREJO') AS price_table_name,

                COALESCE(oi.quantity, 0)::numeric AS quantity,

                (
                    COALESCE(oi.quantity, 0)
                    * COALESCE(oi.unit_price, 0)
                    - COALESCE(oi.discount_value, 0)
                )::numeric AS item_total,

                COALESCE(
                    o.customer_name,
                    o.nome_razao_social,
                    ''
                ) AS customer_name,

                NOW() AS created_at,
                NOW() AS updated_at

            FROM ${TB_INVOICES} ii

            JOIN ${TB_ORDERS} o
                ON o.order_id = ii.order_id

            LEFT JOIN ${TB_BUDGETS} b
                ON b.budget_id = o.budget_id

            JOIN ${TB_ORDER_ITEMS} oi
                ON oi.order_id = o.order_id

            LEFT JOIN LATERAL (
                SELECT
                    bi2.price_id
                FROM ${TB_BUDGET_ITEMS} bi2
                WHERE bi2.budget_id = o.budget_id
                  AND TRIM(bi2.product_code::text) = TRIM(oi.sku::text)
                ORDER BY bi2.budget_item_id DESC
                LIMIT 1
            ) bi ON true

            LEFT JOIN ${TB_SELLER_BY_BUDGETS} sb
                ON sb.budget_id = o.budget_id
               AND COALESCE(sb.active, true) = true

            LEFT JOIN ${TB_SELLERS} s
                ON s.id = COALESCE(
                    NULLIF(regexp_replace(sb.seller_id::text, '[^0-9]', '', 'g'), '')::int,
                    NULLIF(regexp_replace(b.seller_id::text, '[^0-9]', '', 'g'), '')::int
                )

            LEFT JOIN ${TB_PRICES} p
                ON p.price_id = COALESCE(
                    oi.price_id,
                    o.price_id,
                    bi.price_id,
                    $3::int
                )

            WHERE ii.order_id IS NOT NULL
              AND ii.issued_date IS NOT NULL
              AND ii.cancelled_at IS NULL
              AND COALESCE(ii.nfe_status, '') NOT IN (
                    'CANCELADA',
                    'CANCELLED',
                    'DENIED',
                    'REJEITADA',
                    'REJECTED'
              )
              AND ($1::date IS NULL OR ii.issued_date >= $1::date)
              AND ($2::date IS NULL OR ii.issued_date <= $2::date)
        )

        INSERT INTO ${TB_SCI} (
            invoice_id,
            order_id,
            order_item_id,
            issue_date,
            seller_id,
            seller_name,
            product_id,
            product_code,
            sku,
            price_id,
            price_table_name,
            quantity,
            item_total,
            customer_name,
            created_at,
            updated_at
        )
        SELECT
            invoice_id,
            order_id,
            order_item_id,
            issue_date,
            seller_id,
            seller_name,
            product_id,
            product_code,
            sku,
            price_id,
            price_table_name,
            quantity,
            item_total,
            customer_name,
            created_at,
            updated_at
        FROM source_rows
        ON CONFLICT (order_item_id)
        DO UPDATE SET
            invoice_id        = EXCLUDED.invoice_id,
            order_id          = EXCLUDED.order_id,
            issue_date        = EXCLUDED.issue_date,
            seller_id         = EXCLUDED.seller_id,
            seller_name       = EXCLUDED.seller_name,
            product_id        = EXCLUDED.product_id,
            product_code      = EXCLUDED.product_code,
            sku               = EXCLUDED.sku,
            price_id          = EXCLUDED.price_id,
            price_table_name  = EXCLUDED.price_table_name,
            quantity          = EXCLUDED.quantity,
            item_total        = EXCLUDED.item_total,
            customer_name     = EXCLUDED.customer_name,
            updated_at        = NOW()
    `;

    const res = await pool.query(sql, [
        dateStart,
        dateEnd,
        DEFAULT_PRICE_ID,
    ]);

    return {
        ok: true,
        inserted: res.rowCount || 0,
    };
}

export async function recalcSalesCommissionsFromInvoices({
    onlyMissing = true,
} = {}) {
    const whereMissing = onlyMissing
        ? `
            AND (
                sci.commission_id IS NULL
                OR sci.percent_value IS NULL
                OR sci.fixed_value IS NULL
                OR COALESCE(sci.item_commission, 0) = 0
            )
        `
        : '';

    const sql = `
        WITH pick_rule AS (
            SELECT
                sci.sales_commission_invoice_id,
                pc.commission_id,
                pc.commission_type,
                pc.percent_value,
                pc.fixed_value,

                CASE
                    WHEN pc.commission_type = 'PERCENT'
                        THEN ROUND((
                            COALESCE(sci.item_total, 0)
                            * COALESCE(pc.percent_value, 0)
                            / 100.0
                        )::numeric, 4)

                    WHEN pc.commission_type = 'FIXED'
                        THEN ROUND((
                            COALESCE(sci.quantity, 0)
                            * COALESCE(pc.fixed_value, 0)
                        )::numeric, 4)

                    ELSE 0
                END AS calc_item_commission

            FROM ${TB_SCI} sci

            LEFT JOIN LATERAL (
                SELECT
                    pc2.commission_id,
                    pc2.commission_type,
                    pc2.percent_value,
                    pc2.fixed_value
                FROM ${TB_PC} pc2
                WHERE pc2.active = true
                  AND pc2.price_id = sci.price_id
                  AND pc2.seller_id = sci.seller_id
                  AND pc2.valid_from <= sci.issue_date
                  AND (
                        pc2.valid_to IS NULL
                        OR pc2.valid_to >= sci.issue_date
                  )
                ORDER BY
                    pc2.valid_from DESC,
                    pc2.commission_id DESC
                LIMIT 1
            ) pc ON true

            WHERE sci.seller_id IS NOT NULL
              AND COALESCE(sci.price_id, 0) > 0
              AND sci.issue_date IS NOT NULL
              ${whereMissing}
              AND pc.commission_id IS NOT NULL
        )

        UPDATE ${TB_SCI} sci
           SET commission_id   = pr.commission_id,
               commission_type = pr.commission_type,
               percent_value   = pr.percent_value,
               fixed_value     = pr.fixed_value,
               item_commission = pr.calc_item_commission,
               updated_at      = NOW()
          FROM pick_rule pr
         WHERE pr.sales_commission_invoice_id = sci.sales_commission_invoice_id
    `;

    const res = await pool.query(sql);

    return {
        ok: true,
        updated: res.rowCount || 0,
    };
}

export async function diagnosticsSalesCommissionsFromInvoices({
    dateStart = null,
    dateEnd = null,
    salesperson = null,
    priceId = null,
} = {}) {
    const { rows } = await pool.query(`
        SELECT
            COUNT(*)::int AS total,
            SUM((seller_id IS NULL)::int)::int AS sem_seller_id,
            SUM((price_id IS NULL)::int)::int AS sem_price_id,
            SUM((issue_date IS NULL)::int)::int AS sem_issue_date,
            SUM((commission_id IS NULL)::int)::int AS sem_commission_id,
            COALESCE(SUM(item_total), 0)::numeric(14,2) AS total_faturado,
            COALESCE(SUM(item_commission), 0)::numeric(14,2) AS total_comissao
        FROM ${TB_SCI}
        WHERE 1=1
          AND ($1::date IS NULL OR issue_date >= $1::date)
          AND ($2::date IS NULL OR issue_date <= $2::date)
          AND (
                $3::text IS NULL
                OR CAST(seller_id AS text) = $3::text
                OR LOWER(COALESCE(seller_name, '')) LIKE LOWER('%' || $3::text || '%')
          )
          AND ($4::int IS NULL OR price_id = $4::int)
    `, [
        dateStart,
        dateEnd,
        salesperson,
        priceId,
    ]);

    return {
        ok: true,
        ...(rows[0] || {}),
    };
}

export async function listSalesCommissionsFromInvoices({
    dateStart = null,
    dateEnd = null,
    salesperson = null,
    priceId = null,
    limit = 500,
    offset = 0,
} = {}) {
    const lim = clampInt(limit, 500, 1, 5000);
    const off = clampInt(offset, 0, 0, 10000000);

    const sql = `
        WITH filtered AS (
            SELECT
                sci.*
            FROM ${TB_SCI} sci
            WHERE 1=1
              AND ($1::date IS NULL OR sci.issue_date >= $1::date)
              AND ($2::date IS NULL OR sci.issue_date <= $2::date)
              AND (
                    $3::text IS NULL
                    OR CAST(sci.seller_id AS text) = $3::text
                    OR LOWER(COALESCE(sci.seller_name, '')) LIKE LOWER('%' || $3::text || '%')
              )
              AND ($4::int IS NULL OR sci.price_id = $4::int)
        ),
        counted AS (
            SELECT COUNT(*)::bigint AS total
            FROM filtered
        )
        SELECT
            (SELECT total FROM counted) AS total,
            COALESCE(
                json_agg(
                    x
                    ORDER BY
                        x.issue_date DESC,
                        x.invoice_id DESC,
                        x.order_id DESC,
                        x.order_item_id DESC
                ),
                '[]'::json
            ) AS rows
        FROM (
            SELECT *
            FROM filtered
            ORDER BY
                issue_date DESC,
                invoice_id DESC,
                order_id DESC,
                order_item_id DESC
            LIMIT $5::int
            OFFSET $6::int
        ) x
    `;

    const { rows } = await pool.query(sql, [
        dateStart,
        dateEnd,
        salesperson,
        priceId,
        lim,
        off,
    ]);

    const out = rows?.[0] || {
        total: 0,
        rows: [],
    };

    return {
        ok: true,
        total: Number(out.total || 0),
        rows: out.rows || [],
    };
}

export async function getSalesCommissionsFromInvoicesPdfData({
    dateStart = null,
    dateEnd = null,
    salesperson = null,
    priceId = null,
} = {}) {
    const diagnostics = await diagnosticsSalesCommissionsFromInvoices({
        dateStart,
        dateEnd,
        salesperson,
        priceId,
    });

    const items = await listSalesCommissionsFromInvoices({
        dateStart,
        dateEnd,
        salesperson,
        priceId,
        limit: 5000,
        offset: 0,
    });

    return {
        ok: true,
        filters: {
            dateStart,
            dateEnd,
            salesperson,
            priceId,
        },
        diagnostics,
        total: items.total,
        rows: items.rows || [],
    };
}