// backend\services\utils\dbMeta.js (ESM version )

/**
 * Retorna um Set com os nomes das colunas existentes numa tabela.
 * @param {import('pg').PoolClient | import('pg').Client} client
 * @param {string} table
 * @returns {Promise<Set<string>>}
 */
export async function getExistingColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1`,
    [table]
  );
  return new Set(rows.map(r => r.column_name));
}

/**
 * Escolhe o primeiro nome que exista em `cols` dentre os candidatos.
 * @param {Set<string>} cols
 * @param {string[]} candidates
 * @param {string|null} [fallback=null]
 * @returns {string|null}
 */
export const pick = (cols, candidates, fallback = null) =>
  candidates.find(c => c && cols.has(c)) || fallback;

/**
 * Retorna metadados simples de uma coluna.
 * @param {import('pg').PoolClient | import('pg').Client} client
 * @param {string} table
 * @param {string} column
 * @returns {Promise<{data_type: string|null, numeric_scale: number|null}>}
 */
export async function getColumnMeta(client, table, column) {
  const { rows } = await client.query(
    `SELECT data_type, numeric_scale
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
      LIMIT 1`,
    [table, column]
  );
  return rows[0] || { data_type: null, numeric_scale: null };
}

export default { getExistingColumns, pick, getColumnMeta };
