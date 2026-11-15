// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend-consart/config/dbInfinity.js                                 ║
// ║ Conexão SOMENTE LEITURA (por uso) ao banco do ERP Infinity           ║
// ║ • Mesmo servidor/usuário do banco consart (config/db.js); só muda    ║
// ║   o nome do banco: INFINITY_DB_NAME (padrão "erp-infinity-00000")    ║
// ║ • Criada só no primeiro uso (Documentação Consart ERP lê o menu do   ║
// ║   Infinity em public."moduleSystem"); nunca grava nada lá            ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Pool } from 'pg';

let pool = null;

function buildConfig() {
  const mode = String(process.env.DB_MODE || 'local').toLowerCase();
  const instance = process.env.INSTANCE_CONNECTION_NAME || '';
  const isCloudRun = !!process.env.K_SERVICE || !!process.env.CLOUD_RUN_JOB
    || process.env.FORCE_CLOUD_SQL_SOCKET === 'true' || mode === 'cloud';
  const useSocket = isCloudRun && mode !== 'local' && !!instance;

  return {
    host: useSocket ? `/cloudsql/${instance}` : process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.INFINITY_DB_NAME || 'erp-infinity-00000',
    user: process.env.INFINITY_DB_USER || process.env.DB_USER || 'postgres',
    password: process.env.INFINITY_DB_PASS || process.env.DB_PASS || '',
    max: 2,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 8000),
    ssl: false,
  };
}

export function getInfinityPool() {
  if (!pool) {
    pool = new Pool(buildConfig());
    pool.on('error', (err) => console.error('[DB Infinity] ❌ Pool error:', err?.message));
  }
  return pool;
}

export function infinityDbName() {
  return process.env.INFINITY_DB_NAME || 'erp-infinity-00000';
}
