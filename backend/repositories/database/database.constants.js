// ╔════════════════════════════════════════════════════════════════════╗
// ║ database.constants.js — Schema padrão e tabelas bloqueadas         ║
// ║ (Database Viewer / Editor)                                         ║
// ╚════════════════════════════════════════════════════════════════════╝

export const DEFAULT_SCHEMA = 'public';

export const BLOCKED_TABLES = new Set([
  'cadastro_usuarios',
  'users',
  'sessions',
  'tokens',
  'passwords',
  'knex_migrations',
  'sequelize_meta',
]);
