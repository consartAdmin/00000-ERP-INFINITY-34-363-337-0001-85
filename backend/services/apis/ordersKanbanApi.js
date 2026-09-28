// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ 📦 ordersKanbanApi.js – DAL / Service do Kanban de Pedidos (ESM)        ║
// ║ Camada de acesso a dados para:                                          ║
// ║   - Cards (ordersKanbanCards)                                           ║
// ║   - Colunas (ordersKanbanColumns)                                       ║
// ║   - Pendências (ordersKanbanPendingItems)                               ║
// ║   - Clientes (customers)                                                ║
// ║   - Produtos (products)                                                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

// ────────────────────────────────────────────────────────────────────────────
// Tabelas
// ────────────────────────────────────────────────────────────────────────────
const TB_CARDS = 'public."ordersKanbanCards"';
const TB_COLUMNS = 'public."ordersKanbanColumns"';
const TB_PENDINGS = 'public."ordersKanbanPendingItems"';
const TB_BARCODES = 'public."productsBarCode"';
const TB_CUSTOMERS = 'public."customers"';
const TB_PRODUCTS = 'public."products"';
const TB_BUDGETS = 'public."budgets"';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

// Mapeia status do card para o nome da coluna (compatibilidade)
const STATUS_TO_COLUMN = `
  CASE
    WHEN k.status IN ('Enviado/Recebido')         THEN 'Enviado/Recebido'
    WHEN k.status IN ('Em Separação')             THEN 'Em Separação'
    WHEN k.status IN ('Faturado','Faturados')     THEN 'Faturados'
    WHEN k.status IN ('Em Rota')                  THEN 'Em Rota'
    WHEN k.status IN ('Entregue')                 THEN 'Entregue'
    WHEN k.status IN ('Pendências Pós Entregas')  THEN 'Pendências Pós Entregas'
    ELSE k.status
  END
`;

// Normaliza texto (sem acento + lower)
const NORM_PENDING_STATUS = `
  lower(
    translate(
      coalesce(p.status,''),
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'
    )
  )
`;

// ✅ Classificação canônica OPEN (aceita aberto/aberta/pendente/pending/open…)
const IS_OPEN_PENDING = `
  (
    ${NORM_PENDING_STATUS} IN (
      'aberto','aberta','abertos','abertas',
      'pendente','pendentes',
      'pending','open'
    )
    OR ${NORM_PENDING_STATUS} LIKE 'abert%'
    OR ${NORM_PENDING_STATUS} LIKE 'pend%'
    OR ${NORM_PENDING_STATUS} LIKE 'open%'
  )
`;

// ✅ Classificação canônica DONE (aceita concluído/finalizado/completed/done…)
const IS_DONE_PENDING = `
  (
    ${NORM_PENDING_STATUS} IN (
      'concluido','concluida','concluidos','concluidas',
      'finalizado','finalizada','finalizados','finalizadas',
      'completed','done'
    )
    OR ${NORM_PENDING_STATUS} LIKE 'conclu%'
    OR ${NORM_PENDING_STATUS} LIKE 'finaliz%'
    OR ${NORM_PENDING_STATUS} LIKE 'comp%'
    OR ${NORM_PENDING_STATUS} LIKE 'done%'
  )
`;

// Pendência → produto / unidade (código de barras)
const PRODUCT_JOIN = 'pr.product_code = p.product_code';
const BARCODE_JOIN = 'b.barcode_id = p.barcode_id';

// ===========================================================================
// 🩺 Health
// ===========================================================================
export async function pingDb() {
  await pool.query('SELECT 1');
  return { ok: true };
}

// ===========================================================================
// 📦 CARDS
// ===========================================================================
export async function listCards() {
  const sql = `
    SELECT
      k.card_id,
      k.customer_id,
      k.separation_number,
      k.note,
      k.status,
      k.created_at,
      k.is_urgent,
      k.is_finished,
      k.finished_at,

      s.column_id,
      s.name       AS column_name,
      s.sort_order AS column_order,

      c.trade_name AS customer_name,
      c.tax_id     AS customer_tax_id
    FROM ${TB_CARDS} k
    LEFT JOIN ${TB_CUSTOMERS} c
           ON c.customer_id = k.customer_id
    LEFT JOIN ${TB_COLUMNS} s
           ON s.name = ${STATUS_TO_COLUMN}
    WHERE (s.column_type IN ('orders','pedidos') OR s.column_id IS NULL)
      AND COALESCE(k.is_finished, false) = false
    ORDER BY s.sort_order NULLS LAST, k.card_id DESC;
  `;
  const { rows } = await pool.query(sql);
  return rows;
}

export async function createCard({ customer_id, separation_number, note, status }) {
  if (!customer_id || !status) throw new Error('customer_id e status são obrigatórios.');

  const sql = `
    INSERT INTO ${TB_CARDS} (
      customer_id,
      separation_number,
      note,
      status,
      created_at,
      updated_at,
      is_urgent,
      is_finished
    )
    VALUES ($1, $2, $3, $4, NOW(), NOW(), false, false)
    RETURNING *;
  `;
  const values = [customer_id, separation_number ?? null, note ?? null, status];
  const { rows } = await pool.query(sql, values);
  return rows[0];
}

// ✅ Editar card (cliente, nº separação, observação)
export async function updateCard(cardId, { customer_id, separation_number, note } = {}) {
  const id = Number(cardId);
  const customerId = Number(customer_id);

  if (!id || Number.isNaN(id)) throw new Error('cardId inválido');
  if (!Number.isInteger(customerId) || customerId <= 0) {
    const err = new Error('Cliente obrigatório.');
    err.statusCode = 400;
    throw err;
  }

  const { rows, rowCount } = await pool.query(
    `UPDATE ${TB_CARDS}
        SET customer_id       = $2,
            separation_number = $3,
            note              = $4,
            updated_at        = NOW()
      WHERE card_id = $1
    RETURNING *`,
    [
      id,
      customerId,
      String(separation_number ?? '').trim() || null,
      String(note ?? '').trim() || null,
    ]
  );
  if (!rowCount) return null;
  return rows[0];
}

// ✅ Importa um orçamento como card (Nº Separação = "ORÇ.: <budget_id>")
export async function createCardFromBudget(budgetId) {
  const id = Number(budgetId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('budget_id inválido.');
    err.statusCode = 400;
    throw err;
  }

  const { rows: budgets } = await pool.query(
    `SELECT budget_id, customer_id, customer_name, notes
       FROM ${TB_BUDGETS}
      WHERE budget_id = $1`,
    [id]
  );
  const budget = budgets[0];

  if (!budget) {
    const err = new Error(`Orçamento ${id} não encontrado.`);
    err.statusCode = 404;
    throw err;
  }

  if (!budget.customer_id) {
    const err = new Error(`O orçamento ${id} não possui cliente cadastrado.`);
    err.statusCode = 400;
    throw err;
  }

  // Já existe card em aberto para este orçamento? (aceita "ORÇ.: 1177", "ORÇ. : 1177", "ORÇ. 1177"…)
  const { rows: dup } = await pool.query(
    `SELECT card_id, status
       FROM ${TB_CARDS}
      WHERE COALESCE(is_finished, false) = false
        AND separation_number ILIKE 'OR%'
        AND regexp_replace(separation_number, '[^0-9]', '', 'g') = $1
      LIMIT 1`,
    [String(id)]
  );
  if (dup[0]) {
    const err = new Error(`O orçamento ${id} já está no Kanban (card #${dup[0].card_id}, coluna "${dup[0].status}").`);
    err.statusCode = 409;
    throw err;
  }

  const { rows: cols } = await pool.query(
    `SELECT name
       FROM ${TB_COLUMNS}
      WHERE column_type IN ('orders','pedidos')
      ORDER BY sort_order
      LIMIT 1`
  );

  return createCard({
    customer_id: budget.customer_id,
    separation_number: `ORÇ.: ${id}`,
    note: budget.notes || null,
    status: cols[0]?.name || 'Enviado/Recebido',
  });
}

export async function moveCardToColumn({ cardId, columnId }) {
  const sql = `
    UPDATE ${TB_CARDS} k
       SET status = s.name,
           updated_at = NOW()
      FROM ${TB_COLUMNS} s
     WHERE k.card_id = $1
       AND s.column_id = $2
    RETURNING
      k.*,
      s.column_id,
      s.name       AS column_name,
      s.sort_order AS column_order;
  `;
  const { rows, rowCount } = await pool.query(sql, [Number(cardId), Number(columnId)]);
  if (!rowCount) return null;
  return rows[0];
}

export async function deleteCard(cardId) {
  const { rowCount } = await pool.query(`DELETE FROM ${TB_CARDS} WHERE card_id = $1`, [Number(cardId)]);
  return rowCount > 0;
}

export async function setCardUrgent({ cardId, isUrgent }) {
  const { rows, rowCount } = await pool.query(
    `UPDATE ${TB_CARDS}
        SET is_urgent = $1,
            updated_at = NOW()
      WHERE card_id = $2
    RETURNING card_id, is_urgent`,
    [!!isUrgent, Number(cardId)]
  );
  if (!rowCount) return null;
  return rows[0];
}

export async function countOpenPendingsByCard(cardId) {
  const id = Number(cardId);
  if (!id || Number.isNaN(id)) throw new Error('cardId inválido');

  const sql = `
    SELECT COUNT(*)::int AS total
    FROM ${TB_PENDINGS} p
    WHERE p.card_id = $1
      AND NOT (${IS_DONE_PENDING});
  `;

  const { rows } = await pool.query(sql, [id]);
  return rows[0]?.total ?? 0;
}

export async function finishCard(cardId) {
  const id = Number(cardId);
  if (!id || Number.isNaN(id)) throw new Error('cardId inválido');

  const openPendings = await countOpenPendingsByCard(id);

  if (openPendings > 0) {
    const err = new Error(
      `Este card possui ${openPendings} pendência(s) aberta(s) e não pode ser finalizado.`
    );
    err.statusCode = 409;
    err.code = 'CARD_HAS_OPEN_PENDINGS';
    err.openPendings = openPendings;
    throw err;
  }

  const sql = `
    UPDATE ${TB_CARDS}
       SET is_finished  = true,
           finished_at  = NOW(),
           updated_at   = NOW()
     WHERE card_id = $1
       AND COALESCE(is_finished, false) = false
    RETURNING card_id, is_finished, finished_at;
  `;

  const { rows, rowCount } = await pool.query(sql, [id]);

  if (!rowCount) return null;

  return rows[0];
}

export async function countFinished({ period } = {}) {
  let where = 'COALESCE(is_finished,false) = true';

  if (period === 'today' || period === 'hoje') {
    where += ' AND finished_at::date = CURRENT_DATE';
  } else if (period === 'month' || period === 'mes') {
    where += " AND date_trunc('month', finished_at) = date_trunc('month', CURRENT_DATE)";
  } else if (period === 'year' || period === 'ano') {
    where += " AND date_trunc('year', finished_at) = date_trunc('year', CURRENT_DATE)";
  }

  const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM ${TB_CARDS} WHERE ${where}`);
  return rows[0]?.total ?? 0;
}

// ===========================================================================
// 📊 COLUNAS / STATUS
// ===========================================================================
export async function listColumns() {
  const sql = `
    SELECT
      column_id   AS id,
      name        AS status,
      sort_order  AS ordem
    FROM ${TB_COLUMNS}
    WHERE column_type IN ('orders','pedidos')
    ORDER BY sort_order;
  `;
  const { rows } = await pool.query(sql);
  return rows;
}

export async function listColumnsWithCounts() {
  const sql = `
    SELECT
      s.column_id               AS id,
      s.name                    AS status,
      s.sort_order              AS ordem,
      COUNT(DISTINCT k.card_id) AS qtde_cards,

      COALESCE(SUM(CASE WHEN ${IS_OPEN_PENDING} THEN 1 ELSE 0 END), 0)  AS pendencias_abertas,
      COALESCE(SUM(CASE WHEN ${IS_DONE_PENDING} THEN 1 ELSE 0 END), 0)  AS pendencias_concluidas

    FROM ${TB_COLUMNS} s
    LEFT JOIN ${TB_CARDS} k
           ON ${STATUS_TO_COLUMN} = s.name
          AND COALESCE(k.is_finished,false) = false
    LEFT JOIN ${TB_PENDINGS} p
           ON p.card_id = k.card_id
    WHERE s.column_type IN ('orders','pedidos')
    GROUP BY s.column_id, s.name, s.sort_order
    ORDER BY s.sort_order;
  `;
  const { rows } = await pool.query(sql);
  return rows;
}

// ===========================================================================
// 📌 PENDÊNCIAS
// ===========================================================================

// ✅ Pendências de um card (com filtro pendentes|concluidas|todas)
export async function getPendingsByCard(cardId, pendencias = 'todas') {
  const safeCardId = Number(cardId);
  if (!safeCardId || Number.isNaN(safeCardId)) throw new Error('cardId inválido');

  const filtros = ['p.card_id = $1'];
  const params = [safeCardId];

  const f = String(pendencias || 'todas').toLowerCase();
  if (f.startsWith('pend')) filtros.push(IS_OPEN_PENDING);
  else if (f.startsWith('concl')) filtros.push(IS_DONE_PENDING);

  const sql = `
    SELECT
      p.pending_id,
      p.card_id,
      p.product_code,
      p.barcode_id,
      p.quantity,
      p.note,
      p.status,
      p.created_at,
      p.updated_at,
      pr.product_id,
      COALESCE(pr.description, '-') AS product_description,
      b.unit,
      b.fator,
      b.barcode
    FROM ${TB_PENDINGS} p
    LEFT JOIN ${TB_PRODUCTS} pr
           ON ${PRODUCT_JOIN}
    LEFT JOIN ${TB_BARCODES} b
           ON ${BARCODE_JOIN}
    WHERE ${filtros.join(' AND ')}
    ORDER BY p.created_at DESC;
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

// ✅ Marcar como concluído (padroniza para 'concluido')
export async function completePending(pendingId) {
  const id = Number(pendingId);
  if (!id || Number.isNaN(id)) throw new Error('pendingId inválido');

  const sql = `
    UPDATE ${TB_PENDINGS}
       SET status = 'concluido',
           updated_at = NOW()
     WHERE pending_id = $1
     RETURNING *;
  `;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

// ✅ Reabrir pendência concluída (volta para 'aberto')
export async function reopenPending(pendingId) {
  const id = Number(pendingId);
  if (!id || Number.isNaN(id)) throw new Error('pendingId inválido');

  const sql = `
    UPDATE ${TB_PENDINGS}
       SET status = 'aberto',
           updated_at = NOW()
     WHERE pending_id = $1
     RETURNING *;
  `;
  const { rows } = await pool.query(sql, [id]);
  return rows[0] || null;
}

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// Valida produto / unidade / quantidade (usado no adicionar e no editar)
async function normalizePendingItem({ productCode, barcodeId, quantity, note }) {
  const code = String(productCode ?? '').trim();
  const q = Number(quantity);
  const bId = barcodeId == null || barcodeId === '' ? null : Number(barcodeId);

  if (!code) throw badRequest('product_code obrigatório');
  if (!Number.isInteger(q) || q <= 0) throw badRequest('quantity deve ser um inteiro maior que zero');
  if (bId !== null && (!Number.isInteger(bId) || bId <= 0)) throw badRequest('barcode_id inválido');

  // a unidade precisa pertencer ao produto escolhido
  if (bId !== null) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM ${TB_BARCODES} WHERE barcode_id = $1 AND product_code = $2`,
      [bId, code]
    );
    if (!rowCount) throw badRequest('barcode_id não pertence ao produto informado');
  }

  return { code, bId, q, note: String(note ?? '').trim() || null };
}

// ✅ Editar pendência (somente abertas)
export async function updatePending(pendingId, { productCode, barcodeId, quantity, note } = {}) {
  const id = Number(pendingId);
  if (!id || Number.isNaN(id)) throw badRequest('pendingId inválido');

  const item = await normalizePendingItem({ productCode, barcodeId, quantity, note });

  const sql = `
    UPDATE ${TB_PENDINGS} p
       SET product_code = $2,
           barcode_id   = $3,
           quantity     = $4,
           note         = $5,
           updated_at   = NOW()
     WHERE p.pending_id = $1
       AND NOT (${IS_DONE_PENDING})
    RETURNING *;
  `;
  const { rows } = await pool.query(sql, [id, item.code, item.bId, item.q, item.note]);
  return rows[0] || null;
}

// ✅ Adicionar pendência (padroniza default para 'aberto')
export async function addPending({ cardId, productCode, barcodeId, quantity, note, status } = {}) {
  const c = Number(cardId);
  if (!c || Number.isNaN(c)) throw badRequest('cardId obrigatório');

  const { code, bId, q, note: cleanNote } = await normalizePendingItem({ productCode, barcodeId, quantity, note });

  // normaliza status de entrada
  const raw = String(status || 'aberto').toLowerCase();
  const st = (raw.includes('concl') || raw.includes('final') || raw.includes('done') || raw.includes('comp'))
    ? 'concluido'
    : 'aberto';

  const sql = `
    INSERT INTO ${TB_PENDINGS} (
      card_id,
      product_code,
      barcode_id,
      quantity,
      note,
      status,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    RETURNING *;
  `;

  const { rows } = await pool.query(sql, [
    c,
    code,
    bId,
    q,
    cleanNote,
    st
  ]);

  return rows[0];
}

export async function deletePending(pendingId) {
  const id = Number(pendingId);
  if (!id || Number.isNaN(id)) throw new Error('pendingId inválido');

  await pool.query(`DELETE FROM ${TB_PENDINGS} WHERE pending_id = $1`, [id]);
  return true;
}

// ✅ Relatório (PDF / tela): pendências com contexto
export async function listPendingsWithContext({ columnId, statusName, pendenciasFilter } = {}) {
  const filtros = [];
  const params = [];

  if (columnId) {
    filtros.push(`s.column_id = $${params.length + 1}`);
    params.push(Number(columnId));
  }

  if (statusName) {
    const arr = String(statusName)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (arr.length) {
      filtros.push(`s.name = ANY($${params.length + 1})`);
      params.push(arr);
    }
  }

  const pendRaw = String(pendenciasFilter || 'todas').toLowerCase();
  if (pendRaw.startsWith('pend')) filtros.push(IS_OPEN_PENDING);
  else if (pendRaw.startsWith('concl')) filtros.push(IS_DONE_PENDING);

  filtros.push('COALESCE(k.is_finished,false) = false');

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  const sql = `
    SELECT
      p.*,
      COALESCE(pr.description, '-') AS product_description,
      b.unit,
      b.fator,
      k.card_id,
      k.separation_number          AS order_separation_number,
      c.trade_name                 AS customer_name,
      c.tax_id                     AS customer_tax_id,
      COALESCE(p.note, '-')        AS obs,
      s.name                       AS column_name
    FROM ${TB_PENDINGS} p
    LEFT JOIN ${TB_PRODUCTS} pr
           ON ${PRODUCT_JOIN}
    LEFT JOIN ${TB_BARCODES} b
           ON ${BARCODE_JOIN}
    LEFT JOIN ${TB_CARDS} k
           ON p.card_id = k.card_id
    LEFT JOIN ${TB_CUSTOMERS} c
           ON c.customer_id = k.customer_id
    LEFT JOIN ${TB_COLUMNS} s
           ON ${STATUS_TO_COLUMN} = s.name
    ${where}
    ORDER BY
      s.sort_order NULLS LAST,
      k.card_id,
      CASE WHEN ${IS_OPEN_PENDING} THEN 0 ELSE 1 END,
      p.product_code NULLS LAST;
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

// ✅ Contador global para badge (abertas/concluidas/todas) com filtro opcional por coluna
export async function countPendings({ columnId, pendenciasFilter } = {}) {
  const filtros = [];
  const params = [];

  if (columnId) {
    filtros.push(`s.column_id = $${params.length + 1}`);
    params.push(Number(columnId));
  }

  const pendRaw = String(pendenciasFilter || 'todas').toLowerCase();
  if (pendRaw.startsWith('pend')) filtros.push(IS_OPEN_PENDING);
  else if (pendRaw.startsWith('concl')) filtros.push(IS_DONE_PENDING);

  filtros.push('COALESCE(k.is_finished,false) = false');

  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';

  const sql = `
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM(CASE WHEN ${IS_OPEN_PENDING} THEN 1 ELSE 0 END),0)::int AS abertas,
      COALESCE(SUM(CASE WHEN ${IS_DONE_PENDING} THEN 1 ELSE 0 END),0)::int AS concluidas
    FROM ${TB_PENDINGS} p
    LEFT JOIN ${TB_CARDS} k ON p.card_id = k.card_id
    LEFT JOIN ${TB_COLUMNS} s ON ${STATUS_TO_COLUMN} = s.name
    ${where};
  `;

  const { rows } = await pool.query(sql, params);
  return rows[0] || { total: 0, abertas: 0, concluidas: 0 };
}
