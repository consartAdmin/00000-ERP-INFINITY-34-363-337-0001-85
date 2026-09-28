// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ emailSignaturesApi.js — API de acesso à tabela "emailSignatures" (ESM)   ║
// ║ CONSART ERP — Assinaturas HTML usadas nos envios de e-mail               ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

// ⚠ Tabela como está no Postgres: "emailSignatures" (com aspas / CamelCase)
export const EMAIL_SIGNATURES_TABLE = 'public."emailSignatures"';

/**
 * Helper: executa callback com client dedicado (pool.connect)
 * @param {import('pg').Pool} pgPool
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
async function withClient(pgPool, fn) {
  const client = await pgPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------------- */
/* Mappers / Helpers                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Normaliza payload vindo do frontend para o formato da tabela.
 * Aceita campos soltos e ignora o que não existir na tabela.
 *
 * @param {object} payload
 */
function normalizePayload(payload = {}) {
  const {
    owneruserid = null,
    name,
    html,
    isdefault = false
  } = payload;

  return {
    owneruserid: owneruserid ?? null,
    name,
    html,
    isdefault: Boolean(isdefault)
  };
}

/**
 * Monta WHERE por owneruserid (permitindo NULL = assinatura global)
 *
 * @param {number|null|undefined} ownerUserId
 * @returns {{ where: string, params: any[] }}
 */
function buildOwnerWhere(ownerUserId) {
  if (ownerUserId == null) {
    return {
      where: 'owneruserid IS NULL',
      params: []
    };
  }

  return {
    where: 'owneruserid = $1',
    params: [ownerUserId]
  };
}

/* ------------------------------------------------------------------------- */
/* Funções principais                                                        */
/* ------------------------------------------------------------------------- */

const emailSignaturesApi = {
  /**
   * Lista assinaturas, opcionalmente filtrando por usuário.
   * @param {import('pg').Pool} pgPool
   * @param {{ ownerUserId?: number | null }} [options]
   */
  async list(pgPool, options = {}) {
    const { ownerUserId = null } = options;

    return withClient(pgPool, async (client) => {
      if (ownerUserId === 'all') {
        const { rows } = await client.query(
          `SELECT *
             FROM ${EMAIL_SIGNATURES_TABLE}
            ORDER BY owneruserid NULLS FIRST, isdefault DESC, name ASC`
        );
        return rows;
      }

      const { where, params } = buildOwnerWhere(ownerUserId);
      const { rows } = await client.query(
        `SELECT *
           FROM ${EMAIL_SIGNATURES_TABLE}
          WHERE ${where}
          ORDER BY isdefault DESC, name ASC`,
        params
      );
      return rows;
    });
  },

  /**
   * Busca assinatura por ID
   * @param {import('pg').Pool} pgPool
   * @param {number} id
   */
  async getById(pgPool, id) {
    return withClient(pgPool, async (client) => {
      const { rows } = await client.query(
        `SELECT *
           FROM ${EMAIL_SIGNATURES_TABLE}
          WHERE id = $1`,
        [id]
      );
      return rows[0] || null;
    });
  },

  /**
   * Busca assinatura padrão para um usuário.
   * Estratégia:
   *  1) Tenta assinatura default do usuário (owneruserid = user)
   *  2) Se não existir, tenta default global (owneruserid IS NULL)
   *
   * @param {import('pg').Pool} pgPool
   * @param {number|null} [ownerUserId]
   */
  async getDefault(pgPool, ownerUserId = null) {
    return withClient(pgPool, async (client) => {
      // 1) Default do usuário, se informado
      if (ownerUserId != null) {
        const { rows } = await client.query(
          `SELECT *
             FROM ${EMAIL_SIGNATURES_TABLE}
            WHERE owneruserid = $1
              AND isdefault = TRUE
            LIMIT 1`,
          [ownerUserId]
        );
        if (rows[0]) return rows[0];
      }

      // 2) Default global
      const { rows: globalRows } = await client.query(
        `SELECT *
           FROM ${EMAIL_SIGNATURES_TABLE}
          WHERE owneruserid IS NULL
            AND isdefault = TRUE
          LIMIT 1`
      );
      return globalRows[0] || null;
    });
  },

  /**
   * Cria nova assinatura.
   * Se isdefault = true, limpa default anterior do mesmo owneruserid.
   *
   * @param {import('pg').Pool} pgPool
   * @param {object} payload
   */
  async create(pgPool, payload) {
    const normalized = normalizePayload(payload);

    return withClient(pgPool, async (client) => {
      await client.query('BEGIN');

      try {
        if (normalized.isdefault) {
          // Limpa outros defaults do mesmo owner
          if (normalized.owneruserid == null) {
            await client.query(
              `UPDATE ${EMAIL_SIGNATURES_TABLE}
                  SET isdefault = FALSE
                WHERE owneruserid IS NULL`
            );
          } else {
            await client.query(
              `UPDATE ${EMAIL_SIGNATURES_TABLE}
                  SET isdefault = FALSE
                WHERE owneruserid = $1`,
              [normalized.owneruserid]
            );
          }
        }

        const { rows } = await client.query(
          `INSERT INTO ${EMAIL_SIGNATURES_TABLE}
             (owneruserid, name, html, isdefault, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           RETURNING *`,
          [
            normalized.owneruserid,
            normalized.name,
            normalized.html,
            normalized.isdefault
          ]
        );

        await client.query('COMMIT');
        return rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  },

  /**
   * Atualiza uma assinatura existente.
   * Pode trocar texto, nome e se é default.
   *
   * @param {import('pg').Pool} pgPool
   * @param {number} id
   * @param {object} payload
   */
  async update(pgPool, id, payload) {
    const normalized = normalizePayload(payload);

    return withClient(pgPool, async (client) => {
      await client.query('BEGIN');

      try {
        // Descobre owneruserid atual, se não veio no payload
        let ownerUserId = normalized.owneruserid;
        if (ownerUserId == null) {
          const { rows: currentRows } = await client.query(
            `SELECT owneruserid
               FROM ${EMAIL_SIGNATURES_TABLE}
              WHERE id = $1`,
            [id]
          );
          if (!currentRows[0]) {
            throw new Error(`emailSignatures.id=${id} not found`);
          }
          ownerUserId = currentRows[0].owneruserid;
        }

        if (normalized.isdefault) {
          // Limpa default anterior do mesmo owner
          if (ownerUserId == null) {
            await client.query(
              `UPDATE ${EMAIL_SIGNATURES_TABLE}
                  SET isdefault = FALSE
                WHERE owneruserid IS NULL`
            );
          } else {
            await client.query(
              `UPDATE ${EMAIL_SIGNATURES_TABLE}
                  SET isdefault = FALSE
                WHERE owneruserid = $1`,
              [ownerUserId]
            );
          }
        }

        const { rows } = await client.query(
          `UPDATE ${EMAIL_SIGNATURES_TABLE}
              SET owneruserid = $1,
                  name        = $2,
                  html        = $3,
                  isdefault   = $4,
                  updated_at  = NOW()
            WHERE id = $5
          RETURNING *`,
          [
            normalized.owneruserid ?? ownerUserId,
            normalized.name,
            normalized.html,
            normalized.isdefault,
            id
          ]
        );

        await client.query('COMMIT');
        return rows[0] || null;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  },

  /**
   * Define a assinatura como padrão (e limpa as outras do mesmo owner).
   *
   * @param {import('pg').Pool} pgPool
   * @param {number} id
   */
  async setDefault(pgPool, id) {
    return withClient(pgPool, async (client) => {
      await client.query('BEGIN');

      try {
        const { rows } = await client.query(
          `SELECT owneruserid
             FROM ${EMAIL_SIGNATURES_TABLE}
            WHERE id = $1`,
          [id]
        );
        if (!rows[0]) {
          throw new Error(`emailSignatures.id=${id} not found`);
        }

        const ownerUserId = rows[0].owneruserid;

        if (ownerUserId == null) {
          await client.query(
            `UPDATE ${EMAIL_SIGNATURES_TABLE}
                SET isdefault = FALSE
              WHERE owneruserid IS NULL`
          );
        } else {
          await client.query(
            `UPDATE ${EMAIL_SIGNATURES_TABLE}
                SET isdefault = FALSE
              WHERE owneruserid = $1`,
            [ownerUserId]
          );
        }

        const { rows: updated } = await client.query(
          `UPDATE ${EMAIL_SIGNATURES_TABLE}
              SET isdefault = TRUE,
                  updated_at = NOW()
            WHERE id = $1
          RETURNING *`,
          [id]
        );

        await client.query('COMMIT');
        return updated[0] || null;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  },

  /**
   * Remove uma assinatura.
   * @param {import('pg').Pool} pgPool
   * @param {number} id
   */
  async remove(pgPool, id) {
    return withClient(pgPool, async (client) => {
      const { rowCount } = await client.query(
        `DELETE FROM ${EMAIL_SIGNATURES_TABLE}
          WHERE id = $1`,
        [id]
      );
      return rowCount > 0;
    });
  }
};

export default emailSignaturesApi;
