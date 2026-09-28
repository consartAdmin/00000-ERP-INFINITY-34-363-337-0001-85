// ╔══════════════════════════════════════════════════════════════════════╗
// ║ products.render.js — Lista, normalização e render da tabela          ║
// ║ CONSART ERP | ESM                                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { state } from './products.state.js';
import { dedupeById, fmtMoney, fmtNumber, qsa, sanitize } from './products.utils.js';
import { getTableBody, setFooterInfo, setStatus } from './products.dom.js';
import { loadFromApi } from './products.api.js';
import { renderPagination } from './products.pagination.js';
import { bindCameraButtons } from './products.camera.js';
import { onUploadImageTable } from './products.upload.js';
import { makeRowDraggable, updateCameraFocusStyles } from './products.dragdrop.js';

const FIXED_PRICE_KEYS = new Set([
  'cost_price', 'preco_custo',
  'price_varejo', 'preco_varejo', 'preco_venda', 'sale_price', 'retail_price',
  'cost', 'custo', 'retail', 'varejo', 'sale', 'venda',
]);

function humanizePriceLabel(value) {
  const text = String(value ?? '')
    .replace(/^(price|preco)_?/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) return 'Outro preço';
  return `Preço ${text.replace(/\b\w/g, (letter) => letter.toUpperCase())}`;
}

function normalizePriceItem(item, index) {
  if (item == null) return null;

  if (typeof item !== 'object') {
    return { key: `price_${index + 1}`, label: `Preço ${index + 1}`, value: item };
  }

  const rawKey = item.key ?? item.code ?? item.codigo ?? item.price_type ??
    item.tipo_preco ?? item.type ?? item.tipo ?? item.name ?? item.nome ?? `price_${index + 1}`;
  const label = item.label ?? item.description ?? item.descricao ?? item.name ?? item.nome ??
    humanizePriceLabel(rawKey);
  const value = item.value ?? item.valor ?? item.price ?? item.preco ?? item.amount ?? null;

  return { key: String(rawKey), label: String(label), value };
}

/** Retorna todos os preços adicionais enviados pelo backend para um produto. */
export function extractAdditionalPrices(row = {}) {
  const prices = [];
  const nested = row.prices ?? row.product_prices ?? row.productPrices ?? row.precos;

  if (Array.isArray(nested)) {
    nested.forEach((item, index) => {
      const normalized = normalizePriceItem(item, index);
      if (normalized) prices.push(normalized);
    });
  } else if (nested && typeof nested === 'object') {
    Object.entries(nested).forEach(([key, value], index) => {
      const normalized = normalizePriceItem(
        value && typeof value === 'object' ? { ...value, key: value.key ?? key } : { key, value },
        index,
      );
      if (normalized) prices.push(normalized);
    });
  }

  Object.entries(row).forEach(([key, value]) => {
    if (!/^(price|preco)_/i.test(key) || FIXED_PRICE_KEYS.has(key.toLowerCase())) return;
    if (value != null && typeof value !== 'object') {
      prices.push({ key, label: humanizePriceLabel(key), value });
    }
  });

  const unique = new Map();
  prices.forEach((price) => {
    const key = String(price.key).trim().toLowerCase();
    if (key && !FIXED_PRICE_KEYS.has(key) && !unique.has(key)) unique.set(key, price);
  });
  return [...unique.values()];
}

function getAdditionalPriceColumns(rows = []) {
  const columns = new Map();
  rows.forEach((row) => {
    extractAdditionalPrices(row).forEach(({ key, label }) => {
      const normalizedKey = String(key).trim().toLowerCase();
      if (!columns.has(normalizedKey)) columns.set(normalizedKey, { key: normalizedKey, label });
    });
  });
  return [...columns.values()];
}

export function renderTableHeader(additionalPriceColumns = []) {
  const header = document.querySelector('#productsTableHeader');
  if (!header) return;

  header.innerHTML = `
    <th class="col-id">ID</th>
    <th class="col-code">Código</th>
    <th class="col-descricao">Descrição</th>
    <th class="col-codbarras">Cód. Barras</th>
    <th class="col-ref">Ref. Fab.</th>
    <th class="text-right col-preco-custo">Preço de Custo</th>
    <th class="text-right col-preco-varejo">Preço Varejo</th>
    ${additionalPriceColumns.map(({ label }) =>
      `<th class="text-right col-preco-adicional">${sanitize(label)}</th>`).join('')}
    <th class="text-right col-estoque">Estoque</th>
    <th class="col-local">Localização</th>
    <th class="col-ativo">Status</th>
    <th class="col-fiscal">Prod. Fiscal</th>
    ${state.showImages ? '<th class="text-center col-img">Imagem</th>' : ''}
    <th class="text-center col-actions">Ações</th>
  `;
}

export function mapRow(r) {
  const product_imagem_id = r.product_imagem_id ?? r.productImagemId ?? null;

  const image_url = r.image_url ?? r.imagem_url ?? '';
  const image_path = r.image_path ?? r.imagePath ?? r.imagem_path ?? '';

  const product_fiscal_id =
    r.product_fiscal_id ??
    r.produto_fiscal_id ??
    r.products_fiscal_id ??
    null;

  const has_fiscal_product =
    (typeof r.has_fiscal_product === 'boolean')
      ? r.has_fiscal_product
      : (typeof r.hasFiscalProduct === 'boolean')
        ? r.hasFiscalProduct
        : !!product_fiscal_id;

  const stockValue =
    r.stock ??
    r.stock_qty ??
    r.estoque ??
    null;

  const priceRetail =
    r.price_varejo ??
    r.preco_venda ??
    r.sale_price ??
    null;

  return {
    product_id: r.product_id ?? r.produto_id ?? r.id ?? null,
    product_code: r.product_code ?? r.sku ?? r.codigo ?? '',
    description: r.description ?? r.descricao ?? '',
    barcode: r.barcode ?? r.codigo_barras ?? '',
    manufacturer_ref: r.manufacturer_ref ?? r.ref_fabricante ?? '',
    cost_price: r.cost_price ?? r.preco_custo ?? null,

    stock: stockValue,
    price_retail: priceRetail,
    additional_prices: extractAdditionalPrices(r),

    location_description:
      r.location_description ??
      r.locationDescription ??
      r.location ??
      r.localizacao ??
      null,

    product_imagem_id,
    image_url,
    image_path,
    has_image: !!(product_imagem_id || image_url || image_path),

    has_fiscal_product,
    is_active: (typeof r.is_active === 'boolean') ? r.is_active : true,
  };
}

export function renderTable(rows) {
  const tbody = getTableBody();
  if (!tbody) return;

  tbody.innerHTML = '';
  const additionalPriceColumns = getAdditionalPriceColumns(rows);
  renderTableHeader(additionalPriceColumns);

  if (!rows?.length) {
    const tr = document.createElement('tr');
    const colspan = 13 + additionalPriceColumns.length - (state.showImages ? 0 : 1);
    tr.innerHTML = `<td colspan="${colspan}" class="empty">Nenhum produto encontrado.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const raw of rows) {
    const r = mapRow(raw);
    const productCodeParam = encodeURIComponent(String(r.product_code ?? '').trim());

    const tr = document.createElement('tr');
    tr.dataset.id = r.product_id ?? '';
    tr.dataset.productCode = String(r.product_code ?? '').trim();

    const ativoBadge = r.is_active
      ? `<span class="badge ok">Ativo</span>`
      : `<span class="badge off">Inativo</span>`;

    const precoCusto = fmtMoney(r.cost_price);
    const precoVarejo = fmtMoney(r.price_retail);
    const additionalPrices = new Map(
      r.additional_prices.map((price) => [String(price.key).trim().toLowerCase(), price.value]),
    );
    const estoque = (r.stock == null ? '—' : fmtNumber(r.stock));
    const hasImg = !!r.has_image;

    const fiscalIcon = r.has_fiscal_product
      ? `<span class="pf-icon pf-ok">✓</span>`
      : `<span class="pf-icon pf-none">✕</span>`;

    const cameraBtn = `
      <button
      type="button"
      class="btn btn-toolbar btn-sm btn-camera ${hasImg ? 'has-image' : 'no-image'}"
      data-url="${sanitize(r.image_url || '')}"
      data-path="${sanitize(r.image_path || '')}"
      title="${hasImg ? 'Visualizar foto' : 'Sem foto'}"
      aria-label="${hasImg ? 'Visualizar foto' : 'Sem foto'}"
      >
      <span class="camera-icon" aria-hidden="true">📷</span>
      </button>
      `;

    tr.innerHTML = `
      <td class="col-id">${r.product_id ?? ''}</td>
      <td class="col-code">${sanitize(r.product_code)}</td>
      <td class="col-descricao">${sanitize(r.description)}</td>
      <td class="col-codbarras">${sanitize(r.barcode) || '—'}</td>
      <td class="col-ref">${sanitize(r.manufacturer_ref) || '—'}</td>
      <td class="col-preco-custo">${precoCusto}</td>
      <td class="col-preco-varejo">${precoVarejo}</td>
      ${additionalPriceColumns.map(({ key }) =>
        `<td class="col-preco-adicional">${fmtMoney(additionalPrices.get(key))}</td>`).join('')}
      <td class="col-estoque">${estoque}</td>
      <td class="col-local">${sanitize(r.location_description || '—')}</td>
      <td class="col-ativo">${ativoBadge}</td>
      <td class="col-fiscal">${fiscalIcon}</td>

      ${state.showImages ? `
      <td class="col-img">
        ${cameraBtn}
        <label class="btn btn-toolbar btn-sm btn-upload" title="Enviar imagem">
          📎
          <input
            type="file"
            accept="image/*"
            data-product-code="${sanitize(r.product_code)}"
            hidden
          >
        </label>
      </td>
      ` : ''}

      <td class="col-actions">
        <a
          class="btn btn-toolbar btn-sm"
          href="/public/editProducts/editProducts.html?product_code=${productCodeParam}"
          title="Editar produto ${sanitize(r.product_code)}"
        >✏️</a>
      </td>
    `;

    tbody.appendChild(tr);
    makeRowDraggable(tr, r.product_id);
  }

  qsa('input[type="file"][data-product-code]', tbody).forEach((inp) => {
    inp.addEventListener('change', onUploadImageTable);
  });

  bindCameraButtons(tbody);
  updateCameraFocusStyles();
}

export async function loadProducts() {
  try {
    if (state.loading) state.aborter?.abort?.();
    state.aborter = new AbortController();
    state.loading = true;

    setStatus('Carregando produtos…');
    setFooterInfo({ total: null, page: null, pages: null });

    const data = await loadFromApi({
      q: state.q,
      page: state.page,
      limit: state.limit,

      /* ✅ FILTROS */
      filters: state.filters,

      signal: state.aborter.signal,
    });

    const rows = dedupeById(data?.rows);

    renderTable(rows);

    renderPagination({
      total: data?.total ?? 0,
      page: data?.page ?? state.page,
      limit: data?.limit ?? state.limit,
      onPageChange: loadProducts,
    });

    setStatus(`${data?.total ?? rows.length} produto(s)`, 'info');

    const total = Number(data?.total ?? rows.length) || 0;
    const pages = Math.max(Math.ceil(total / (state.limit || 1)), 1);
    setFooterInfo({ total, page: state.page, pages });

  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error('Erro ao carregar products:', err);
    setStatus(`Erro ao carregar products: ${err.message || err}`, 'error');
    setFooterInfo({ total: null, page: null, pages: null });
  } finally {
    state.loading = false;
  }
}
