// backend/services/pgService.js
// ╔════════════════════════════════════════════════════════════════════════╗
// ║ pgService.js — pool PostgreSQL simples (ESM)                           ║
// ║ Melhoria: garante que password seja string; logs mais claros            ║
// ╚════════════════════════════════════════════════════════════════════════╝

import pg from 'pg';
const { Pool } = pg;

function toConnOptionsFromEnv() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  // Coerce para strings quando presente (evita passar undefined/null)
  const host = process.env.PGHOST || 'localhost';
  const port = process.env.PGPORT ? Number(process.env.PGPORT) : 5432;
  const user = process.env.PGUSER != null ? String(process.env.PGUSER) : undefined;
  const password = process.env.PGPASSWORD != null ? String(process.env.PGPASSWORD) : undefined;
  const database = process.env.PGDATABASE != null ? String(process.env.PGDATABASE) : 'consart';
  const max = process.env.PGPOOL_MAX ? Number(process.env.PGPOOL_MAX) : 10;

  const opts = {
    host,
    port,
    database,
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  };

  if (user) opts.user = user;
  if (password) opts.password = password;

  return opts;
}

const pool = new Pool(toConnOptionsFromEnv());

// Query helper: parametrizado e com tratamento básico
export async function query(text, params = []) {
  const start = Date.now();
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    const duration = Date.now() - start;
    // console.debug(`[pgService] executed query`, { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    // Mais detalhe para erros SASL/auth
    console.error('[pgService] query error:', err?.message || err);
    // Re-lança para que o controller trate, mas mantendo log claro
    throw err;
  } finally {
    client.release();
  }
}

export { pool };
export default { query, pool };
