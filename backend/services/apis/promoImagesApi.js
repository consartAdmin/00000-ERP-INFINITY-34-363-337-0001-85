// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: backend/services/apis/promoImagesApi.js                       ║
// ║ MODULE: Promo Images API / DAL                                      ║
// ║ CONSART ERP | ESM | PostgreSQL                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import pool from '../../config/db.js';

import axios from 'axios';

const PUBLIC_DIR = path.resolve(process.cwd(), 'backend/public');
const PROMO_DIR = path.join(PUBLIC_DIR, 'promocoes');
const LOGO_PATH = path.join(PUBLIC_DIR, 'imagens', 'logo-bh3.png');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function moneyBR(value) {
  const n = Number(value || 0);
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function safeText(v) {
  return String(v ?? '').trim();
}

function safeLimit(v, def = 30) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.trunc(n), 100);
}

function normalizePriceId(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function escapeXml(v) {
  return safeText(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function sanitizeFileName(v) {
  return safeText(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function normalizeImageUrl(row = {}) {
  return (
    row.image_url ||
    row.url ||
    row.path ||
    row.file_path ||
    row.image_path ||
    row.imagem ||
    row.foto ||
    row.src ||
    ''
  );
}

function resolvePublicImagePath(imageUrl) {
  const raw = safeText(imageUrl);
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) return raw;

  const cleaned = raw.replace(/^\/+/, '');

  const candidates = [
    path.resolve(process.cwd(), raw),
    path.resolve(process.cwd(), cleaned),
    path.join(PUBLIC_DIR, cleaned.replace(/^public[\\/]/, '')),
    path.join(PUBLIC_DIR, cleaned.replace(/^backend[\\/]public[\\/]/, '')),
  ];

  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function columnExists(tableName, columnName) {
  const { rows } = await pool.query(
    `
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2
     LIMIT 1
    `,
    [tableName, columnName]
  );

  return rows.length > 0;
}

async function getProductsImageColumn() {
  const candidates = [
    'image_url',
    'url',
    'path',
    'file_path',
    'image_path',
    'imagem',
    'foto',
    'src',
  ];

  for (const col of candidates) {
    if (await columnExists('productsImages', col)) return col;
  }

  return null;
}

async function getProductsNameColumn() {
  const candidates = [
    'description',
    'descricao',
    'name',
    'nome',
    'product_name',
    'nome_produto',
  ];

  for (const col of candidates) {
    if (await columnExists('products', col)) return col;
  }

  return 'description';
}

async function getProductCodeColumn(tableName) {
  const candidates = ['product_code', 'sku', 'code', 'codigo'];

  for (const col of candidates) {
    if (await columnExists(tableName, col)) return col;
  }

  return 'product_code';
}

async function getPriceColumn() {
  const candidates = [
    'preco_venda',
    'price',
    'valor',
    'sale_price',
    'unit_price',
    'preco',
  ];

  for (const col of candidates) {
    if (await columnExists('productsPrices', col)) return col;
  }

  return 'preco_venda';
}

export async function listPriceTables() {
  const { rows } = await pool.query(`
    SELECT
      price_id::integer AS id,
      name,
      description,
      active
    FROM public."prices"
    WHERE active = true
    ORDER BY name
  `);

  return rows;
}

export async function searchProducts({
  price_id = null,
  tabela_preco_id = null,
  q = '',
  limit = 30,
} = {}) {
  const finalPriceId = normalizePriceId(price_id ?? tabela_preco_id);

  if (!finalPriceId) {
    const err = new Error('Informe price_id válido.');
    err.status = 400;
    throw err;
  }

  const term = `%${safeText(q)}%`;
  const finalLimit = safeLimit(limit);

  const { rows } = await pool.query(
    `
    SELECT
      p.product_id,
      p.product_code::text,
      p.description::text,

      'UN'::text AS unit,

      COALESCE(pp.sale_price, 0)::numeric AS price,

      pi.image_url::text AS image_url

    FROM public.products p

    INNER JOIN public."productsPrices" pp
      ON pp.product_id = p.product_id::text
     AND pp.price_id = $1::integer

    LEFT JOIN LATERAL (
      SELECT img.image_url
        FROM public."productsImages" img
       WHERE img.product_code = p.product_code
         AND img.is_active = TRUE
       ORDER BY
         (img.barcode_id IS NULL) DESC,
         img.is_primary DESC,
         img.position ASC,
         img.product_image_id ASC
       LIMIT 1
    ) pi ON TRUE

    WHERE (
         $2::text = '%%'
      OR p.product_code::text ILIKE $2::text
      OR p.description::text ILIKE $2::text
    )

    ORDER BY p.description

    LIMIT $3::integer
    `,
    [
      finalPriceId,
      term,
      finalLimit,
    ]
  );

  return rows.map((row) => ({
    ...row,
    image_url: normalizeImageUrl(row),
  }));
}

async function getProductForPromo({ price_id, tabela_preco_id, product_code }) {
  const rows = await searchProducts({
    price_id: price_id ?? tabela_preco_id,
    q: product_code,
    limit: 20,
  });

  const cleanCode = safeText(product_code);

  return (
    rows.find((r) => safeText(r.product_code) === cleanCode) ||
    rows[0] ||
    null
  );
}

async function createPlaceholderImage() {
  return sharp({
    create: {
      width: 520,
      height: 520,
      channels: 4,
      background: '#f3f4f6',
    },
  })
    .composite([
      {
        input: Buffer.from(`
          <svg width="520" height="520" xmlns="http://www.w3.org/2000/svg">
            <rect width="520" height="520" fill="#f3f4f6"/>
            <text x="260" y="250" font-size="34" fill="#9ca3af" text-anchor="middle" font-family="Arial">SEM IMAGEM</text>
          </svg>
        `),
      },
    ])
    .png()
    .toBuffer();
}

export async function generatePromoImage({
  price_id = null,
  tabela_preco_id = null,
  product_code,
  title = 'PROMOÇÃO',
  subtitle = 'BH3 Distribuidora',
  old_price = null,
  promo_price = null,
  output_name = '',
} = {}) {
  const finalPriceId = normalizePriceId(price_id ?? tabela_preco_id);

  if (!finalPriceId) {
    const err = new Error('Informe price_id.');
    err.status = 400;
    throw err;
  }

  if (!product_code) {
    const err = new Error('Informe product_code.');
    err.status = 400;
    throw err;
  }

  ensureDir(PROMO_DIR);

  const product = await getProductForPromo({
    price_id: finalPriceId,
    product_code,
  });

  if (!product) {
    const err = new Error('Produto não encontrado para esta tabela de preço.');
    err.status = 404;
    throw err;
  }

  const finalPrice = Number(promo_price || product.price || 0);
  const oldPrice = old_price ? Number(old_price) : null;

  const imagePath = resolvePublicImagePath(product.image_url);

  let productImageBuffer;

  if (imagePath) {

    if (/^https?:\/\//i.test(imagePath)) {

      const response = await axios.get(imagePath, {
        responseType: 'arraybuffer',
        timeout: 15000,
      });

      productImageBuffer = await sharp(
        Buffer.from(response.data)
      )
        .resize(520, 520, {
          fit: 'contain',
          background: '#ffffff',
        })
        .png()
        .toBuffer();

    } else {

      productImageBuffer = await sharp(imagePath)
        .resize(520, 520, {
          fit: 'contain',
          background: '#ffffff',
        })
        .png()
        .toBuffer();

    }

  } else {

    productImageBuffer = await createPlaceholderImage();

  }

  const logoExists = fs.existsSync(LOGO_PATH);

  const canvasW = 1080;
  const canvasH = 1350;

  const description = escapeXml(product.description || 'Produto');
  const sku = escapeXml(product.product_code);
  const unit = escapeXml(product.unit || 'UN');

  const svg = `
    <svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#0f4c81"/>
          <stop offset="55%" stop-color="#1368a8"/>
          <stop offset="100%" stop-color="#e5e7eb"/>
        </linearGradient>
      </defs>

      <rect width="1080" height="1350" fill="url(#bg)"/>
      <rect x="60" y="60" width="960" height="1230" rx="42" fill="#ffffff" opacity="0.97"/>
      <rect x="60" y="60" width="960" height="170" rx="42" fill="#0f4c81"/>

      <text x="540" y="165" font-size="74" fill="#ffffff" text-anchor="middle" font-family="Arial" font-weight="900">
        ${escapeXml(title)}
      </text>

      <text x="540" y="285" font-size="32" fill="#334155" text-anchor="middle" font-family="Arial" font-weight="700">
        ${escapeXml(subtitle)}
      </text>

      <rect x="110" y="330" width="860" height="560" rx="36" fill="#f8fafc" stroke="#e2e8f0" stroke-width="3"/>

      <text x="540" y="975" font-size="46" fill="#0f172a" text-anchor="middle" font-family="Arial" font-weight="800">
        ${description.substring(0, 34)}
      </text>

      <text x="540" y="1028" font-size="28" fill="#64748b" text-anchor="middle" font-family="Arial">
        SKU: ${sku} • ${unit}
      </text>

      ${oldPrice
      ? `<text x="540" y="1105" font-size="42" fill="#64748b" text-anchor="middle" font-family="Arial" text-decoration="line-through">
              De ${escapeXml(moneyBR(oldPrice))}
            </text>`
      : ''
    }

      <text x="540" y="${oldPrice ? 1195 : 1155}" font-size="86" fill="#dc2626" text-anchor="middle" font-family="Arial" font-weight="900">
        ${escapeXml(moneyBR(finalPrice))}
      </text>

      <rect x="185" y="1230" width="710" height="52" rx="26" fill="#16a34a"/>
      <text x="540" y="1267" font-size="28" fill="#ffffff" text-anchor="middle" font-family="Arial" font-weight="800">
        Consulte condições e disponibilidade
      </text>
    </svg>
  `;

  const composites = [
    {
      input: Buffer.from(svg),
      top: 0,
      left: 0,
    },
    {
      input: productImageBuffer,
      top: 350,
      left: 280,
    },
  ];

  if (logoExists) {
    const logoBuffer = await sharp(LOGO_PATH)
      .resize(180, 90, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();

    composites.push({
      input: logoBuffer,
      top: 78,
      left: 80,
    });
  }

  const filenameBase =
    sanitizeFileName(output_name) ||
    `promocao-${sanitizeFileName(product.product_code)}-${Date.now()}`;

  const filename = `${filenameBase}.png`;
  const fullPath = path.join(PROMO_DIR, filename);

  const buffer =
    await buildPromoImageBuffer({
      price_id: finalPriceId,
      product_code,
      title,
      subtitle,
      old_price,
      promo_price,
    });

  await fs.promises.writeFile(
    fullPath,
    buffer
  );

  return {
    ok: true,
    product,
    filename,
    path: fullPath,
    url: `/public/promocoes/${filename}`,
  };
}

export async function previewPromoImage(payload) {

  const buffer =
    await buildPromoImageBuffer(payload);

  return {
    preview:
      `data:image/png;base64,${buffer.toString('base64')}`
  };
}

async function buildPromoImageBuffer({
  price_id = null,
  tabela_preco_id = null,
  product_code,
  title = 'PROMOÇÃO',
  subtitle = 'BH3 Distribuidora',
  old_price = null,
  promo_price = null,
} = {}) {

  const finalPriceId =
    normalizePriceId(price_id ?? tabela_preco_id);

  const product = await getProductForPromo({
    price_id: finalPriceId,
    product_code,
  });

  if (!product) {
    throw new Error(
      'Produto não encontrado para esta tabela de preço.'
    );
  }

  const finalPrice =
    Number(promo_price || product.price || 0);

  const oldPriceValue =
    old_price ? Number(old_price) : null;

  const imagePath =
    resolvePublicImagePath(product.image_url);

  let productImageBuffer;

  try {

    if (imagePath) {

      if (/^https?:\/\//i.test(imagePath)) {

        const response =
          await axios.get(imagePath, {
            responseType: 'arraybuffer',
            timeout: 15000,
          });

        productImageBuffer =
          await sharp(
            Buffer.from(response.data)
          )
            .resize(520, 520, {
              fit: 'contain',
              background: '#ffffff',
            })
            .png()
            .toBuffer();

      } else {

        productImageBuffer =
          await sharp(imagePath)
            .resize(520, 520, {
              fit: 'contain',
              background: '#ffffff',
            })
            .png()
            .toBuffer();

      }

    } else {

      productImageBuffer =
        await createPlaceholderImage();

    }

  } catch {

    productImageBuffer =
      await createPlaceholderImage();

  }

  const logoExists =
    fs.existsSync(LOGO_PATH);

  const canvasW = 1080;
  const canvasH = 1350;

  const description =
    escapeXml(product.description || 'Produto');

  const sku =
    escapeXml(product.product_code);

  const unit =
    escapeXml(product.unit || 'UN');

  const svg = `SEU SVG ATUAL AQUI`;

  const composites = [
    {
      input: Buffer.from(svg),
      top: 0,
      left: 0,
    },
    {
      input: productImageBuffer,
      top: 350,
      left: 280,
    },
  ];

  if (logoExists) {

    const logoBuffer =
      await sharp(LOGO_PATH)
        .resize(180, 90, {
          fit: 'contain',
          background: {
            r: 255,
            g: 255,
            b: 255,
            alpha: 0,
          },
        })
        .png()
        .toBuffer();

    composites.push({
      input: logoBuffer,
      top: 78,
      left: 80,
    });

  }

  return await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: '#ffffff',
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

export default {
  listPriceTables,
  searchProducts,
  previewPromoImage,
  generatePromoImage,
};