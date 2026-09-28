// ╔══════════════════════════════════════════════════════════════════════╗
// ║ ordersDeliveryApi.js — Service/API (DB) Frete/Entrega do Pedido      ║
// ║ CONSART ERP | ESM                                                   ║
// ║ Tabela: public."ordersDelivery"                                     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

const TB = 'public."ordersDelivery"';

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toMoney(v, def = 0) {
  if (v === null || v === undefined || v === '') return Number(def);
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number(def);

  // aceita "1.234,56" e "1234.56"
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : Number(def);
}

function validateFreightMode(mode) {
  const m = toInt(mode);
  if (m === null) return 9;
  if (![0, 1, 2, 3, 4, 9].includes(m)) throw new Error('freight_mode inválido');
  return m;
}

function normalizePayload(p = {}) {
  const freight_value = toMoney(p.freight_value ?? p.frete ?? 0, 0);
  const freight_mode = validateFreightMode(
    p.freight_mode ?? (freight_value > 0 ? 0 : 9)
  );

  const carrier_cnpj_cpf =
    p.carrier_cnpj_cpf != null ? String(p.carrier_cnpj_cpf).replace(/\D/g, '') : null;

  const carrier_uf =
    p.carrier_uf != null
      ? String(p.carrier_uf).trim().toUpperCase()
      : p.carrier_state != null
        ? String(p.carrier_state).trim().toUpperCase()
        : null;

  const vehicle_uf =
    p.vehicle_uf != null
      ? String(p.vehicle_uf).trim().toUpperCase()
      : p.vehicle_state != null
        ? String(p.vehicle_state).trim().toUpperCase()
        : null;

  return {
    freight_mode,
    freight_value,

    carrier_name: p.carrier_name ?? null,
    carrier_cnpj_cpf: carrier_cnpj_cpf || null,
    carrier_ie: p.carrier_ie ?? null,
    carrier_address: p.carrier_address ?? null,
    carrier_city: p.carrier_city ?? null,
    carrier_uf: carrier_uf || null,

    antt_code: p.antt_code ?? p.vehicle_rntc ?? null,
    vehicle_plate: p.vehicle_plate ?? null,
    vehicle_uf: vehicle_uf || null,

    volume_quantity: p.volume_quantity ?? p.volumes ?? null,
    volume_species: p.volume_species ?? null,
    volume_brand: p.volume_brand ?? null,
    volume_numbering: p.volume_numbering ?? null,

    gross_weight: p.gross_weight ?? null,
    net_weight: p.net_weight ?? null,
  };
}

async function tableExists() {
  const sql = `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='ordersDelivery'
    LIMIT 1
  `;
  const r = await pool.query(sql);
  return r.rowCount > 0;
}

async function indexExists(indexName) {
  const sql = `SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1 LIMIT 1`;
  const r = await pool.query(sql, [indexName]);
  return r.rowCount > 0;
}

export default {
  async ensureTable() {
    // Seu banco JÁ tem a tabela. Aqui só garantimos o index (idempotente).
    const exists = await tableExists();

    if (!exists) {
      // ⚠️ Fallback (caso rode em DB vazio).
      // Mantive o nome ordersDelivery e constraints iguais ao seu dump.
      const createSql = `
        CREATE TABLE IF NOT EXISTS ${TB} (
          id               BIGSERIAL PRIMARY KEY,
          order_id         BIGINT NOT NULL UNIQUE REFERENCES public."orders"(order_id) ON DELETE CASCADE,

          freight_mode     SMALLINT NOT NULL DEFAULT 9 CHECK (freight_mode = ANY (ARRAY[0,1,2,9])),
          freight_value    NUMERIC(12,2) NOT NULL DEFAULT 0,

          carrier_name     TEXT,
          carrier_cnpj_cpf VARCHAR(14),
          carrier_ie       VARCHAR(20),
          carrier_address  TEXT,
          carrier_city     TEXT,
          carrier_uf       CHAR(2),
          antt_code        VARCHAR(20),
          vehicle_plate    VARCHAR(8),
          vehicle_uf       CHAR(2),

          volume_quantity  INTEGER,
          volume_species   TEXT,
          volume_brand     TEXT,
          volume_numbering TEXT,

          gross_weight     NUMERIC(12,3),
          net_weight       NUMERIC(12,3),

          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

          CONSTRAINT orderdelivery_cnpjcpf_chk CHECK (carrier_cnpj_cpf IS NULL OR carrier_cnpj_cpf ~ '^[0-9]{11}$|^[0-9]{14}$'),
          CONSTRAINT orderdelivery_uf_chk CHECK (carrier_uf IS NULL OR carrier_uf ~ '^[A-Z]{2}$'),
          CONSTRAINT orderdelivery_vehicle_uf_chk CHECK (vehicle_uf IS NULL OR vehicle_uf ~ '^[A-Z]{2}$')
        );
      `;
      await pool.query(createSql);

      // Trigger set_timestamp (se existir)
      const trigSql = `
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='set_timestamp') THEN
            IF NOT EXISTS (
              SELECT 1 FROM pg_trigger WHERE tgname='trg_orderdelivery_set_timestamp'
            ) THEN
              CREATE TRIGGER trg_orderdelivery_set_timestamp
              BEFORE UPDATE ON ${TB}
              FOR EACH ROW EXECUTE FUNCTION set_timestamp();
            END IF;
          END IF;
        END $$;
      `;
      await pool.query(trigSql);
    }

    if (!(await indexExists('idx_orderdelivery_order_id'))) {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_orderdelivery_order_id ON ${TB} (order_id)`);
    }

    return { ok: true, table: 'ordersDelivery', existed: exists };
  },

  async getByOrderId(orderId) {
    const id = toInt(orderId);
    if (!id || id <= 0) throw new Error('order_id inválido');

    const r = await pool.query(`SELECT * FROM ${TB} WHERE order_id=$1 LIMIT 1`, [id]);
    return r.rowCount ? r.rows[0] : null;
  },

  async upsertByOrderId(orderId, payload = {}, db = pool) {
    const id = toInt(orderId);
    if (!id || id <= 0) throw new Error('order_id inválido');

    const p = normalizePayload(payload);

    const sql = `
      INSERT INTO ${TB} (
        order_id,
        freight_mode, freight_value,
        carrier_name, carrier_cnpj_cpf, carrier_ie, carrier_address, carrier_city, carrier_uf,
        antt_code, vehicle_plate, vehicle_uf,
        volume_quantity, volume_species, volume_brand, volume_numbering,
        gross_weight, net_weight
      ) VALUES (
        $1,
        $2,$3,
        $4,$5,$6,$7,$8,$9,
        $10,$11,$12,
        $13,$14,$15,$16,
        $17,$18
      )
      ON CONFLICT (order_id)
DO UPDATE SET
  freight_mode     = EXCLUDED.freight_mode,
  freight_value    = EXCLUDED.freight_value,

  carrier_name     = COALESCE(EXCLUDED.carrier_name, ${TB}.carrier_name),
  carrier_cnpj_cpf = COALESCE(EXCLUDED.carrier_cnpj_cpf, ${TB}.carrier_cnpj_cpf),
  carrier_ie       = COALESCE(EXCLUDED.carrier_ie, ${TB}.carrier_ie),
  carrier_address  = COALESCE(EXCLUDED.carrier_address, ${TB}.carrier_address),
  carrier_city     = COALESCE(EXCLUDED.carrier_city, ${TB}.carrier_city),
  carrier_uf       = COALESCE(EXCLUDED.carrier_uf, ${TB}.carrier_uf),

  antt_code        = COALESCE(EXCLUDED.antt_code, ${TB}.antt_code),
  vehicle_plate    = COALESCE(EXCLUDED.vehicle_plate, ${TB}.vehicle_plate),
  vehicle_uf       = COALESCE(EXCLUDED.vehicle_uf, ${TB}.vehicle_uf),

  volume_quantity  = COALESCE(EXCLUDED.volume_quantity, ${TB}.volume_quantity),
  volume_species   = COALESCE(EXCLUDED.volume_species, ${TB}.volume_species),
  volume_brand     = COALESCE(EXCLUDED.volume_brand, ${TB}.volume_brand),
  volume_numbering = COALESCE(EXCLUDED.volume_numbering, ${TB}.volume_numbering),

  gross_weight     = COALESCE(EXCLUDED.gross_weight, ${TB}.gross_weight),
  net_weight       = COALESCE(EXCLUDED.net_weight, ${TB}.net_weight),

  updated_at       = NOW()
      RETURNING *;
    `;

    const values = [
      id,
      p.freight_mode, p.freight_value,
      p.carrier_name, p.carrier_cnpj_cpf, p.carrier_ie, p.carrier_address, p.carrier_city, p.carrier_uf,
      p.antt_code, p.vehicle_plate, p.vehicle_uf,
      p.volume_quantity, p.volume_species, p.volume_brand, p.volume_numbering,
      p.gross_weight, p.net_weight,
    ];

    const r = await db.query(sql, values);
    return r.rows[0];
  },

  async removeByOrderId(orderId) {
    const id = toInt(orderId);
    if (!id || id <= 0) throw new Error('order_id inválido');

    const r = await pool.query(`DELETE FROM ${TB} WHERE order_id=$1 RETURNING order_id`, [id]);
    return { ok: true, deleted: r.rowCount > 0 };
  },
};
