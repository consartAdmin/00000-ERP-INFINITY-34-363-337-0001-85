// ╔════════════════════════════════════════════════════════════════════╗
// ║ salesCommissionsFromInvoicesGenerate.repository.js                 ║
// ║ generateSalesCommissionsFromInvoices — NF-e → comissões            ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import {
  TB_SCI,
  TB_INVOICES,
  TB_ORDERS,
  TB_ORDER_ITEMS,
  TB_PRICES,
  TB_SELLERS,
  TB_BUDGETS,
  TB_SELLER_BY_BUDGETS,
  TB_BUDGET_ITEMS,
  DEFAULT_PRICE_ID,
} from './salesCommissionsFromInvoices.constants.js';

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
            /*
             * DISTINCT ON: um item de pedido entra uma vez só, mesmo que o
             * pedido tenha mais de uma NF-e (fica a mais recente). Sem isso o
             * ON CONFLICT (order_item_id) falha ao atualizar a mesma linha 2x.
             */
            SELECT DISTINCT ON (oi.order_item_id)
                ii.invoice_id,
                ii.order_id,
                oi.order_item_id,
                ii.issued_date AS issue_date,

                seller.seller_id,

                COALESCE(s.name, 'SEM VENDEDOR') AS seller_name,

                LEFT(COALESCE(oi.product_code::text, ''), 20) AS product_id,
                LEFT(COALESCE(oi.product_code::text, ''), 40) AS product_code,
                oi.product_code AS sku,

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
                    NULLIF(o.customer_name, ''),
                    NULLIF(ii.customer_name, ''),
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
                  AND TRIM(bi2.product_code::text) = TRIM(oi.product_code::text)
                ORDER BY bi2.budget_item_id DESC
                LIMIT 1
            ) bi ON true

            -- Um vendedor por orçamento (pode haver mais de um ativo)
            LEFT JOIN LATERAL (
                SELECT
                    NULLIF(regexp_replace(sb2.seller_id::text, '[^0-9]', '', 'g'), '')::int AS seller_id
                FROM ${TB_SELLER_BY_BUDGETS} sb2
                WHERE sb2.budget_id = o.budget_id
                  AND COALESCE(sb2.active, true) = true
                ORDER BY sb2.seller_id
                LIMIT 1
            ) sb ON true

            CROSS JOIN LATERAL (
                SELECT COALESCE(
                    sb.seller_id,
                    NULLIF(regexp_replace(b.seller_id::text, '[^0-9]', '', 'g'), '')::int,
                    NULLIF(regexp_replace(o.seller_id::text, '[^0-9]', '', 'g'), '')::int
                ) AS seller_id
            ) seller

            LEFT JOIN ${TB_SELLERS} s
                ON s.id = seller.seller_id

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

            ORDER BY oi.order_item_id, ii.issued_date DESC, ii.invoice_id DESC
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

