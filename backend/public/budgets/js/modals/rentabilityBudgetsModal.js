// ╔══════════════════════════════════════════════════════════════════════╗
// ║ rentabilityBudgetsModal.js — Modal de Rentabilidade (CONSART ERP)    ║
// ║ Layout: modals.css + table.css + fields.css + summary.css (style.css)║
// ║ - Custo: products.cost_price (por SKU) × fator da U.M (productUnits)  ║
// ║ - Impostos: alíquotas do cadastro fiscal do produto (productsFiscal  ║
// ║   + fiscalProfile) via /api/products/tax-map                         ║
// ║   ICMS × (1 − redução BC) + PIS + COFINS + IPI + FCP sobre a receita ║
// ║ - Lucro = Receita − Custo − Impostos | Margem = Lucro / Receita      ║
// ║ - Custo unit. e % de impostos editáveis; "Aplicar" guarda os ajustes ║
// ║   nos itens do orçamento aberto (rent_cost_unit / rent_tax_pct)      ║
// ╚══════════════════════════════════════════════════════════════════════╝

const MODAL_ID = 'rbRentabilityModal';

/**
 * Abre o modal e calcula a rentabilidade.
 * @param {Object} args
 * @param {Array<Object>} args.items          itens do orçamento (sku, description, quantity, unit_price, discount_value, unit…)
 * @param {number=} args.freight_value
 * @param {string=} args.title
 * @returns {Promise<{ok:boolean, data?:any}>}
 */
export async function openRentabilityBudgetsModal(args = {}) {
  const items = Array.isArray(args.items) ? args.items : [];
  const freight = toNum(args.freight_value);
  const title = String(args.title || 'Rentabilidade do Orçamento');

  if (!items.length) return { ok: false, data: { reason: 'NO_ITEMS' } };

  const API_BASE = String(window.apiBase || window.API_BASE || window.location.origin).replace(/\/$/, '');
  const skus = uniq(items.map((x) => String(x.sku || '').trim()).filter(Boolean));
  const qs = encodeURIComponent(skus.join(','));

  // ------------------------------------------------------------------
  // Cadastro: custo, fator da U.M e impostos
  // ------------------------------------------------------------------
  const dbCostBySku = {};
  const dbFactorBySkuUnit = {};
  let taxBySku = {};
  let costOk = true;
  let taxOk = true;
  let loadError = '';

  const [costRes, factorRes, taxRes] = await Promise.all([
    fetchJson(`${API_BASE}/api/products/cost-map?codes=${qs}`).catch((e) => { costOk = false; loadError ||= e.message; console.warn('[rentability] cost-map', e); return null; }),
    fetchJson(`${API_BASE}/api/barcodes/factors?skus=${qs}`).catch((e) => { console.warn('[rentability] factors', e); return null; }),
    fetchJson(`${API_BASE}/api/products/tax-map?codes=${qs}`).catch((e) => { taxOk = false; loadError ||= e.message; console.warn('[rentability] tax-map', e); return null; }),
  ]);

  if (costRes?.ok) {
    if (isObj(costRes.data)) {
      for (const [k, v] of Object.entries(costRes.data)) {
        const c = toNum(v);
        if (String(k).trim() && c > 0) dbCostBySku[String(k).trim()] = c;
      }
    }
    if (Array.isArray(costRes.rows)) {
      for (const r of costRes.rows) {
        const sku = String(r.sku ?? r.product_code ?? '').trim();
        const c = toNum(r.cost_price ?? r.cost ?? r.preco_custo);
        if (sku && c > 0) dbCostBySku[sku] = c;
      }
    }
  } else {
    costOk = false;
  }

  if (factorRes?.ok && Array.isArray(factorRes.rows)) {
    for (const r of factorRes.rows) {
      const sku = String(r.sku ?? r.product_code ?? '').trim();
      const unit = normUnitLookup(r.unit ?? r.unit_code ?? r.um ?? r.unidade ?? '');
      const factor = toNum(r.factor ?? r.fator ?? r.multiplier ?? 1);
      if (sku && unit && factor > 0) dbFactorBySkuUnit[`${sku}||${unit}`] = factor;
    }
  }

  if (taxRes?.ok && isObj(taxRes.data)) taxBySku = taxRes.data;
  else taxOk = false;

  // ------------------------------------------------------------------
  // Estado por item
  // ------------------------------------------------------------------
  const rows = items.map((it, idx) => {
    const sku = String(it.sku || '').trim();
    if (!sku) return null;

    const unitRaw = String(
      it.unit ?? it.unit_code ?? it.unidade ?? it.um ?? it.u_m ?? it.unidade_venda ??
      it.unidadeVenda ?? it.unit_name ?? it.product_unit ?? it.unidade_medida ?? ''
    ).trim();
    const unit = normUnitDisplay(unitRaw);
    const unitLookup = normUnitLookup(unit);

    // U.M "CX.10" sem fator cadastrado → usa o número da própria U.M
    const unitNumber = toNum((unit.match(/\.(\d+)$/) || [])[1]);
    const factor = toNum(dbFactorBySkuUnit[`${sku}||${unitLookup}`]) || unitNumber || 1;

    const baseCost = toNum(dbCostBySku[sku]) || toNum(it.cost_price) || toNum(it.preco_custo) || toNum(it.cost) || 0;
    const costFromDb = Math.max(0, baseCost * factor);

    const tax = isObj(taxBySku[sku]) ? taxBySku[sku] : null;
    const taxFromDb = tax ? effectiveTaxPct(tax) : 0;

    const qty = toNum(it.quantity);
    const unitPrice = toNum(it.unit_price);
    const disc = toNum(it.discount_value);

    return {
      idx,
      sku,
      description: String(it.description || ''),
      unit,
      factor,
      base_cost: baseCost,
      cost_db: costFromDb,
      tax,
      tax_db: taxFromDb,
      quantity: qty,
      unit_price: unitPrice,
      discount_value: disc,
      gross: qty * unitPrice,
      revenue: Math.max(0, qty * unitPrice - disc),
      cost_unit: it.rent_cost_unit != null ? Math.max(0, toNum(it.rent_cost_unit)) : costFromDb,
      tax_pct: it.rent_tax_pct != null ? Math.max(0, toNum(it.rent_tax_pct)) : taxFromDb,
    };
  }).filter(Boolean);

  // ------------------------------------------------------------------
  // Markup (somente classes do design system)
  // ------------------------------------------------------------------
  document.getElementById(MODAL_ID)?.remove();

  const root = document.createElement('div');
  root.id = MODAL_ID;
  root.className = 'modal is-open';
  root.setAttribute('aria-hidden', 'false');
  root.innerHTML = `
    <div class="modal__backdrop" data-rb-close></div>
    <div class="modal__dialog">
      <section class="modal__panel modal-width-12" role="dialog" aria-modal="true" aria-labelledby="rbTitle">
        <header class="modal__header modal-header-color-3">
          <div>
            <h2 id="rbTitle" class="modal__title">${escapeHtml(title)}</h2>
            <p class="modal__subtitle">Custo e impostos vêm do cadastro de cada produto. Ajuste o custo ou o % de impostos para simular.</p>
          </div>
          <button type="button" class="modal__close" data-rb-close title="Fechar" aria-label="Fechar">&times;</button>
        </header>

        <div class="modal__body modal-section">
          <div class="summary summary--left summary-gap-8" id="rbSummary"></div>

          <div class="modal-divider modal-divider--soft"></div>

          <div class="table-scroll table-scroll--rounded">
            <table class="table table-zebra table-zebra-hover table-sticky-head table-row-h-32">
              <thead>
                <tr>
                  <th class="table-col-w-3 th-left">SKU</th>
                  <th class="table-col-w-9 th-left">Descrição</th>
                  <th class="table-col-w-2">U.M</th>
                  <th class="table-col-w-2 th-right">Qtd</th>
                  <th class="table-col-w-3 th-right">Unit. (R$)</th>
                  <th class="table-col-w-3 th-right">Receita (R$)</th>
                  <th class="table-col-w-4 th-right">Custo unit. (R$)</th>
                  <th class="table-col-w-3 th-right">Custo total</th>
                  <th class="table-col-w-3 th-right">Impostos (%)</th>
                  <th class="table-col-w-3 th-right">Impostos (R$)</th>
                  <th class="table-col-w-3 th-right">Lucro (R$)</th>
                  <th class="table-col-w-3 th-right">Margem</th>
                </tr>
              </thead>
              <tbody id="rbTbody"></tbody>
            </table>
          </div>
        </div>

        <footer class="modal__footer modal-footer-color-3">
          <button type="button" class="btn btn-clean btn-sm" id="rbReset" title="Voltar custo e impostos para os valores do cadastro">↺ Valores do cadastro</button>
          <button type="button" class="btn btn-cancel btn-sm" data-rb-close>Cancelar</button>
          <button type="button" class="btn btn-save btn-sm" id="rbApply">Aplicar</button>
        </footer>
      </section>
    </div>
  `;
  document.body.appendChild(root);
  document.body.classList.add('modal-open');

  const tbody = root.querySelector('#rbTbody');
  const summary = root.querySelector('#rbSummary');

  const renderRows = () => {
    tbody.innerHTML = rows.map((r) => {
      const unitLabel = r.factor !== 1 ? `${r.unit || '-'} ×${fmtFactor(r.factor)}` : (r.unit || '-');
      const revTitle = r.discount_value > 0
        ? `Bruto R$ ${fmtMoney(r.gross)} − desconto R$ ${fmtMoney(r.discount_value)}`
        : `Qtd × Unit.`;
      const costTitle = r.base_cost > 0
        ? `Cadastro: R$ ${fmtMoney(r.base_cost)}${r.factor !== 1 ? ` × fator ${fmtFactor(r.factor)}` : ''} = R$ ${fmtMoney(r.cost_db)}`
        : 'Produto sem custo no cadastro';
      return `
        <tr data-i="${r.idx}">
          <td class="td-left">${escapeHtml(r.sku)}</td>
          <td class="td-left" title="${escapeHtml(r.description)}">${escapeHtml(r.description)}</td>
          <td class="td-center" title="${r.factor !== 1 ? `1 ${escapeHtml(r.unit)} = ${fmtFactor(r.factor)} un. do custo` : ''}">${escapeHtml(unitLabel)}</td>
          <td class="td-right">${fmtQty(r.quantity)}</td>
          <td class="td-right">${fmtMoney(r.unit_price)}</td>
          <td class="td-right" title="${escapeHtml(revTitle)}"><b>${fmtMoney(r.revenue)}</b></td>
          <td class="td-right" title="${escapeHtml(costTitle)}">
            <div class="fields fields-w-full fields-h-5 fields-font-3 fields-value-bold${r.cost_unit > 0 ? '' : ' fields-error'}">
              <input type="number" inputmode="decimal" step="0.01" min="0" data-cost="${r.idx}" value="${round2(r.cost_unit).toFixed(2)}" aria-label="Custo unitário ${escapeHtml(r.sku)}" />
            </div>
          </td>
          <td class="td-right" data-costtot="${r.idx}"></td>
          <td class="td-right" title="${escapeHtml(taxTitle(r))}">
            <div class="fields fields-w-full fields-h-5 fields-font-3">
              <input type="number" inputmode="decimal" step="0.01" min="0" max="100" data-tax="${r.idx}" value="${round2(r.tax_pct).toFixed(2)}" aria-label="Impostos % ${escapeHtml(r.sku)}" />
            </div>
          </td>
          <td class="td-right" data-taxval="${r.idx}" title="${escapeHtml(taxTitle(r))}"></td>
          <td class="td-right" data-profit="${r.idx}"></td>
          <td class="td-center" data-margin="${r.idx}"></td>
        </tr>`;
    }).join('');
  };

  const pill = (variant, text, title = '') =>
    `<span class="summary-pill summary-pill--${variant} summary-height-4" ${title ? `title="${escapeHtml(title)}"` : ''}>${text}</span>`;

  const marginVariant = (m, profit) => (profit < 0 ? 'danger' : m < 10 ? 'warning' : 'success');

  let totals = {};

  function recomputeAll() {
    let gross = 0, disc = 0, net = 0, cost = 0, taxes = 0;
    let noCost = 0, noTax = 0;

    for (const r of rows) {
      const ct = r.quantity * r.cost_unit;
      const tv = r.revenue * (r.tax_pct / 100);
      const pf = r.revenue - ct - tv;
      const m = r.revenue > 0 ? (pf / r.revenue) * 100 : 0;

      gross += r.gross; disc += r.discount_value; net += r.revenue; cost += ct; taxes += tv;
      if (!(r.cost_unit > 0)) noCost++;
      if (!r.tax) noTax++;

      const tr = tbody.querySelector(`tr[data-i="${r.idx}"]`);
      if (!tr) continue;
      tr.querySelector('[data-costtot]').textContent = fmtMoney(ct);
      tr.querySelector('[data-taxval]').textContent = fmtMoney(tv);
      tr.querySelector('[data-profit]').innerHTML = pf < 0 ? `<b>${fmtMoney(pf)}</b>` : fmtMoney(pf);
      tr.querySelector('[data-margin]').innerHTML =
        `<span class="summary-pill summary-pill--${marginVariant(m, pf)} summary-height-1">${fmtPct(m)}</span>`;
      tr.querySelector('[data-cost]')?.parentElement?.classList.toggle('fields-error', !(r.cost_unit > 0));
    }

    const profit = net - cost - taxes;
    const margin = net > 0 ? (profit / net) * 100 : 0;
    totals = { gross, disc, net, cost, taxes, profit, margin };

    const pills = [
      pill('info', `Receita: R$ ${fmtMoney(net)}`, disc > 0 ? `Bruta R$ ${fmtMoney(gross)} − descontos R$ ${fmtMoney(disc)}` : 'Soma de Qtd × Unit. dos itens'),
      pill('primary', `Custo: R$ ${fmtMoney(cost)}`),
      pill('primary', `Impostos: R$ ${fmtMoney(taxes)}`, 'ICMS, PIS, COFINS, IPI e FCP do cadastro fiscal de cada produto'),
      pill(profit < 0 ? 'danger' : 'success', `Lucro: R$ ${fmtMoney(profit)}`, 'Receita − Custo − Impostos'),
      pill(marginVariant(margin, profit), `Margem: ${fmtPct(margin)}`, 'Lucro ÷ Receita'),
      pill('info', `Frete: R$ ${fmtMoney(freight)}`, 'Cobrado do cliente; não entra no lucro'),
    ];
    if (noCost) pills.push(pill('warning', `${noCost} ${noCost === 1 ? 'item sem custo' : 'itens sem custo'}`, 'Informe o custo na coluna Custo unit. ou no cadastro do produto'));
    if (noTax) pills.push(pill('warning', `${noTax} ${noTax === 1 ? 'item sem impostos cadastrados' : 'itens sem impostos cadastrados'}`, 'Cadastre o perfil fiscal do produto ou informe o % na coluna Impostos'));
    if (!costOk || !taxOk) {
      const what = !costOk && !taxOk ? 'custos e impostos' : (!costOk ? 'custos' : 'impostos');
      pills.push(pill('danger', `Não foi possível ler ${what} do cadastro`, loadError || 'Confira a conexão e abra de novo'));
    }
    summary.innerHTML = pills.join('');
  }

  const onInput = (e) => {
    const inp = e.target;
    const i = Number(inp.dataset.cost ?? inp.dataset.tax);
    const row = rows.find((x) => x.idx === i);
    if (!row) return;
    if (inp.dataset.cost != null) row.cost_unit = Math.max(0, toNum(inp.value));
    if (inp.dataset.tax != null) row.tax_pct = Math.min(100, Math.max(0, toNum(inp.value)));
    recomputeAll();
  };
  tbody.addEventListener('input', onInput);

  root.querySelector('#rbReset').addEventListener('click', () => {
    for (const r of rows) { r.cost_unit = r.cost_db; r.tax_pct = r.tax_db; }
    renderRows();
    recomputeAll();
  });

  // ------------------------------------------------------------------
  // Fechar / aplicar
  // ------------------------------------------------------------------
  let resolvePromise;
  const p = new Promise((resolve) => (resolvePromise = resolve));

  const close = (result) => {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('modal-open');
    root.remove();
    resolvePromise(result);
  };

  function apply() {
    recomputeAll();
    // guarda os ajustes nos itens do orçamento aberto (reabrir mantém os valores)
    for (const r of rows) {
      const it = items[r.idx];
      if (!it) continue;
      it.rent_cost_unit = Math.abs(r.cost_unit - r.cost_db) > 0.0049 ? round2(r.cost_unit) : null;
      it.rent_tax_pct = Math.abs(r.tax_pct - r.tax_db) > 0.0049 ? round2(r.tax_pct) : null;
    }
    close({
      ok: true,
      data: {
        freight_value: freight,
        totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round2(v)])),
        items: rows.map((r) => ({
          sku: r.sku,
          unit: r.unit,
          factor: r.factor,
          quantity: r.quantity,
          unit_price: r.unit_price,
          discount_value: r.discount_value,
          revenue: round2(r.revenue),
          cost_unit: round2(r.cost_unit),
          tax_pct: round2(r.tax_pct),
        })),
      },
    });
  }

  root.querySelectorAll('[data-rb-close]').forEach((b) => b.addEventListener('click', () => close({ ok: false })));
  root.querySelector('#rbApply').addEventListener('click', apply);

  function onKey(e) {
    if (e.key !== 'Escape') return;
    if (document.querySelector('.center-modal-layer')) return; // aviso por cima
    close({ ok: false });
  }
  document.addEventListener('keydown', onKey);

  renderRows();
  recomputeAll();
  setTimeout(() => {
    const first = tbody.querySelector('input[data-cost]');
    first?.focus?.();
    first?.select?.();
  }, 0);

  return p;
}

/** % efetivo sobre a receita: ICMS × (1 − redução BC) + PIS + COFINS + IPI + FCP */
function effectiveTaxPct(t) {
  const icms = toNum(t.icms) * (1 - toNum(t.reducao_bc) / 100);
  return Math.max(0, icms + toNum(t.pis) + toNum(t.cofins) + toNum(t.ipi) + toNum(t.fcp));
}

function taxTitle(r) {
  const t = r.tax;
  if (!t) return 'Produto sem cadastro fiscal — informe o % manualmente';
  const parts = [
    `ICMS ${fmtPct(t.icms)}${toNum(t.reducao_bc) > 0 ? ` (redução BC ${fmtPct(t.reducao_bc)})` : ''}`,
    `PIS ${fmtPct(t.pis)}`,
    `COFINS ${fmtPct(t.cofins)}`,
  ];
  if (toNum(t.ipi) > 0) parts.push(`IPI ${fmtPct(t.ipi)}`);
  if (toNum(t.fcp) > 0) parts.push(`FCP ${fmtPct(t.fcp)}`);
  const extra = [t.profile_name && `Perfil: ${t.profile_name}`, t.ncm && `NCM ${t.ncm}`].filter(Boolean).join(' • ');
  return `${parts.join(' + ')} = ${fmtPct(r.tax_db)}${extra ? `\n${extra}` : ''}`;
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function fmtQty(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

// ----------------------- helpers -----------------------
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function uniq(arr) {
  const s = new Set();
  for (const x of arr) s.add(x);
  return Array.from(s);
}

// display: keeps CX.10, removes only final dot
function normUnitDisplay(u) {
  const s = String(u || '').trim().toUpperCase();
  if (!s) return '';
  return s.endsWith('.') ? s.slice(0, -1) : s;
}

// lookup: collapses CX.10 -> CX and removes final dot
function normUnitLookup(u) {
  const s = normUnitDisplay(u);
  if (!s) return '';
  return s.replace(/\.\d+$/, '');
}

async function fetchJson(url, { timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);

  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('access_token') ||
    sessionStorage.getItem('token') ||
    '';

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : null;

    if (!res.ok) {
      const msg = data?.error ? `${res.status} — ${data.error}` : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

function toNum(v) {
  if (v === null || v === undefined) return 0;

  if (typeof v === 'string') {
    let s = v.trim();
    if (!s) return 0;

    // BR format: 1.234,56
    if (s.includes(',')) {
      s = s.replace(/\./g, '').replace(',', '.');
    }

    // US/DB format: 1.00
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v) {
  const n = Number(v || 0);
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function fmtFactor(v) {
  const n = Number(v || 1);
  if (!Number.isFinite(n) || n <= 0) return '1';
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
