// ╔════════════════════════════════════════════════════════════════════╗
// ║ groupsAndSubgroupsBatchValidate.repository.js — subgrupo pertence ao grupo ║
// ╚════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import { TB_SUBGROUPS, TB_FAMILIES } from './groupsAndSubgroupsBatch.constants.js';
import { toInt } from './groupsAndSubgroupsBatch.sanitizers.js';
import { tableExists, columnExists } from './groupsAndSubgroupsBatchIntrospection.repository.js';

// -----------------------------------------------------------------------------
// Internal validation: subgroup belongs to group (best-effort)
// -----------------------------------------------------------------------------
export async function validateSubgroupBelongsToGroup({ product_group_id, product_subgroup_id }) {
  if (!Number.isInteger(product_subgroup_id)) return { ok: true, skipped: true };

  const hasSubgroupsTable = await tableExists(TB_SUBGROUPS).catch(() => false);
  if (!hasSubgroupsTable) return { ok: true, skipped: true };

  const hasIsActive = await columnExists(TB_SUBGROUPS, 'is_active').catch(() => false);

  const groupColCandidates = ['product_group_id', 'group_id', 'products_group_id', 'productGroupId'];
  let groupCol = null;
  for (const c of groupColCandidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await columnExists(TB_SUBGROUPS, c).catch(() => false);
    if (ok) { groupCol = c; break; }
  }

  const selectCols = [
    'product_subgroup_id',
    ...(groupCol ? [groupCol] : []),
    ...(hasIsActive ? ['is_active'] : []),
  ].join(', ');

  const sgRes = await pool.query(
    `
      SELECT ${selectCols}
      FROM ${TB_SUBGROUPS}
      WHERE product_subgroup_id = $1
      LIMIT 1;
    `,
    [product_subgroup_id],
  );

  if (!sgRes.rowCount) {
    const err = new Error('Subgroup not found.');
    err.status = 404;
    throw err;
  }

  const row = sgRes.rows[0];

  if (hasIsActive && row?.is_active === false) {
    const err = new Error('Cannot assign an inactive subgroup.');
    err.status = 409;
    throw err;
  }

  if (groupCol) {
    const subgroupGroupId = toInt(row[groupCol], null);
    if (Number.isInteger(subgroupGroupId) && subgroupGroupId !== product_group_id) {
      const err = new Error('Subgroup does not belong to the provided group.');
      err.status = 409;
      throw err;
    }
  }

  return { ok: true, skipped: false, groupCol, hasIsActive };
}

// -----------------------------------------------------------------------------
// Internal validation: família pertence ao subgrupo e está ativa
// -----------------------------------------------------------------------------
export async function validateFamilyBelongsToSubgroup({ product_subgroup_id, product_family_id }) {
  if (!Number.isInteger(product_family_id)) return { ok: true, skipped: true };

  const hasFamiliesTable = await tableExists(TB_FAMILIES).catch(() => false);
  if (!hasFamiliesTable) {
    const err = new Error('Families table not found.');
    err.status = 409;
    throw err;
  }

  const fRes = await pool.query(
    `
      SELECT product_family_id, subgroup_id, is_active
      FROM ${TB_FAMILIES}
      WHERE product_family_id = $1
      LIMIT 1;
    `,
    [product_family_id],
  );

  if (!fRes.rowCount) {
    const err = new Error('Family not found.');
    err.status = 404;
    throw err;
  }

  const row = fRes.rows[0];

  if (row?.is_active === false) {
    const err = new Error('Cannot assign an inactive family.');
    err.status = 409;
    throw err;
  }

  const familySubgroupId = toInt(row?.subgroup_id, null);
  if (familySubgroupId !== product_subgroup_id) {
    const err = new Error('Family does not belong to the provided subgroup.');
    err.status = 409;
    throw err;
  }

  return { ok: true, skipped: false };
}
