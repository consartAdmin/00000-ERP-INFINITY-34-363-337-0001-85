// ╔══════════════════════════════════════════════════════════════════════╗
// ║ salesAnalyticsApi.js — Sales Analytics Database API                ║
// ║ CONSART ERP                                                        ║
// ║                                                                      ║
// ║ ✅ Official sales source: invoicesIssued                             ║
// ║ ✅ Current-month default + custom date range                         ║
// ║ ✅ Total revenue                                                     ║
// ║ ✅ Total units                                                       ║
// ║ ✅ Total invoices/orders                                             ║
// ║ ✅ Average ticket                                                    ║
// ║ ✅ Curva ABC: Produtos                                              ║
// ║ ✅ Curva ABC: Clientes                                              ║
// ║ ✅ Sales by category                                                 ║
// ║ ✅ Sales by month                                                    ║
// ║ ✅ Quantity by month                                                 ║
// ║ ✅ Filter by customer UF                                             ║
// ║ ✅ Filter by product category                                        ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';


// ======================================================================
// TABLES
// ======================================================================

const TB_INVOICES =
    'public."invoicesIssued"';

const TB_ORDERS =
    'public."orders"';

const TB_ORDER_ITEMS =
    'public."ordersItems"';

const TB_BUDGETS =
    'public."budgets"';

const TB_BUDGET_ITEMS =
    'public."budgetsItems"';

const TB_PRODUCTS =
    'public."products"';

const TB_PRODUCT_GROUPS =
    'public."productsGroups"';

const TB_CUSTOMERS =
    'public."customers"';


// ======================================================================
// NF-E STATUSES THAT MUST NOT COUNT AS SALES
// ======================================================================

const NFE_EXCLUDED_STATUSES = [
    'CANCELADO',
    'CANCELADA',
    'CANCELLED',
    'DENIED',
    'REJEITADO',
    'REJEITADA',
    'REJECTED',
];


// ======================================================================
// HELPERS
// ======================================================================

function normalizeState(value) {
    return String(
        value || ''
    )
        .trim()
        .toUpperCase();
}


function normalizeCategory(value) {
    return String(
        value || ''
    ).trim();
}


function normalizeDate(value) {
    const text = String(value || '').trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return '';
    }

    const date = new Date(`${text}T00:00:00Z`);

    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text
        ? ''
        : text;
}


function currentMonthRange() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(new Date());
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const monthNumber = Number(parts.find((part) => part.type === 'month')?.value);
    const month = String(monthNumber).padStart(2, '0');
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

    return {
        startDate: `${year}-${month}-01`,
        endDate: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
    };
}


function normalizeDateRange(startDate, endDate) {
    const defaults = currentMonthRange();
    const start = normalizeDate(startDate) || defaults.startDate;
    const end = normalizeDate(endDate) || defaults.endDate;

    if (start > end) {
        const error = new Error('A data inicial não pode ser maior que a data final.');
        error.code = 'INVALID_DATE_RANGE';
        error.status = 400;
        throw error;
    }

    return { startDate: start, endDate: end };
}


function toNumber(value) {
    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : 0;
}


// ======================================================================
// MAIN
// ======================================================================

export async function loadSalesAnalytics({
    state = '',
    category = '',
    startDate = '',
    endDate = '',
} = {}) {

    // ------------------------------------------------------------------
    // NORMALIZE FILTERS
    // ------------------------------------------------------------------

    const normalizedRange = normalizeDateRange(startDate, endDate);

    const normalizedFilters = {
        state:
            normalizeState(
                state
            ),

        category:
            normalizeCategory(
                category
            ),

        startDate: normalizedRange.startDate,
        endDate: normalizedRange.endDate,
    };


    // ------------------------------------------------------------------
    // LOAD ANALYTICS IN PARALLEL
    // ------------------------------------------------------------------

    const [
        summary,
        abcProducts,
        abcCustomers,
        salesByCategory,
        salesByMonth,
        quantityByMonth,
    ] = await Promise.all([

        /*
         * Official source:
         * public."invoicesIssued"
         *
         * Expected values:
         * - totalRevenue
         * - totalUnits
         * - totalInvoices
         * - averageTicket
         */
        loadSummary(
            normalizedFilters
        ),


        /*
         * Product revenue based on issued and valid invoices.
         */
        loadAbcProducts(
            normalizedFilters
        ),


        /*
         * Customer revenue based on issued and valid invoices.
         */
        loadAbcCustomers(
            normalizedFilters
        ),


        loadSalesByCategory(
            normalizedFilters
        ),


        loadSalesByMonth(
            normalizedFilters
        ),


        loadQuantityByMonth(
            normalizedFilters
        ),

    ]);


    // ------------------------------------------------------------------
    // NORMALIZE RESPONSE
    // ------------------------------------------------------------------

    return {

        filters: normalizedFilters,

        summary: {
            totalRevenue:
                toNumber(
                    summary?.totalRevenue
                ),

            totalUnits:
                toNumber(
                    summary?.totalUnits
                ),

            totalInvoices:
                Number(
                    summary?.totalInvoices ||
                    0
                ),

            averageTicket:
                toNumber(
                    summary?.averageTicket
                ),

            topProduct:
                String(
                    summary?.topProduct ||
                    '—'
                ),
        },


        abcProducts:
            Array.isArray(
                abcProducts
            )
                ? abcProducts
                : [],


        abcCustomers:
            Array.isArray(
                abcCustomers
            )
                ? abcCustomers
                : [],


        salesByCategory:
            Array.isArray(
                salesByCategory
            )
                ? salesByCategory
                : [],


        salesByMonth:
            Array.isArray(
                salesByMonth
            )
                ? salesByMonth
                : [],


        quantityByMonth:
            Array.isArray(
                quantityByMonth
            )
                ? quantityByMonth
                : [],

    };
}

// ======================================================================
// SUMMARY
// ======================================================================

async function loadSummary({
    state,
    category,
    startDate,
    endDate,
}) {

    const sql = `
        WITH valid_invoices AS (

            SELECT
                ii.invoice_id,
                ii.order_id,
                ii.budget_id,
                ii.issued_date,
                COALESCE(ii.total_amount, 0)::numeric AS total_amount

            FROM ${TB_INVOICES} ii

            LEFT JOIN ${TB_ORDERS} o
                ON o.order_id = ii.order_id

            LEFT JOIN ${TB_CUSTOMERS} c
                ON c.customer_id = o.customer_id

            WHERE
                ii.issued_date IS NOT NULL

                AND ii.issued_date >= $4::date
                AND ii.issued_date < ($5::date + INTERVAL '1 day')

                AND ii.cancelled_at IS NULL

                AND UPPER(
                    COALESCE(
                        ii.nfe_status,
                        ''
                    )
                ) <> ALL($1::text[])

                AND (
                    $2::text = ''
                    OR UPPER(
                        COALESCE(
                            c.state,
                            ''
                        )
                    ) = $2
                )
        ),


        invoice_items AS (

            SELECT
                vi.invoice_id,
                vi.order_id,
                vi.budget_id,
                vi.issued_date,
                oi.product_code AS product_code,
                oi.description,
                COALESCE(oi.quantity, 0)::numeric AS quantity,
                COALESCE(oi.unit_price, 0)::numeric AS unit_price,
                COALESCE(oi.discount_value, 0)::numeric AS discount_value

            FROM valid_invoices vi

            JOIN ${TB_ORDER_ITEMS} oi
                ON oi.order_id = vi.order_id

            WHERE vi.order_id IS NOT NULL

            UNION ALL

            SELECT
                vi.invoice_id,
                vi.order_id,
                vi.budget_id,
                vi.issued_date,
                bi.product_code,
                bi.description,
                COALESCE(bi.quantity, 0)::numeric AS quantity,
                COALESCE(bi.unit_price, 0)::numeric AS unit_price,
                COALESCE(bi.discount_value, 0)::numeric AS discount_value

            FROM valid_invoices vi

            JOIN ${TB_BUDGET_ITEMS} bi
                ON bi.budget_id = vi.budget_id

            WHERE vi.budget_id IS NOT NULL
        ),


        filtered_items AS (

            SELECT
                vi.invoice_id,
                vi.order_id,
                vi.issued_date,

                si.product_code AS sku,
                si.description,

                COALESCE(
                    si.quantity,
                    0
                )::numeric AS quantity,

                COALESCE(
                    si.unit_price,
                    0
                )::numeric AS unit_price,

                COALESCE(
                    si.discount_value,
                    0
                )::numeric AS discount_value,

                (
                    COALESCE(
                        si.quantity,
                        0
                    )
                    *
                    COALESCE(
                        si.unit_price,
                        0
                    )
                    -
                    COALESCE(
                        si.discount_value,
                        0
                    )
                )::numeric AS item_total,

                p.product_id,
                p.product_code,
                p.product_group_id,

                COALESCE(
                    pg.name::text,
                    'SEM CATEGORIA'
                ) AS category_name

            FROM valid_invoices vi

            JOIN invoice_items si
                ON si.invoice_id = vi.invoice_id

            LEFT JOIN ${TB_PRODUCTS} p
                ON p.product_code = si.product_code

            LEFT JOIN ${TB_PRODUCT_GROUPS} pg
                ON pg.product_group_id =
                   p.product_group_id

            WHERE
                (
                    $3::text = ''

                    OR LOWER(
                        COALESCE(
                            pg.name::text,
                            ''
                        )
                    ) = LOWER($3)
                )
        ),


        selected_invoices AS (

            SELECT DISTINCT
                vi.invoice_id,
                vi.order_id,
                vi.total_amount

            FROM valid_invoices vi

            WHERE
                $3::text = ''

                OR EXISTS (

                    SELECT 1

                    FROM filtered_items fi

                    WHERE
                        fi.invoice_id =
                        vi.invoice_id
                )
        ),


        invoice_summary AS (

            SELECT
                COALESCE(
                    SUM(total_amount),
                    0
                )::numeric AS invoice_revenue,

                COUNT(*)::int AS total_orders

            FROM selected_invoices
        ),


        item_summary AS (

            SELECT
                COALESCE(
                    SUM(item_total),
                    0
                )::numeric AS item_revenue,

                COALESCE(
                    SUM(quantity),
                    0
                )::numeric AS total_units

            FROM filtered_items
        ),


        top_product AS (

            SELECT
                COALESCE(
                    NULLIF(
                        TRIM(fi.description),
                        ''
                    ),
                    fi.sku,
                    '—'
                ) AS product_name,

                COALESCE(
                    SUM(fi.item_total),
                    0
                )::numeric AS revenue

            FROM filtered_items fi

            GROUP BY
                fi.sku,
                fi.description

            ORDER BY
                revenue DESC,
                product_name ASC

            LIMIT 1
        )


        SELECT

            /*
             * Without a category filter we preserve the official
             * invoicesIssued.total_amount revenue.
             *
             * When filtering one category, only that category's
             * item totals can be used.
             */

            CASE

                WHEN $3::text = ''
                THEN COALESCE(
                    ins.invoice_revenue,
                    0
                )

                ELSE COALESCE(
                    its.item_revenue,
                    0
                )

            END AS total_revenue,


            COALESCE(
                its.total_units,
                0
            ) AS total_units,


            COALESCE(
                ins.total_orders,
                0
            ) AS total_orders,


            CASE

                WHEN COALESCE(
                    ins.total_orders,
                    0
                ) > 0

                THEN (

                    CASE

                        WHEN $3::text = ''
                        THEN COALESCE(
                            ins.invoice_revenue,
                            0
                        )

                        ELSE COALESCE(
                            its.item_revenue,
                            0
                        )

                    END

                    /

                    ins.total_orders

                )

                ELSE 0

            END AS average_ticket,


            COALESCE(
                tp.product_name,
                '—'
            ) AS top_product


        FROM invoice_summary ins

        CROSS JOIN item_summary its

        LEFT JOIN top_product tp
            ON TRUE
    `;


    const { rows } =
        await pool.query(
            sql,
            [
                NFE_EXCLUDED_STATUSES,
                state,
                category,
                startDate,
                endDate,
            ]
        );


    const row =
        rows[0] || {};


    return {

        totalRevenue:
            toNumber(
                row.total_revenue
            ),

        totalUnits:
            toNumber(
                row.total_units
            ),

        totalInvoices:
            Number(
                row.total_orders || 0
            ),

        // Backward compatibility
        totalOrders:
            Number(
                row.total_orders || 0
            ),

        averageTicket:
            toNumber(
                row.average_ticket
            ),

        topProduct:
            String(
                row.top_product ||
                '—'
            ),
    };
}


// ======================================================================
// CURVA ABC — PRODUCTS
// ======================================================================

async function loadAbcProducts({
    state,
    category,
    startDate,
    endDate,
}) {
    const sql = `
        WITH valid_invoices AS (
            SELECT
                ii.invoice_id,
                ii.order_id,
                ii.budget_id

            FROM ${TB_INVOICES} ii

            WHERE
                ii.issued_date IS NOT NULL
                AND ii.issued_date >= $4::date
                AND ii.issued_date < ($5::date + INTERVAL '1 day')
                AND ii.cancelled_at IS NULL
                AND UPPER(COALESCE(ii.nfe_status, ''))
                    <> ALL($1::text[])
        ),

        invoice_items AS (
            SELECT
                vi.invoice_id,
                o.customer_id,
                oi.product_code AS product_code,
                oi.description,
                COALESCE(oi.quantity, 0)::numeric AS quantity,
                COALESCE(oi.unit_price, 0)::numeric AS unit_price,
                COALESCE(oi.discount_value, 0)::numeric AS discount_value

            FROM valid_invoices vi
            JOIN ${TB_ORDERS} o ON o.order_id = vi.order_id
            JOIN ${TB_ORDER_ITEMS} oi ON oi.order_id = vi.order_id

            WHERE vi.order_id IS NOT NULL

            UNION ALL

            SELECT
                vi.invoice_id,
                b.customer_id,
                bi.product_code,
                bi.description,
                COALESCE(bi.quantity, 0)::numeric AS quantity,
                COALESCE(bi.unit_price, 0)::numeric AS unit_price,
                COALESCE(bi.discount_value, 0)::numeric AS discount_value

            FROM valid_invoices vi
            JOIN ${TB_BUDGETS} b ON b.budget_id = vi.budget_id
            JOIN ${TB_BUDGET_ITEMS} bi ON bi.budget_id = vi.budget_id

            WHERE vi.budget_id IS NOT NULL
        ),

        product_sales AS (
            SELECT
                CONCAT_WS(
                    ' - ',
                    NULLIF(TRIM(p.manufacturer_ref), ''),
                    COALESCE(
                        NULLIF(TRIM(si.description), ''),
                        NULLIF(TRIM(si.product_code), ''),
                        'SEM PRODUTO'
                    )
                ) AS label,

                COALESCE(
                    SUM(
                        (si.quantity * si.unit_price)
                        - si.discount_value
                    ),
                    0
                )::numeric AS value

            FROM invoice_items si

            LEFT JOIN ${TB_CUSTOMERS} c
                ON c.customer_id = si.customer_id

            LEFT JOIN ${TB_PRODUCTS} p
                ON p.product_code = si.product_code

            LEFT JOIN ${TB_PRODUCT_GROUPS} pg
                ON pg.product_group_id = p.product_group_id

            WHERE
                (
                    $2::text = ''
                    OR UPPER(COALESCE(c.state, '')) = $2
                )
                AND (
                    $3::text = ''
                    OR LOWER(COALESCE(pg.name::text, '')) = LOWER($3)
                )

            GROUP BY
                si.product_code,
                si.description,
                p.manufacturer_ref
        ),

        ranked AS (
            SELECT
                label,
                value,
                COALESCE(
                    value / NULLIF(SUM(value) OVER (), 0) * 100,
                    0
                ) AS percentage,
                COALESCE(
                    SUM(value) OVER (
                        ORDER BY value DESC, label ASC
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) / NULLIF(SUM(value) OVER (), 0) * 100,
                    0
                ) AS accumulated
            FROM product_sales
            WHERE value > 0
        )

        SELECT
            label,
            value,
            percentage,
            accumulated,
            CASE
                WHEN accumulated <= 80 THEN 'A'
                WHEN accumulated <= 95 THEN 'B'
                ELSE 'C'
            END AS class
        FROM ranked
        ORDER BY value DESC, label ASC
    `;

    const { rows } = await pool.query(sql, [
        NFE_EXCLUDED_STATUSES,
        state,
        category,
        startDate,
        endDate,
    ]);

    return rows.map((row) => ({
        label: String(row.label || 'SEM PRODUTO'),
        value: toNumber(row.value),
        percentage: toNumber(row.percentage),
        accumulated: toNumber(row.accumulated),
        class: String(row.class || '').toUpperCase(),
    }));
}


// ======================================================================
// CURVA ABC — CUSTOMERS
// ======================================================================

async function loadAbcCustomers({
    state,
    category,
    startDate,
    endDate,
}) {
    const sql = `
        WITH invoice_base AS (
            SELECT
                ii.invoice_id,
                ii.order_id,
                ii.budget_id,
                COALESCE(
                    o.customer_id,
                    b.customer_id
                ) AS customer_id,
                COALESCE(
                    COALESCE(o.customer_id, b.customer_id)::text,
                    NULLIF(TRIM(ii.customer_tax_id), ''),
                    'INVOICE-' || ii.invoice_id::text
                ) AS customer_key,
                COALESCE(
                    NULLIF(TRIM(ii.customer_name), ''),
                    NULLIF(TRIM(c.legal_name), ''),
                    NULLIF(TRIM(c.trade_name), ''),
                    'CLIENTE NÃO INFORMADO'
                ) AS label,
                COALESCE(ii.total_amount, 0)::numeric AS total_amount

            FROM ${TB_INVOICES} ii

            LEFT JOIN ${TB_ORDERS} o
                ON o.order_id = ii.order_id

            LEFT JOIN ${TB_BUDGETS} b
                ON b.budget_id = ii.budget_id

            LEFT JOIN ${TB_CUSTOMERS} c
                ON c.customer_id = COALESCE(o.customer_id, b.customer_id)

            WHERE
                ii.issued_date IS NOT NULL
                AND ii.issued_date >= $4::date
                AND ii.issued_date < ($5::date + INTERVAL '1 day')
                AND ii.cancelled_at IS NULL
                AND UPPER(COALESCE(ii.nfe_status, ''))
                    <> ALL($1::text[])
                AND (
                    $2::text = ''
                    OR UPPER(COALESCE(c.state, '')) = $2
                )
        ),

        invoice_items AS (
            SELECT
                ib.invoice_id,
                oi.product_code AS product_code,
                COALESCE(oi.quantity, 0)::numeric AS quantity,
                COALESCE(oi.unit_price, 0)::numeric AS unit_price,
                COALESCE(oi.discount_value, 0)::numeric AS discount_value

            FROM invoice_base ib
            JOIN ${TB_ORDER_ITEMS} oi ON oi.order_id = ib.order_id

            WHERE ib.order_id IS NOT NULL

            UNION ALL

            SELECT
                ib.invoice_id,
                bi.product_code,
                COALESCE(bi.quantity, 0)::numeric AS quantity,
                COALESCE(bi.unit_price, 0)::numeric AS unit_price,
                COALESCE(bi.discount_value, 0)::numeric AS discount_value

            FROM invoice_base ib
            JOIN ${TB_BUDGET_ITEMS} bi ON bi.budget_id = ib.budget_id

            WHERE ib.budget_id IS NOT NULL
        ),

        customer_invoice_values AS (
            SELECT
                ib.invoice_id,
                ib.customer_key,
                ib.label,
                ib.total_amount AS value

            FROM invoice_base ib

            WHERE $3::text = ''

            UNION ALL

            SELECT
                ib.invoice_id,
                ib.customer_key,
                ib.label,
                COALESCE(
                    SUM((items.quantity * items.unit_price) - items.discount_value),
                    0
                )::numeric AS value

            FROM invoice_base ib
            JOIN invoice_items items ON items.invoice_id = ib.invoice_id
            LEFT JOIN ${TB_PRODUCTS} p ON p.product_code = items.product_code
            LEFT JOIN ${TB_PRODUCT_GROUPS} pg
                ON pg.product_group_id = p.product_group_id

            WHERE
                $3::text <> ''
                AND LOWER(COALESCE(pg.name::text, '')) = LOWER($3)

            GROUP BY
                ib.invoice_id,
                ib.customer_key,
                ib.label
        ),

        customer_sales AS (
            SELECT
                customer_key,
                label,
                COALESCE(SUM(value), 0)::numeric AS value

            FROM customer_invoice_values

            GROUP BY customer_key, label
        ),

        ranked AS (
            SELECT
                label,
                value,
                COALESCE(
                    value / NULLIF(SUM(value) OVER (), 0) * 100,
                    0
                ) AS percentage,
                COALESCE(
                    SUM(value) OVER (
                        ORDER BY value DESC, label ASC
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) / NULLIF(SUM(value) OVER (), 0) * 100,
                    0
                ) AS accumulated
            FROM customer_sales
            WHERE value > 0
        )

        SELECT
            label,
            value,
            percentage,
            accumulated,
            CASE
                WHEN accumulated <= 80 THEN 'A'
                WHEN accumulated <= 95 THEN 'B'
                ELSE 'C'
            END AS class
        FROM ranked
        ORDER BY value DESC, label ASC
    `;

    const { rows } = await pool.query(sql, [
        NFE_EXCLUDED_STATUSES,
        state,
        category,
        startDate,
        endDate,
    ]);

    return rows.map((row) => ({
        label: String(row.label || 'SEM CLIENTE'),
        value: toNumber(row.value),
        percentage: toNumber(row.percentage),
        accumulated: toNumber(row.accumulated),
        class: String(row.class || '').toUpperCase(),
    }));
}


// ======================================================================
// SALES BY CATEGORY
// ======================================================================

async function loadSalesByCategory({
    state,
    category,
    startDate,
    endDate,
}) {

    const sql = `
        SELECT

            COALESCE(
                pg.name::text,
                'SEM CATEGORIA'
            ) AS label,

            COALESCE(
                SUM(
                    (
                        COALESCE(
                            oi.quantity,
                            0
                        )
                        *
                        COALESCE(
                            oi.unit_price,
                            0
                        )
                    )
                    -
                    COALESCE(
                        oi.discount_value,
                        0
                    )
                ),
                0
            )::numeric AS value


        FROM ${TB_INVOICES} ii


        JOIN ${TB_ORDERS} o
            ON o.order_id =
               ii.order_id


        LEFT JOIN ${TB_CUSTOMERS} c
            ON c.customer_id =
               o.customer_id


        JOIN ${TB_ORDER_ITEMS} oi
            ON oi.order_id =
               o.order_id


        LEFT JOIN ${TB_PRODUCTS} p
            ON p.product_code =
               oi.product_code


        LEFT JOIN ${TB_PRODUCT_GROUPS} pg
            ON pg.product_group_id =
               p.product_group_id


        WHERE

            ii.order_id IS NOT NULL

            AND ii.issued_date IS NOT NULL

            AND ii.issued_date >= $4::date
            AND ii.issued_date < ($5::date + INTERVAL '1 day')

            AND ii.cancelled_at IS NULL

            AND UPPER(
                COALESCE(
                    ii.nfe_status,
                    ''
                )
            ) <> ALL($1::text[])


            /* UF */

            AND (
                $2::text = ''

                OR UPPER(
                    COALESCE(
                        c.state,
                        ''
                    )
                ) = $2
            )


            /* CATEGORY */

            AND (
                $3::text = ''

                OR LOWER(
                    COALESCE(
                        pg.name::text,
                        ''
                    )
                ) = LOWER($3)
            )


        GROUP BY
            pg.product_group_id,
            pg.name


        ORDER BY
            value DESC,
            label ASC
    `;


    const { rows } =
        await pool.query(
            sql,
            [
                NFE_EXCLUDED_STATUSES,
                state,
                category,
                startDate,
                endDate,
            ]
        );


    return rows.map(
        (row) => ({

            label:
                String(
                    row.label ||
                    'SEM CATEGORIA'
                ),

            value:
                toNumber(
                    row.value
                ),
        })
    );
}


// ======================================================================
// SALES BY MONTH
// ======================================================================

async function loadSalesByMonth({
    state,
    category,
    startDate,
    endDate,
}) {

    /*
     * Creates all 12 months even when there are no sales.
     */

    const sql = `
        WITH months AS (

            SELECT
                generate_series(
                    1,
                    12
                )::int AS month_number
        ),


        valid_invoices AS (

            SELECT
                ii.invoice_id,
                ii.order_id,
                ii.issued_date,

                COALESCE(
                    ii.total_amount,
                    0
                )::numeric AS total_amount

            FROM ${TB_INVOICES} ii

            JOIN ${TB_ORDERS} o
                ON o.order_id =
                   ii.order_id

            LEFT JOIN ${TB_CUSTOMERS} c
                ON c.customer_id =
                   o.customer_id

            WHERE

                ii.order_id IS NOT NULL

                AND ii.issued_date IS NOT NULL

                AND ii.issued_date >= $4::date
                AND ii.issued_date < ($5::date + INTERVAL '1 day')

                AND ii.cancelled_at IS NULL

                AND UPPER(
                    COALESCE(
                        ii.nfe_status,
                        ''
                    )
                ) <> ALL($1::text[])

                AND (
                    $2::text = ''

                    OR UPPER(
                        COALESCE(
                            c.state,
                            ''
                        )
                    ) = $2
                )
        ),


        invoice_monthly AS (

            SELECT

                EXTRACT(
                    MONTH FROM issued_date
                )::int AS month_number,

                COALESCE(
                    SUM(total_amount),
                    0
                )::numeric AS value

            FROM valid_invoices

            GROUP BY
                EXTRACT(
                    MONTH FROM issued_date
                )
        ),


        category_monthly AS (

            SELECT

                EXTRACT(
                    MONTH FROM vi.issued_date
                )::int AS month_number,

                COALESCE(
                    SUM(
                        (
                            COALESCE(
                                oi.quantity,
                                0
                            )
                            *
                            COALESCE(
                                oi.unit_price,
                                0
                            )
                        )
                        -
                        COALESCE(
                            oi.discount_value,
                            0
                        )
                    ),
                    0
                )::numeric AS value

            FROM valid_invoices vi

            JOIN ${TB_ORDER_ITEMS} oi
                ON oi.order_id =
                   vi.order_id

            LEFT JOIN ${TB_PRODUCTS} p
                ON p.product_code =
                   oi.product_code

            LEFT JOIN ${TB_PRODUCT_GROUPS} pg
                ON pg.product_group_id =
                   p.product_group_id

            WHERE

                $3::text <> ''

                AND LOWER(
                    COALESCE(
                        pg.name::text,
                        ''
                    )
                ) = LOWER($3)

            GROUP BY
                EXTRACT(
                    MONTH FROM vi.issued_date
                )
        )


        SELECT

            m.month_number,

            CASE m.month_number
                WHEN 1  THEN 'Jan'
                WHEN 2  THEN 'Fev'
                WHEN 3  THEN 'Mar'
                WHEN 4  THEN 'Abr'
                WHEN 5  THEN 'Mai'
                WHEN 6  THEN 'Jun'
                WHEN 7  THEN 'Jul'
                WHEN 8  THEN 'Ago'
                WHEN 9  THEN 'Set'
                WHEN 10 THEN 'Out'
                WHEN 11 THEN 'Nov'
                WHEN 12 THEN 'Dez'
            END AS month,

            CASE

                WHEN $3::text = ''

                THEN COALESCE(
                    im.value,
                    0
                )

                ELSE COALESCE(
                    cm.value,
                    0
                )

            END::numeric AS value


        FROM months m


        LEFT JOIN invoice_monthly im
            ON im.month_number =
               m.month_number


        LEFT JOIN category_monthly cm
            ON cm.month_number =
               m.month_number


        ORDER BY
            m.month_number
    `;


    const { rows } =
        await pool.query(
            sql,
            [
                NFE_EXCLUDED_STATUSES,
                state,
                category,
                startDate,
                endDate,
            ]
        );


    return rows.map(
        (row) => ({

            month:
                String(
                    row.month ||
                    ''
                ),

            value:
                toNumber(
                    row.value
                ),
        })
    );
}


// ======================================================================
// QUANTITY SOLD BY MONTH
// ======================================================================

async function loadQuantityByMonth({
    state,
    category,
    startDate,
    endDate,
}) {

    const sql = `
        WITH months AS (

            SELECT
                generate_series(
                    1,
                    12
                )::int AS month_number
        ),


        monthly_quantity AS (

            SELECT

                EXTRACT(
                    MONTH FROM ii.issued_date
                )::int AS month_number,

                COALESCE(
                    SUM(
                        oi.quantity
                    ),
                    0
                )::numeric AS quantity


            FROM ${TB_INVOICES} ii


            JOIN ${TB_ORDERS} o
                ON o.order_id =
                   ii.order_id


            LEFT JOIN ${TB_CUSTOMERS} c
                ON c.customer_id =
                   o.customer_id


            JOIN ${TB_ORDER_ITEMS} oi
                ON oi.order_id =
                   o.order_id


            LEFT JOIN ${TB_PRODUCTS} p
                ON p.product_code =
                   oi.product_code


            LEFT JOIN ${TB_PRODUCT_GROUPS} pg
                ON pg.product_group_id =
                   p.product_group_id


            WHERE

                ii.order_id IS NOT NULL

                AND ii.issued_date IS NOT NULL

                AND ii.issued_date >= $4::date
                AND ii.issued_date < ($5::date + INTERVAL '1 day')

                AND ii.cancelled_at IS NULL

                AND UPPER(
                    COALESCE(
                        ii.nfe_status,
                        ''
                    )
                ) <> ALL($1::text[])


                /* UF */

                AND (
                    $2::text = ''

                    OR UPPER(
                        COALESCE(
                            c.state,
                            ''
                        )
                    ) = $2
                )


                /* CATEGORY */

                AND (
                    $3::text = ''

                    OR LOWER(
                        COALESCE(
                            pg.name::text,
                            ''
                        )
                    ) = LOWER($3)
                )


            GROUP BY
                EXTRACT(
                    MONTH FROM ii.issued_date
                )
        )


        SELECT

            m.month_number,

            CASE m.month_number
                WHEN 1  THEN 'Jan'
                WHEN 2  THEN 'Fev'
                WHEN 3  THEN 'Mar'
                WHEN 4  THEN 'Abr'
                WHEN 5  THEN 'Mai'
                WHEN 6  THEN 'Jun'
                WHEN 7  THEN 'Jul'
                WHEN 8  THEN 'Ago'
                WHEN 9  THEN 'Set'
                WHEN 10 THEN 'Out'
                WHEN 11 THEN 'Nov'
                WHEN 12 THEN 'Dez'
            END AS month,

            COALESCE(
                mq.quantity,
                0
            )::numeric AS quantity


        FROM months m


        LEFT JOIN monthly_quantity mq
            ON mq.month_number =
               m.month_number


        ORDER BY
            m.month_number
    `;


    const { rows } =
        await pool.query(
            sql,
            [
                NFE_EXCLUDED_STATUSES,
                state,
                category,
                startDate,
                endDate,
            ]
        );


    return rows.map(
        (row) => ({

            month:
                String(
                    row.month ||
                    ''
                ),

            quantity:
                toNumber(
                    row.quantity
                ),
        })
    );
}
