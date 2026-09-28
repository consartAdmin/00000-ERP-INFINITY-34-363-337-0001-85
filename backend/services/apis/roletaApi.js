// ╔════════════════════════════════════════════════════════════╗
// ║ roletaApi.js — DAL Roleta (CONSART ERP | ESM)              ║
// ║ Path: backend/services/apis/roleta/roletaApi.js            ║
// ║ Tables:                                                    ║
// ║  - public.roleta_campaigns                                 ║
// ║  - public.roleta_campaign_products                          ║
// ║  - public.roleta_tokens                                    ║
// ║  - public.roleta_spins                                     ║
// ╚════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';
import crypto from 'crypto';

const TB_CAMPAIGNS = 'public.roleta_campaigns';
const TB_PRODUCTS  = 'public.roleta_campaign_products';
const TB_TOKENS    = 'public.roleta_tokens';
const TB_SPINS     = 'public.roleta_spins';

export function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Create token for a customer + campaign
 * - Always generates a new unique token
 */
export async function createToken({ campaign_id, customer_id, expires_at }) {
  if (!campaign_id || !customer_id) {
    const err = new Error('campaign_id e customer_id são obrigatórios');
    err.status = 400;
    throw err;
  }

  const token = generateToken();

  await pool.query(
    `INSERT INTO ${TB_TOKENS} (campaign_id, customer_id, token, expires_at)
     VALUES ($1,$2,$3,$4)`,
    [campaign_id, customer_id, token, expires_at || null]
  );

  return token;
}

/**
 * Returns token + campaign info
 */
export async function getTokenData(token) {
  const { rows } = await pool.query(
    `SELECT
        t.id              AS token_id,
        t.campaign_id,
        t.customer_id,
        t.token,
        t.expires_at,
        t.is_active       AS token_is_active,
        t.created_at      AS token_created_at,

        c.id              AS campaign_id2,
        c.name            AS campaign_name,
        c.max_spins_per_customer,
        c.starts_at,
        c.ends_at,
        c.is_active       AS campaign_is_active
     FROM ${TB_TOKENS} t
     JOIN ${TB_CAMPAIGNS} c ON c.id = t.campaign_id
     WHERE t.token = $1
     LIMIT 1`,
    [token]
  );

  return rows[0] || null;
}

/**
 * Locks token row for safe spin concurrency
 * IMPORTANT: must be called inside a transaction (client)
 */
export async function getTokenDataForUpdate(client, token) {
  const { rows } = await client.query(
    `SELECT
        t.id              AS token_id,
        t.campaign_id,
        t.customer_id,
        t.token,
        t.expires_at,
        t.is_active       AS token_is_active,
        t.created_at      AS token_created_at,

        c.name            AS campaign_name,
        c.max_spins_per_customer,
        c.starts_at,
        c.ends_at,
        c.is_active       AS campaign_is_active
     FROM ${TB_TOKENS} t
     JOIN ${TB_CAMPAIGNS} c ON c.id = t.campaign_id
     WHERE t.token = $1
     FOR UPDATE
     LIMIT 1`,
    [token]
  );

  return rows[0] || null;
}

export async function countCustomerSpins(clientOrPool, campaign_id, customer_id) {
  const runner = clientOrPool?.query ? clientOrPool : pool;
  const { rows } = await runner.query(
    `SELECT COUNT(*)::int AS count
     FROM ${TB_SPINS}
     WHERE campaign_id=$1 AND customer_id=$2`,
    [campaign_id, customer_id]
  );
  return rows[0]?.count ?? 0;
}

/**
 * Get products for a campaign (only active)
 * - If join with public.products fails in your schema, fallback to product_code only.
 */
export async function getCampaignProducts(campaign_id) {
  // Try JOIN with products table (your earlier assumption)
  try {
    const { rows } = await pool.query(
      `SELECT p.product_code,
              COALESCE(pr.name, p.product_code) AS name,
              GREATEST(p.weight, 1) AS weight
       FROM ${TB_PRODUCTS} p
       LEFT JOIN public.products pr ON pr.product_code = p.product_code
       WHERE p.campaign_id=$1
         AND p.is_active=TRUE
       ORDER BY p.id ASC`,
      [campaign_id]
    );
    return rows;
  } catch (e) {
    // Fallback if public.products or column doesn't exist
    const { rows } = await pool.query(
      `SELECT p.product_code,
              p.product_code AS name,
              GREATEST(p.weight, 1) AS weight
       FROM ${TB_PRODUCTS} p
       WHERE p.campaign_id=$1
         AND p.is_active=TRUE
       ORDER BY p.id ASC`,
      [campaign_id]
    );
    return rows;
  }
}

/**
 * Save spin (inside transaction if needed)
 */
export async function saveSpin(clientOrPool, { campaign_id, customer_id, token, product_code }) {
  const runner = clientOrPool?.query ? clientOrPool : pool;

  await runner.query(
    `INSERT INTO ${TB_SPINS}
     (campaign_id, customer_id, token, product_code)
     VALUES ($1,$2,$3,$4)`,
    [campaign_id, customer_id, token, product_code]
  );
}

// ──────────────────────────────────────────────────────────────
// ADMIN (Management)
// ──────────────────────────────────────────────────────────────

export async function listCampaigns({ q }) {
  const params = [];
  let where = 'WHERE 1=1';

  if (q) {
    params.push(`%${q}%`);
    where += ` AND name ILIKE $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT id, name, is_active, max_spins_per_customer
     FROM ${TB_CAMPAIGNS}
     ${where}
     ORDER BY id DESC
     LIMIT 200`,
    params
  );

  return rows;
}

export async function createCampaign({ name, description, starts_at, ends_at, max_spins_per_customer, is_active }) {
  const { rows } = await pool.query(
    `INSERT INTO ${TB_CAMPAIGNS}
      (name, description, starts_at, ends_at, max_spins_per_customer, is_active)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, name`,
    [name, description || null, starts_at || null, ends_at || null, max_spins_per_customer, is_active]
  );
  return rows[0];
}

export async function listCampaignProductsAdmin(campaign_id) {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.campaign_id, p.product_code, p.weight, p.is_active,
              pr.name
       FROM ${TB_PRODUCTS} p
       LEFT JOIN public.products pr ON pr.product_code = p.product_code
       WHERE p.campaign_id = $1
       ORDER BY p.id DESC`,
      [campaign_id]
    );
    return rows;
  } catch {
    const { rows } = await pool.query(
      `SELECT p.id, p.campaign_id, p.product_code, p.weight, p.is_active
       FROM ${TB_PRODUCTS} p
       WHERE p.campaign_id = $1
       ORDER BY p.id DESC`,
      [campaign_id]
    );
    return rows;
  }
}

export async function addCampaignProduct({ campaign_id, product_code, weight, is_active }) {
  await pool.query(
    `INSERT INTO ${TB_PRODUCTS} (campaign_id, product_code, weight, is_active)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (campaign_id, product_code)
     DO UPDATE SET weight=EXCLUDED.weight, is_active=EXCLUDED.is_active`,
    [campaign_id, product_code, weight, is_active]
  );
}

export async function removeCampaignProductById(id) {
  await pool.query(`DELETE FROM ${TB_PRODUCTS} WHERE id=$1`, [id]);
}

export async function listTokensAdmin({ campaign_id, q }) {
  const params = [campaign_id];
  let where = `WHERE campaign_id = $1`;

  if (q) {
    params.push(`%${q}%`);
    where += ` AND (customer_id ILIKE $${params.length} OR token ILIKE $${params.length})`;
  }

  const { rows } = await pool.query(
    `SELECT id, campaign_id, customer_id, token, expires_at, is_active, created_at
     FROM ${TB_TOKENS}
     ${where}
     ORDER BY id DESC
     LIMIT 300`,
    params
  );
  return rows;
}

export async function listSpinsAdmin({ campaign_id, customer_id }) {
  const params = [campaign_id];
  let where = `WHERE s.campaign_id = $1`;

  if (customer_id) {
    params.push(customer_id);
    where += ` AND s.customer_id = $${params.length}`;
  }

  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.campaign_id, s.customer_id, s.token, s.product_code, s.created_at,
              pr.name AS product_name
       FROM ${TB_SPINS} s
       LEFT JOIN public.products pr ON pr.product_code = s.product_code
       ${where}
       ORDER BY s.id DESC
       LIMIT 500`,
      params
    );
    return rows;
  } catch {
    const { rows } = await pool.query(
      `SELECT s.id, s.campaign_id, s.customer_id, s.token, s.product_code, s.created_at
       FROM ${TB_SPINS} s
       ${where}
       ORDER BY s.id DESC
       LIMIT 500`,
      params
    );
    return rows;
  }
}