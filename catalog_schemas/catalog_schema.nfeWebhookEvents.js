// ╔══════════════════════════════════════════════════════════════════════╗
// ║ catalog_schema.nfeWebhookEvents.js — Schema NF-e Webhook (Postgres) ║
// ║ Tabela: public."nfeWebhookEvents"                                    ║
// ║ - Guarda eventos vindos da PlugNotas / TecnoSpeed                    ║
// ║ - Permite monitorar status, erros, chave, integração etc.           ║
// ╚══════════════════════════════════════════════════════════════════════╝

/**
 * Descrição da tabela para referência interna / futura UI de catálogo.
 */
export const catalogNfeWebhookEvents = {
  schema: 'public',
  tableName: 'nfeWebhookEvents',
  fqTableName: 'public."nfeWebhookEvents"',
  primaryKey: 'id',
  columns: [
    { name: 'id', type: 'bigserial', pk: true },
    { name: 'emitter_cnpj', type: 'varchar(14)', nullable: false },
    { name: 'integration_id', type: 'varchar(80)', nullable: true },
    { name: 'plugnotas_uuid', type: 'varchar(80)', nullable: true },
    { name: 'chave_acesso', type: 'varchar(44)', nullable: true },
    { name: 'numero_nfe', type: 'varchar(20)', nullable: true },
    { name: 'serie', type: 'varchar(5)', nullable: true },
    { name: 'status', type: 'varchar(40)', nullable: true },
    { name: 'cstat', type: 'varchar(10)', nullable: true },
    { name: 'motivo', type: 'text', nullable: true },
    { name: 'tipo_evento', type: 'varchar(40)', nullable: true },
    { name: 'raw_payload', type: 'jsonb', nullable: false },
    { name: 'created_at', type: 'timestamptz', nullable: false, default: 'NOW()' },
    { name: 'updated_at', type: 'timestamptz', nullable: false, default: 'NOW()' }
  ],
  indexes: [
    { name: 'idx_nfeWebhookEvents_chave', columns: ['chave_acesso'] },
    { name: 'idx_nfeWebhookEvents_integration', columns: ['integration_id'] },
    { name: 'idx_nfeWebhookEvents_created', columns: ['created_at'] }
  ]
};

/**
 * Cria tabela + índices + trigger de updated_at.
 * @param {import('pg').Pool} pgPool
 */
export async function ensureNfeWebhookEventsSchema(pgPool) {
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    // 1) Tabela
    await client.query(`
      CREATE TABLE IF NOT EXISTS public."nfeWebhookEvents" (
        id              BIGSERIAL PRIMARY KEY,
        emitter_cnpj    VARCHAR(14) NOT NULL,
        integration_id  VARCHAR(80),
        plugnotas_uuid  VARCHAR(80),
        chave_acesso    VARCHAR(44),
        numero_nfe      VARCHAR(20),
        serie           VARCHAR(5),
        status          VARCHAR(40),
        cstat           VARCHAR(10),
        motivo          TEXT,
        tipo_evento     VARCHAR(40),
        raw_payload     JSONB NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2) Função genérica de updated_at (idempotente)
    await client.query(`
      CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 3) Trigger de updated_at na tabela
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'trg_nfeWebhookEvents_updated_at'
        ) THEN
          CREATE TRIGGER trg_nfeWebhookEvents_updated_at
          BEFORE UPDATE ON public."nfeWebhookEvents"
          FOR EACH ROW
          EXECUTE FUNCTION public.set_updated_at_timestamp();
        END IF;
      END;
      $$;
    `);

    // 4) Índices
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nfeWebhookEvents_chave
        ON public."nfeWebhookEvents"(chave_acesso);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nfeWebhookEvents_integration
        ON public."nfeWebhookEvents"(integration_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nfeWebhookEvents_created
        ON public."nfeWebhookEvents"(created_at);
    `);

    await client.query('COMMIT');
    console.log('✅ Schema nfeWebhookEvents garantido com sucesso.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erro ao garantir schema nfeWebhookEvents:', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Opcional: função de drop (para migrações reversas).
 */
export async function dropNfeWebhookEventsSchema(pgPool) {
  await pgPool.query(`
    DROP TABLE IF EXISTS public."nfeWebhookEvents" CASCADE;
  `);
  console.log('⚠️ Tabela nfeWebhookEvents removida.');
}

export default {
  catalogNfeWebhookEvents,
  ensureNfeWebhookEventsSchema,
  dropNfeWebhookEventsSchema
};
