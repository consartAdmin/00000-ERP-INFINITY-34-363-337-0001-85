// ╔════════════════════════════════════════════════════════════════════╗
// ║ productsFamilies.constants.js — Tabela, alias e colunas            ║
// ║ Tabela: public."productsFamilies" (alias: pfm)                     ║
// ║ 3º nível de classificação: Grupo → Subgrupo → Família              ║
// ╚════════════════════════════════════════════════════════════════════╝

export const TB    = '"productsFamilies"';
export const ALIAS = 'pfm';

export const COLS = Object.freeze({
  id:          'product_family_id',
  name:        'name',
  subgroup_id: 'subgroup_id',
  created_at:  'created_at',
  updated_at:  'updated_at',
  is_active:   'is_active',
});

export const SELECT_COLS = [
  COLS.id, COLS.name, COLS.subgroup_id, COLS.created_at, COLS.updated_at, COLS.is_active,
].join(', ');

export const ORDERABLE = new Set([COLS.name, COLS.created_at, COLS.updated_at, COLS.is_active]);
