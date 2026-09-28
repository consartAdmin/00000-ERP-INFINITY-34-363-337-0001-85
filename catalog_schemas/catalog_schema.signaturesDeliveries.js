// ╔══════════════════════════════════════════════════════════════════════╗
// ║ logistics_schema.signaturesDeliveries.js                             ║
// ║ Schema: Assinaturas de Entrega (CONSART ERP | Logística)             ║
// ║                                                                      ║
// ║ Tabela: public."signaturesDeliveries"                                ║
// ║ - Armazena a assinatura digital de quem recebeu a mercadoria         ║
// ║ - Vinculada ao pedido (order_id) e à chave da NF-e (nfe_key)         ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

export const TABLE_SIGNATURES_DELIVERIES = 'public."signaturesDeliveries"';

/**
 * Garante a existência da tabela de assinaturas de entrega.
 * Pode receber um client externo (para uso em transações).
 */
export async function ensureSignaturesDeliveriesTable(externalClient) {
  const client = externalClient || (await pool.connect());
  const ownClient = !externalClient;

  try {
    if (ownClient) {
      await client.query('BEGIN');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${TABLE_SIGNATURES_DELIVERIES} (
        signature_id   SERIAL PRIMARY KEY,
        order_id       INTEGER NOT NULL,
        nfe_key        VARCHAR(44) NOT NULL,
        signed_name    VARCHAR(255) NOT NULL,
        signature_image TEXT NOT NULL,
        created_at     TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        updated_at     TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
      );
    `);

    //Índice para buscas rápidas por pedido
    await client.query(`
      CREATE INDEX IF NOT EXISTS signaturesDeliveries_order_id_idx
        ON ${TABLE_SIGNATURES_DELIVERIES} (order_id);
    `);

    // Índice para buscas rápidas pela chave da nota
    await client.query(`
      CREATE INDEX IF NOT EXISTS signaturesDeliveries_nfe_key_idx
        ON ${TABLE_SIGNATURES_DELIVERIES} (nfe_key);
    `);

    // Restrição opcional: uma assinatura por (order_id, nfe_key)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM   pg_constraint
          WHERE  conname = 'signaturesDeliveries_order_nfe_uk'
        ) THEN
          ALTER TABLE ${TABLE_SIGNATURES_DELIVERIES}
            ADD CONSTRAINT signaturesDeliveries_order_nfe_uk
            UNIQUE (order_id, nfe_key);
        END IF;
      END;
      $$;
    `);

    if (ownClient) {
      await client.query('COMMIT');
    }
  } catch (err) {
    if (ownClient) {
      await client.query('ROLLBACK');
    }
    console.error('ensureSignaturesDeliveriesTable() failed:', err);
    throw err;
  } finally {
    if (ownClient) {
      client.release();
    }
  }
}

export default {
  TABLE_SIGNATURES_DELIVERIES,
  ensureSignaturesDeliveriesTable,
};
