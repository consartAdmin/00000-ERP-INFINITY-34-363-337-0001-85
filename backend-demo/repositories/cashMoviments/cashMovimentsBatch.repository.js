// ╔════════════════════════════════════════════════════════════════════╗
// ║ cashMovimentsBatch.repository.js — alteração/exclusão em lote      ║
// ║ Tabela: "cashMoviments" (transação, máx. 500 ids)                  ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { normalizeTipoMovimentacao } from './cashMoviments.sanitizers.js';
import { ensureCashTaxColumns } from './cashMoviments.utils.js';
import { ensureTransfersSchema } from './cashTransfers.schema.js';
import { deleteTransfers } from './cashTransfers.repository.js';

/**
 * Alteração em lote das movimentações selecionadas.
 * Somente os campos presentes em `changes` são alterados:
 *   movement_type      'ENTRADA' | 'SAIDA'
 *   document_type_id   id de "cashDocumentTypes" (grava o nome em document_type)
 *   bank_account_id    id de "bankAccounts" (grava o nome em cash_account)
 *   chart_account_id   id de "chartOfAccounts" ou null (remove)
 *   category_id        id de "cashCategories" (sem subcategory_id → limpa a subcategoria)
 *   subcategory_id     id de "cashSubcategories" ou null; exige category_id
 *   is_deductible      true | false | null (null = segue a subcategoria)
 *   is_pis_cofins_creditable  true | false
 *   deduct_charges_only true | false (dedutível: só juros, multas e encargos)
 * Pontas de transferência entre contas ficam de fora (edita-se pela transferência).
 */
export async function updateMovementsBatch(ids = [], changes = {}) {
  const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
  const has = (key) => Object.prototype.hasOwnProperty.call(changes || {}, key);
  const positive = (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  const normalizedIds = [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  if (!normalizedIds.length) throw badRequest('Selecione pelo menos uma movimentação.');
  if (normalizedIds.length > 500) {
    throw badRequest('É permitido alterar no máximo 500 movimentações por operação.');
  }

  await ensureCashTaxColumns();
  await ensureTransfersSchema();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const sets = [];
    const params = [];
    const add = (sql, value) => {
      params.push(value);
      sets.push(sql.replace('?', `$${params.length}`));
    };

    if (has('movement_type')) {
      const type = normalizeTipoMovimentacao(changes.movement_type);
      if (type !== 'ENTRADA' && type !== 'SAIDA') throw badRequest('Tipo inválido.');
      add('movement_type = ?', type);
    }

    if (has('document_type_id')) {
      const id = positive(changes.document_type_id);
      const { rows } = id
        ? await client.query(`SELECT name FROM "cashDocumentTypes" WHERE id = $1`, [id])
        : { rows: [] };
      if (!rows[0]) throw badRequest('Tipo de documento não encontrado.');
      add('document_type = ?', String(rows[0].name).trim().slice(0, 20));
    }

    if (has('bank_account_id')) {
      const id = positive(changes.bank_account_id);
      const { rows } = id
        ? await client.query(`SELECT id, name FROM "bankAccounts" WHERE id = $1`, [id])
        : { rows: [] };
      if (!rows[0]) throw badRequest('Conta não encontrada.');
      add('cash_account = ?', String(rows[0].name).trim().slice(0, 50));
      add('bank_account_id = ?', Number(rows[0].id));
    }

    if (has('chart_account_id')) {
      if (changes.chart_account_id === null || changes.chart_account_id === '') {
        add('chart_account_id = ?', null);
      } else {
        const id = positive(changes.chart_account_id);
        const { rows } = id
          ? await client.query(`SELECT id FROM "chartOfAccounts" WHERE id = $1`, [id])
          : { rows: [] };
        if (!rows[0]) throw badRequest('Conta contábil não encontrada.');
        add('chart_account_id = ?', id);
      }
    }

    if (has('subcategory_id') && !has('category_id')) {
      throw badRequest('Para alterar a subcategoria, informe também a categoria.');
    }

    if (has('category_id')) {
      const categoryId = positive(changes.category_id);
      const { rows } = categoryId
        ? await client.query(`SELECT id FROM "cashCategories" WHERE id = $1`, [categoryId])
        : { rows: [] };
      if (!rows[0]) throw badRequest('Categoria não encontrada.');
      add('category = ?', String(categoryId));

      const subcategoryId = has('subcategory_id') ? positive(changes.subcategory_id) : null;
      if (subcategoryId) {
        const { rows: subRows } = await client.query(
          `SELECT id FROM "cashSubcategories" WHERE id = $1 AND category_id = $2`,
          [subcategoryId, categoryId]
        );
        if (!subRows[0]) throw badRequest('A subcategoria não pertence à categoria escolhida.');
      }
      // Subcategoria antiga pertence à categoria antiga → limpa quando não informada
      add('subcategory = ?', subcategoryId ? String(subcategoryId) : null);
    }

    if (has('is_deductible')) {
      const value = changes.is_deductible;
      if (value !== null && typeof value !== 'boolean') {
        throw badRequest('Valor inválido para "Dedutível no IRPJ/CSLL".');
      }
      add('is_deductible = ?', value);
    }

    if (has('deduct_charges_only')) {
      if (typeof changes.deduct_charges_only !== 'boolean') {
        throw badRequest('Valor inválido para "Dedutível no IRPJ/CSLL".');
      }
      add('deduct_charges_only = ?', changes.deduct_charges_only);
    }

    if (has('is_pis_cofins_creditable')) {
      const value = changes.is_pis_cofins_creditable;
      if (typeof value !== 'boolean') {
        throw badRequest('Valor inválido para "Dedutível no PIS/COFINS".');
      }
      add('is_pis_cofins_creditable = ?', value);
    }

    if (!sets.length) throw badRequest('Escolha pelo menos um campo para alterar.');

    params.push(normalizedIds);
    const result = await client.query(
      `
        UPDATE "cashMoviments"
        SET ${sets.join(', ')}, updated_at = now()
        WHERE id = ANY($${params.length}::bigint[])
          AND transfer_id IS NULL
        RETURNING id
      `,
      params
    );

    await client.query('COMMIT');

    return {
      requested: normalizedIds.length,
      updated: result.rowCount,
      skipped_transfers: normalizedIds.length - result.rowCount,
      ids: result.rows.map((row) => Number(row.id)),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteMovementsBatch(ids = []) {
  const normalizedIds = [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)
    ),
  ];

  if (!normalizedIds.length) {
    return {
      requested: 0,
      deleted: 0,
      ids: [],
    };
  }

  if (normalizedIds.length > 500) {
    throw new Error(
      'É permitido excluir no máximo 500 movimentações por operação.'
    );
  }

  await ensureTransfersSchema();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Ponta de transferência: apaga a transferência inteira (as duas pontas + tarifa)
    const { rows: transferRows } = await client.query(
      `SELECT DISTINCT transfer_id FROM "cashMoviments"
        WHERE id = ANY($1::bigint[]) AND transfer_id IS NOT NULL`,
      [normalizedIds]
    );
    const removedByTransfer = (await deleteTransfers(
      transferRows.map((row) => row.transfer_id),
      client
    )).movement_ids;

    await client.query(
      `
        DELETE FROM "cashMovimentsAttachments"
        WHERE cash_movement_id = ANY($1::bigint[])
      `,
      [normalizedIds]
    );

    const result = await client.query(
      `
        DELETE FROM "cashMoviments"
        WHERE id = ANY($1::bigint[])
        RETURNING id
      `,
      [normalizedIds]
    );

    await client.query('COMMIT');

    const deletedIds = [
      ...new Set([...removedByTransfer, ...result.rows.map((row) => Number(row.id))]),
    ];

    return {
      requested: normalizedIds.length,
      deleted: deletedIds.length,
      ids: deletedIds,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
