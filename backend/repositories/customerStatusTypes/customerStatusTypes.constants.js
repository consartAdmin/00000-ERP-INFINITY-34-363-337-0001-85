// ╔════════════════════════════════════════════════════════════════════╗
// ║ customerStatusTypes.constants.js — Tabela, alias e colunas         ║
// ╚════════════════════════════════════════════════════════════════════╝

export const TB = 'public."customerStatusTypes"';
export const ALIAS = 'cst';

// Campos válidos para insert/update
export const FIELDS = [
  'name_pt',
  'internal_code',
  'description_en',
  'color_hex',
  'sort_order',
  'is_active',
];
