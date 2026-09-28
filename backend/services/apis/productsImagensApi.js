// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: productsImagensApi.js                                         ║
// ║ MODULE: DAL Imagens de Produtos                                     ║
// ║ CONSART ERP                                                         ║
// ║ ESM | PostgreSQL                                                    ║
// ║                                                                      ║
// ║ ✅ Tabela real: public."productsImages" (chave: product_code)       ║
// ║ ✅ Imagem principal / posição por unidade (product_code, barcode_id)║
// ║ ✅ barcode_id NULL = imagem geral do produto                        ║
// ║ ✅ Soft delete                                                       ║
// ║                                                                      ║
// ║ Compatibilidade: as linhas retornam também os aliases legados       ║
// ║ product_imagem_id (= product_image_id) e product_id (de products),  ║
// ║ usados pela tela productsImagens e pelo PDF de separação.           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import pool from '../../config/db.js';

/* =========================================================================
   Constantes
   ========================================================================= */

const TB = 'public."productsImages"';
const TB_PRODUCTS = 'public.products';

const BASE_SELECT = `
  SELECT
    img.product_image_id,
    img.product_image_id AS product_imagem_id,
    img.product_code,
    p.product_id,
    img.barcode_id,
    img.image_url,
    img.image_path,
    img.image_alt,
    img.is_primary,
    img.position,
    img.created_at,
    img.updated_at,
    img.is_active
  FROM ${TB} img
  LEFT JOIN ${TB_PRODUCTS} p
    ON p.product_code = img.product_code
`;

const ORDER_BY = 'ORDER BY img.barcode_id ASC NULLS FIRST, img.position ASC, img.product_image_id ASC';

function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return fallback;

  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on', 'sim'].includes(v)) return true;
  if (['false', '0', 'no', 'n', 'off', 'nao', 'não'].includes(v)) return false;

  return fallback;
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function normalizeRequiredString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizePositiveInt(value, fallback = 1) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function normalizeBarcodeId(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return normalizePositiveInt(value, null);
}

/* =========================================================================
   Resolução de produto (product_id → product_code)
   ========================================================================= */

export async function resolveProductCode(productId, client = pool) {
  const id = normalizePositiveInt(productId, null);
  if (!id) return null;

  const { rows } = await client.query(
    `SELECT product_code FROM ${TB_PRODUCTS} WHERE product_id = $1 LIMIT 1`,
    [id]
  );
  return rows[0]?.product_code ?? null;
}

/* =========================================================================
   Queries básicas
   ========================================================================= */

export async function listAll({ onlyActive = true } = {}) {
  const where = toBool(onlyActive, true) ? 'WHERE img.is_active = TRUE' : '';

  const { rows } = await pool.query(`
    ${BASE_SELECT}
    ${where}
    ORDER BY img.product_code ASC, img.barcode_id ASC NULLS FIRST, img.position ASC, img.product_image_id ASC;
  `);
  return rows;
}

export async function listByProductCode(productCode, { onlyActive = true } = {}) {
  let where = 'WHERE img.product_code = $1';
  if (toBool(onlyActive, true)) where += ' AND img.is_active = TRUE';

  const { rows } = await pool.query(
    `
    ${BASE_SELECT}
    ${where}
    ${ORDER_BY};
    `,
    [productCode]
  );
  return rows;
}

export async function listByProductId(productId, options = {}) {
  const productCode = await resolveProductCode(productId);
  if (!productCode) return [];
  return listByProductCode(productCode, options);
}

// Imagem principal geral do produto (barcode_id NULL); se não houver,
// cai para a primeira imagem ativa de qualquer unidade.
export async function getPrimaryImageByProductCode(productCode) {
  const { rows } = await pool.query(
    `
    ${BASE_SELECT}
    WHERE img.product_code = $1
      AND img.is_active = TRUE
    ORDER BY
      (img.barcode_id IS NULL) DESC,
      img.is_primary DESC,
      img.position ASC,
      img.product_image_id ASC
    LIMIT 1;
    `,
    [productCode]
  );
  return rows[0] || null;
}

export async function getPrimaryImageByProductId(productId) {
  const productCode = await resolveProductCode(productId);
  if (!productCode) return null;
  return getPrimaryImageByProductCode(productCode);
}

export async function getById(productImageId) {
  return getByIdWithClient(pool, productImageId);
}

async function getByIdWithClient(client, productImageId) {
  const { rows } = await client.query(
    `
    ${BASE_SELECT}
    WHERE img.product_image_id = $1
    LIMIT 1;
    `,
    [productImageId]
  );
  return rows[0] || null;
}

/* =========================================================================
   Helpers de negócio (escopo: product_code + barcode_id)
   ========================================================================= */

async function clearPrimaryForUnit(client, productCode, barcodeId, exceptId = null) {
  await client.query(
    `
    UPDATE ${TB}
       SET is_primary = FALSE
     WHERE product_code = $1
       AND barcode_id IS NOT DISTINCT FROM $2
       AND is_primary = TRUE
       AND ($3::bigint IS NULL OR product_image_id <> $3::bigint);
    `,
    [productCode, barcodeId, exceptId]
  );
}

async function ensureOnePrimaryIfPossible(client, productCode, barcodeId) {
  const { rows } = await client.query(
    `
    SELECT product_image_id, is_primary
      FROM ${TB}
     WHERE product_code = $1
       AND barcode_id IS NOT DISTINCT FROM $2
       AND is_active = TRUE
     ORDER BY is_primary DESC, position ASC, product_image_id ASC;
    `,
    [productCode, barcodeId]
  );

  if (!rows.length || rows[0].is_primary) return;

  await client.query(
    `UPDATE ${TB} SET is_primary = TRUE WHERE product_image_id = $1;`,
    [rows[0].product_image_id]
  );
}

async function normalizePositions(client, productCode, barcodeId) {
  await client.query(
    `
    WITH ordered AS (
      SELECT product_image_id,
             ROW_NUMBER() OVER (ORDER BY position ASC, product_image_id ASC) AS new_pos
        FROM ${TB}
       WHERE product_code = $1
         AND barcode_id IS NOT DISTINCT FROM $2
    )
    UPDATE ${TB} t
       SET position = o.new_pos
      FROM ordered o
     WHERE t.product_image_id = o.product_image_id
       AND t.position <> o.new_pos;
    `,
    [productCode, barcodeId]
  );
}

// products.product_imagem_id aponta apenas para a imagem geral principal.
async function syncProductPrimaryImage(client, productCode) {
  await client.query(
    `
    UPDATE ${TB_PRODUCTS}
       SET product_imagem_id = (
             SELECT product_image_id
               FROM ${TB}
              WHERE product_code = $1
                AND barcode_id IS NULL
                AND is_active = TRUE
                AND is_primary = TRUE
              ORDER BY position ASC, product_image_id ASC
              LIMIT 1
           ),
           updated_at = NOW()
     WHERE product_code = $1;
    `,
    [productCode]
  );
}

async function assertBarcodeBelongsToProduct(client, barcodeId, productCode) {
  const { rows } = await client.query(
    `
    SELECT 1
      FROM public."productsBarCode"
     WHERE barcode_id = $1
       AND product_code = $2
       AND is_active = TRUE
     LIMIT 1;
    `,
    [barcodeId, productCode]
  );

  if (!rows.length) {
    const err = new Error('A unidade (barcode_id) não pertence a este produto.');
    err.status = 400;
    throw err;
  }
}

async function refreshUnit(client, productCode, barcodeId) {
  await normalizePositions(client, productCode, barcodeId);
  await ensureOnePrimaryIfPossible(client, productCode, barcodeId);
  if (barcodeId === null) await syncProductPrimaryImage(client, productCode);
}

async function withTransaction(label, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    console.error(`[productsImagensApi.${label}] erro:`, error);
    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================================
   Insert
   ========================================================================= */

export async function addImage({
  product_code = null,
  product_id = null,
  barcode_id = null,
  image_url,
  image_path = null,
  image_alt = null,
  is_primary = false,
  position = null,
  is_active = true
}) {
  return withTransaction('addImage', async (client) => {
    const productCode =
      normalizeNullableString(product_code) ||
      (await resolveProductCode(product_id, client));

    if (!productCode) throw new Error('product_code (ou product_id) inválido para inserção.');

    const imageUrl = normalizeRequiredString(image_url);
    if (!imageUrl) throw new Error('image_url é obrigatório para inserção.');

    const barcodeId = normalizeBarcodeId(barcode_id);
    const isPrimary = Boolean(is_primary);

    if (barcodeId !== null) await assertBarcodeBelongsToProduct(client, barcodeId, productCode);

    if (isPrimary) await clearPrimaryForUnit(client, productCode, barcodeId);

    // Sem posição informada → vai para o final da unidade.
    const { rows: [{ next_pos: nextPos }] } = await client.query(
      `
      SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
        FROM ${TB}
       WHERE product_code = $1
         AND barcode_id IS NOT DISTINCT FROM $2;
      `,
      [productCode, barcodeId]
    );

    const { rows: [created] } = await client.query(
      `
      INSERT INTO ${TB} (
        product_code, barcode_id, image_url, image_path, image_alt,
        is_primary, position, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING product_image_id;
      `,
      [
        productCode,
        barcodeId,
        imageUrl,
        normalizeNullableString(image_path),
        normalizeNullableString(image_alt),
        isPrimary,
        normalizePositiveInt(position, nextPos),
        Boolean(is_active)
      ]
    );

    await refreshUnit(client, productCode, barcodeId);
    return getByIdWithClient(client, created.product_image_id);
  });
}

/* =========================================================================
   Update
   ========================================================================= */

export async function updateImage(productImageId, fields = {}) {
  return withTransaction('updateImage', async (client) => {
    const current = await getByIdWithClient(client, productImageId);
    if (!current) return null;

    const has = (key) => Object.prototype.hasOwnProperty.call(fields, key);

    const next = {
      image_url: has('image_url') ? normalizeRequiredString(fields.image_url) : current.image_url,
      image_path: has('image_path') ? normalizeNullableString(fields.image_path) : current.image_path,
      image_alt: has('image_alt') ? normalizeNullableString(fields.image_alt) : current.image_alt,
      is_primary: has('is_primary') ? Boolean(fields.is_primary) : current.is_primary,
      position: has('position') ? normalizePositiveInt(fields.position, 1) : normalizePositiveInt(current.position, 1),
      is_active: has('is_active') ? Boolean(fields.is_active) : current.is_active
    };

    if (!next.image_url) throw new Error('image_url não pode ficar vazio.');
    if (!next.is_active) next.is_primary = false;

    const currentBarcodeId = current.barcode_id === null ? null : Number(current.barcode_id);
    const barcodeId = has('barcode_id') ? normalizeBarcodeId(fields.barcode_id) : currentBarcodeId;
    const movedUnit = barcodeId !== currentBarcodeId;

    if (movedUnit) {
      if (barcodeId !== null) await assertBarcodeBelongsToProduct(client, barcodeId, current.product_code);

      // Ao trocar de unidade vai para o final e só vira principal se pedido
      // (ou se a unidade de destino não tiver principal — ver refreshUnit).
      if (!has('is_primary')) next.is_primary = false;
      if (!has('position')) {
        const { rows: [{ next_pos: nextPos }] } = await client.query(
          `
          SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
            FROM ${TB}
           WHERE product_code = $1
             AND barcode_id IS NOT DISTINCT FROM $2;
          `,
          [current.product_code, barcodeId]
        );
        next.position = nextPos;
      }
    }

    if (next.is_primary) {
      await clearPrimaryForUnit(client, current.product_code, barcodeId, productImageId);
    }

    await client.query(
      `
      UPDATE ${TB}
         SET image_url = $1,
             image_path = $2,
             image_alt = $3,
             is_primary = $4,
             position = $5,
             is_active = $6,
             barcode_id = $7
       WHERE product_image_id = $8;
      `,
      [
        next.image_url,
        next.image_path,
        next.image_alt,
        next.is_primary,
        next.position,
        next.is_active,
        barcodeId,
        productImageId
      ]
    );

    await refreshUnit(client, current.product_code, barcodeId);
    if (movedUnit) await refreshUnit(client, current.product_code, currentBarcodeId);
    return getByIdWithClient(client, productImageId);
  });
}

/* =========================================================================
   Primary image
   ========================================================================= */

export async function setPrimaryImage(productImageId) {
  return withTransaction('setPrimaryImage', async (client) => {
    const target = await getByIdWithClient(client, productImageId);
    if (!target) return null;
    if (!target.is_active) throw new Error('Não é possível definir uma imagem inativa como principal.');

    const barcodeId = target.barcode_id === null ? null : Number(target.barcode_id);

    await clearPrimaryForUnit(client, target.product_code, barcodeId);
    await client.query(
      `UPDATE ${TB} SET is_primary = TRUE WHERE product_image_id = $1;`,
      [productImageId]
    );

    await refreshUnit(client, target.product_code, barcodeId);
    return getByIdWithClient(client, productImageId);
  });
}

/* =========================================================================
   Delete
   ========================================================================= */

export async function softDeleteImage(productImageId) {
  return withTransaction('softDeleteImage', async (client) => {
    const current = await getByIdWithClient(client, productImageId);
    if (!current) return null;

    await client.query(
      `
      UPDATE ${TB}
         SET is_active = FALSE,
             is_primary = FALSE
       WHERE product_image_id = $1;
      `,
      [productImageId]
    );

    const barcodeId = current.barcode_id === null ? null : Number(current.barcode_id);
    await refreshUnit(client, current.product_code, barcodeId);
    return getByIdWithClient(client, productImageId);
  });
}

export async function hardDeleteImage(productImageId) {
  return withTransaction('hardDeleteImage', async (client) => {
    const current = await getByIdWithClient(client, productImageId);
    if (!current) return false;

    const { rowCount } = await client.query(
      `DELETE FROM ${TB} WHERE product_image_id = $1;`,
      [productImageId]
    );

    const barcodeId = current.barcode_id === null ? null : Number(current.barcode_id);
    await refreshUnit(client, current.product_code, barcodeId);
    return rowCount > 0;
  });
}

/* =========================================================================
   Reorder (imagens gerais do produto — barcode_id NULL)
   ========================================================================= */

export async function reorderImages(productCode, orderedIds = []) {
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return [];

  return withTransaction('reorderImages', async (client) => {
    const { rows: validRows } = await client.query(
      `
      SELECT product_image_id
        FROM ${TB}
       WHERE product_code = $1
         AND barcode_id IS NULL
       ORDER BY position ASC, product_image_id ASC;
      `,
      [productCode]
    );

    const validIds = validRows.map((r) => Number(r.product_image_id));
    const validSet = new Set(validIds);
    const filteredIds = [...new Set(
      orderedIds
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && validSet.has(id))
    )];

    if (!filteredIds.length) {
      throw new Error('Nenhum ID válido foi informado para reordenação.');
    }

    const finalOrder = [...filteredIds, ...validIds.filter((id) => !filteredIds.includes(id))];

    await client.query(
      `
      UPDATE ${TB} t
         SET position = o.ord
        FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, ord)
       WHERE t.product_image_id = o.id
         AND t.position <> o.ord;
      `,
      [finalOrder]
    );

    await refreshUnit(client, productCode, null);

    const { rows } = await client.query(
      `
      ${BASE_SELECT}
      WHERE img.product_code = $1
      ${ORDER_BY};
      `,
      [productCode]
    );
    return rows;
  });
}

/* =========================================================================
   Export default
   ========================================================================= */

const productsImagensApi = {
  resolveProductCode,
  listAll,
  listByProductCode,
  listByProductId,
  getPrimaryImageByProductCode,
  getPrimaryImageByProductId,
  getById,
  addImage,
  updateImage,
  setPrimaryImage,
  softDeleteImage,
  hardDeleteImage,
  reorderImages
};

export default productsImagensApi;
