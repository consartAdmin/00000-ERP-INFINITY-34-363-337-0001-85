// ╔══════════════════════════════════════════════════════════════════════╗
// ║ deliveryTripsRentabilityModal.js — Rentabilidade da Rota (Entregas)  ║
// ║ Soma a rentabilidade de todas as vendas (paradas de ENTREGA) da rota ║
// ║ Mesmas regras do modal Rentabilidade do Orçamento                    ║
// ║ (public/budgets/js/modals/rentabilityBudgetsModal.js):               ║
// ║ - Custo: products.cost_price (por SKU) × fator da U.M (productUnits)  ║
// ║ - Impostos: cadastro fiscal V2 via /api/products/tax-map             ║
// ║   ICMS × (1 − redução BC) + PIS + COFINS + IPI + FCP sobre a receita ║
// ║ - Lucro = Receita − Custo − Impostos | Margem = Lucro / Receita      ║
// ║ - Paradas "Não realizada" e "Cancelada" ficam fora do total          ║
// ║ - Custos da rota (combustível, motorista…) são simulação, não grava  ║
// ║ Layout: modals.css + table.css + fields.css + summary.css (style.css)║
// ╚══════════════════════════════════════════════════════════════════════╝

import { getAuthToken } from '/public/includes/js/apiFetch.js';

const MODAL_ID = 'dtRentabilityModal';
const OUT_STATUS = new Set(['FALHOU', 'CANCELADA']);
const STATUS_LABEL = { PENDENTE: 'Pendente', CONCLUIDA: 'Concluída', FALHOU: 'Não realizada', CANCELADA: 'Cancelada' };

/**
 * @param {Object} trip  rota aberta (trip_id, trip_date, name)
 */
export async function openTripRentabilityModal(trip) {
  if (!trip?.trip_id) return;

  document.getElementById(MODAL_ID)?.remove();
  const root = document.createElement('div');
  root.id = MODAL_ID;
  root.className = 'modal is-open';
  root.setAttribute('aria-hidden', 'false');
  root.innerHTML = `
    <div class="modal__backdrop" data-dr-close></div>
    <div class="modal__dialog">
      <section class="modal__panel modal-width-13" role="dialog" aria-modal="true" aria-labelledby="drTitle">
        <header class="modal__header modal-header-color-3">
          <div>
            <h2 id="drTitle" class="modal__title">Rentabilidade da Rota nº ${esc(trip.trip_id)}${trip.trip_date ? ` — ${esc(fmtDate(trip.trip_date))}` : ''}</h2>
            <p class="modal__subtitle">Soma de todas as vendas entregues na rota. Custo e impostos vêm do cadastro de cada produto, como na Rentabilidade do Orçamento.</p>
          </div>
          <button type="button" class="modal__close" data-dr-close title="Fechar" aria-label="Fechar">&times;</button>
        </header>

        <div class="modal__body modal-section">
          <div class="modal-form-grid modal-form-grid--6">
            <div class="fields fields-h-5" title="Combustível, diária do motorista, pedágio, ajudante… Só para simular, não é gravado.">
              <label for="drRouteCost">Custos da rota (R$)</label>
              <input id="drRouteCost" type="number" inputmode="decimal" step="0.01" min="0" value="0.00" />
            </div>
          </div>

          <div class="summary summary--left summary-gap-8" id="drSummary">
            <span class="summary-pill summary-pill--info summary-height-4">Calculando…</span>
          </div>

          <div class="modal-divider modal-divider--soft"></div>

          <div class="table-scroll table-scroll--rounded table-max-height-500">
            <table class="table table-zebra table-zebra-hover table-sticky-head table-row-h-32">
              <thead>
                <tr>
                  <th class="table-col-w-1"></th>
                  <th class="table-col-w-1">Ordem</th>
                  <th class="table-col-w-3 th-left">Documento</th>
                  <th class="table-col-w-8 th-left">Cliente</th>
                  <th class="table-col-w-2">Status</th>
                  <th class="table-col-w-1 th-right">Itens</th>
                  <th class="table-col-w-3 th-right">Receita (R$)</th>
                  <th class="table-col-w-3 th-right">Custo (R$)</th>
                  <th class="table-col-w-3 th-right">Impostos (R$)</th>
                  <th class="table-col-w-3 th-right">Lucro (R$)</th>
                  <th class="table-col-w-2">Margem</th>
                </tr>
              </thead>
              <tbody id="drTbody">
                <tr><td colspan="11" class="td-center">Carregando vendas da rota…</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <footer class="modal__footer modal-footer-color-3">
          <button type="button" class="btn btn-clean btn-sm" id="drExpandAll">▸ Ver itens de todas</button>
          <button type="button" class="btn btn-cancel btn-sm" data-dr-close>Fechar</button>
        </footer>
      </section>
    </div>
  `;
  document.body.appendChild(root);
  document.body.classList.add('modal-open');

  const tbody = root.querySelector('#drTbody');
  const summary = root.querySelector('#drSummary');
  const routeCostInput = root.querySelector('#drRouteCost');

  const close = () => {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('modal-open');
    root.remove();
  };
  function onKey(e) {
    if (e.key === 'Escape' && !document.querySelector('.center-modal-layer')) close();
  }
  document.addEventListener('keydown', onKey);
  root.querySelectorAll('[data-dr-close]').forEach((b) => b.addEventListener('click', close));

  // ------------------------------------------------------------------
  // Dados: vendas da rota + custo, fator da U.M e impostos do cadastro
  // ------------------------------------------------------------------
  let data;
  try {
    data = await fetchJson(`/api/delivery-trips/${encodeURIComponent(trip.trip_id)}/rentability`);
    data = data?.data ?? data;
  } catch (e) {
    summary.innerHTML = pill('danger', 'Não foi possível carregar as vendas da rota', e.message);
    tbody.innerHTML = `<tr><td colspan="11" class="td-center">${esc(e.message)}</td></tr>`;
    return;
  }

  const stops = Array.isArray(data?.stops) ? data.stops : [];
  const skus = uniq(stops.flatMap((s) => (s.items || []).map((it) => String(it.sku || '').trim())).filter(Boolean));
  const qs = encodeURIComponent(skus.join(','));

  const dbCostBySku = {};
  const dbFactorBySkuUnit = {};
  let taxBySku = {};
  let costOk = true;
  let taxOk = true;
  let loadError = '';

  if (skus.length) {
    const [costRes, factorRes, taxRes] = await Promise.all([
      fetchJson(`/api/products/cost-map?codes=${qs}`).catch((e) => { costOk = false; loadError ||= e.message; return null; }),
      fetchJson(`/api/barcodes/factors?skus=${qs}`).catch(() => null),
      fetchJson(`/api/products/tax-map?codes=${qs}`).catch((e) => { taxOk = false; loadError ||= e.message; return null; }),
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
  }

  // ------------------------------------------------------------------
  // Cálculo por item e por venda
  // ------------------------------------------------------------------
  const sales = stops.map((s) => {
    const items = (s.items || []).map((it) => {
      const sku = String(it.sku || '').trim();
      const unit = normUnitDisplay(it.unit);
      const unitNumber = toNum((unit.match(/\.(\d+)$/) || [])[1]);
      const factor = toNum(dbFactorBySkuUnit[`${sku}||${normUnitLookup(unit)}`]) || unitNumber || 1;
      const baseCost = toNum(dbCostBySku[sku]);
      const costUnit = Math.max(0, baseCost * factor);
      const tax = isObj(taxBySku[sku]) ? taxBySku[sku] : null;
      const taxPct = tax ? effectiveTaxPct(tax) : 0;
      const qty = toNum(it.quantity);
      const gross = qty * toNum(it.unit_price);
      const revenue = Math.max(0, gross - toNum(it.discount_value));
      const cost = qty * costUnit;
      const taxes = revenue * (taxPct / 100);
      return {
        sku, description: String(it.description || ''), unit, factor, quantity: qty,
        revenue, cost_unit: costUnit, base_cost: baseCost, cost, tax, tax_pct: taxPct, taxes,
        profit: revenue - cost - taxes,
      };
    });
    const sum = (k) => items.reduce((a, x) => a + x[k], 0);
    const revenue = sum('revenue');
    const cost = sum('cost');
    const taxes = sum('taxes');
    return {
      ...s,
      out: OUT_STATUS.has(s.status),
      items,
      revenue, cost, taxes,
      profit: revenue - cost - taxes,
      noCost: items.filter((x) => !(x.cost_unit > 0)).length,
      noTax: items.filter((x) => !x.tax).length,
    };
  });

  const expanded = new Set();

  function renderRows() {
    if (!sales.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="td-center">Nenhuma entrega nesta rota.</td></tr>';
      return;
    }
    tbody.innerHTML = sales.map((s) => {
      const m = s.revenue > 0 ? (s.profit / s.revenue) * 100 : 0;
      const open = expanded.has(s.stop_id);
      const hasItems = s.items.length > 0;
      const docTitle = s.nfe_number ? docOrigin(s) : '';
      const outNote = s.out ? ' title="Fora do total da rota"' : '';
      const main = `
        <tr data-stop="${s.stop_id}"${outNote}>
          <td class="td-center">${hasItems ? `<button type="button" class="btn btn-icon-clean btn-sm" data-toggle="${s.stop_id}" title="${open ? 'Ocultar itens' : 'Ver itens'}" aria-label="${open ? 'Ocultar itens' : 'Ver itens'}">${open ? '▾' : '▸'}</button>` : ''}</td>
          <td class="td-center">${esc(s.stop_order)}</td>
          <td class="td-left" title="${esc(docTitle)}">${esc(docLabel(s))}${docTitle ? `<br><small>${esc(docTitle)}</small>` : ''}</td>
          <td class="td-left" title="${esc(s.recipient_name)}">${esc(s.recipient_name)}</td>
          <td class="td-center"><span class="summary-pill summary-pill--${statusVariant(s.status)} summary-height-1">${esc(STATUS_LABEL[s.status] || s.status)}</span></td>
          <td class="td-right">${s.items.length}</td>
          ${hasItems ? `
            <td class="td-right"><b>${s.out ? `<s>${fmtMoney(s.revenue)}</s>` : fmtMoney(s.revenue)}</b></td>
            <td class="td-right">${fmtMoney(s.cost)}${s.noCost ? ` <span title="${s.noCost} ${s.noCost === 1 ? 'item sem custo' : 'itens sem custo'} no cadastro">⚠️</span>` : ''}</td>
            <td class="td-right">${fmtMoney(s.taxes)}${s.noTax ? ` <span title="${s.noTax} ${s.noTax === 1 ? 'item sem impostos cadastrados' : 'itens sem impostos cadastrados'}">⚠️</span>` : ''}</td>
            <td class="td-right">${s.profit < 0 ? `<b>${fmtMoney(s.profit)}</b>` : fmtMoney(s.profit)}</td>
            <td class="td-center"><span class="summary-pill summary-pill--${marginVariant(m, s.profit)} summary-height-1">${fmtPct(m)}</span></td>`
          : `<td class="td-center" colspan="5">Sem itens de venda vinculados (parada avulsa)</td>`}
        </tr>`;
      if (!open || !hasItems) return main;
      return main + `
        <tr data-items="${s.stop_id}">
          <td></td>
          <td colspan="10">
            <table class="table table-row-h-28">
              <thead>
                <tr>
                  <th class="table-col-w-3 th-left">SKU</th>
                  <th class="table-col-w-9 th-left">Descrição</th>
                  <th class="table-col-w-2">U.M</th>
                  <th class="table-col-w-2 th-right">Qtd</th>
                  <th class="table-col-w-3 th-right">Receita (R$)</th>
                  <th class="table-col-w-3 th-right">Custo unit. (R$)</th>
                  <th class="table-col-w-3 th-right">Custo total</th>
                  <th class="table-col-w-2 th-right">Impostos (%)</th>
                  <th class="table-col-w-3 th-right">Impostos (R$)</th>
                  <th class="table-col-w-3 th-right">Lucro (R$)</th>
                  <th class="table-col-w-2">Margem</th>
                </tr>
              </thead>
              <tbody>
                ${s.items.map((it) => {
                  const im = it.revenue > 0 ? (it.profit / it.revenue) * 100 : 0;
                  const unitLabel = it.factor !== 1 ? `${it.unit || '-'} ×${fmtFactor(it.factor)}` : (it.unit || '-');
                  const costTitle = it.base_cost > 0
                    ? `Cadastro: R$ ${fmtMoney(it.base_cost)}${it.factor !== 1 ? ` × fator ${fmtFactor(it.factor)}` : ''}`
                    : 'Produto sem custo no cadastro';
                  return `
                    <tr>
                      <td class="td-left">${esc(it.sku)}</td>
                      <td class="td-left" title="${esc(it.description)}">${esc(it.description)}</td>
                      <td class="td-center">${esc(unitLabel)}</td>
                      <td class="td-right">${fmtQty(it.quantity)}</td>
                      <td class="td-right">${fmtMoney(it.revenue)}</td>
                      <td class="td-right" title="${esc(costTitle)}">${it.cost_unit > 0 ? fmtMoney(it.cost_unit) : '⚠️ 0,00'}</td>
                      <td class="td-right">${fmtMoney(it.cost)}</td>
                      <td class="td-right" title="${esc(taxTitle(it))}">${it.tax ? fmtPct(it.tax_pct) : '⚠️ 0,00%'}</td>
                      <td class="td-right">${fmtMoney(it.taxes)}</td>
                      <td class="td-right">${it.profit < 0 ? `<b>${fmtMoney(it.profit)}</b>` : fmtMoney(it.profit)}</td>
                      <td class="td-center"><span class="summary-pill summary-pill--${marginVariant(im, it.profit)} summary-height-1">${fmtPct(im)}</span></td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </td>
        </tr>`;
    }).join('');
  }

  function renderSummary() {
    const inTotal = sales.filter((s) => !s.out && s.items.length);
    const sum = (k) => inTotal.reduce((a, s) => a + s[k], 0);
    const net = sum('revenue');
    const cost = sum('cost');
    const taxes = sum('taxes');
    const profit = net - cost - taxes;
    const margin = net > 0 ? (profit / net) * 100 : 0;
    const freight = inTotal.reduce((a, s) => a + toNum(s.freight_value), 0);
    const routeCost = Math.max(0, toNum(routeCostInput.value));
    const final = profit - routeCost;
    const finalMargin = net > 0 ? (final / net) * 100 : 0;
    const noCost = inTotal.reduce((a, s) => a + s.noCost, 0);
    const noTax = inTotal.reduce((a, s) => a + s.noTax, 0);
    const outCount = sales.filter((s) => s.out && s.items.length).length;

    const pills = [
      pill('info', `Vendas: ${inTotal.length}`, 'Paradas de entrega com itens que entram no total'),
      pill('info', `Receita: R$ ${fmtMoney(net)}`, 'Soma de Qtd × Unit. − descontos dos itens'),
      pill('primary', `Custo: R$ ${fmtMoney(cost)}`),
      pill('primary', `Impostos: R$ ${fmtMoney(taxes)}`, 'ICMS, PIS, COFINS, IPI e FCP do cadastro fiscal de cada produto'),
      pill(profit < 0 ? 'danger' : 'success', `Lucro: R$ ${fmtMoney(profit)}`, 'Receita − Custo − Impostos'),
      pill(marginVariant(margin, profit), `Margem: ${fmtPct(margin)}`, 'Lucro ÷ Receita'),
      pill('info', `Frete: R$ ${fmtMoney(freight)}`, 'Cobrado dos clientes; não entra no lucro'),
    ];
    if (routeCost > 0) {
      pills.push(pill(final < 0 ? 'danger' : 'success', `Lucro após custos da rota: R$ ${fmtMoney(final)} (${fmtPct(finalMargin)})`, `Lucro − custos da rota (R$ ${fmtMoney(routeCost)})`));
    }
    if (outCount) pills.push(pill('warning', `${outCount} ${outCount === 1 ? 'parada não realizada/cancelada' : 'paradas não realizadas/canceladas'} fora do total`));
    if (noCost) pills.push(pill('warning', `${noCost} ${noCost === 1 ? 'item sem custo' : 'itens sem custo'}`, 'Cadastre o custo no produto'));
    if (noTax) pills.push(pill('warning', `${noTax} ${noTax === 1 ? 'item sem impostos cadastrados' : 'itens sem impostos cadastrados'}`, 'Cadastre o vínculo fiscal do produto'));
    if (!costOk || !taxOk) {
      const what = !costOk && !taxOk ? 'custos e impostos' : (!costOk ? 'custos' : 'impostos');
      pills.push(pill('danger', `Não foi possível ler ${what} do cadastro`, loadError || 'Confira a conexão e abra de novo'));
    }
    summary.innerHTML = pills.join('');
  }

  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle]');
    if (!btn) return;
    const id = Number(btn.dataset.toggle);
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    renderRows();
  });

  const expandBtn = root.querySelector('#drExpandAll');
  expandBtn.addEventListener('click', () => {
    const all = sales.filter((s) => s.items.length);
    const allOpen = all.length && all.every((s) => expanded.has(s.stop_id));
    expanded.clear();
    if (!allOpen) all.forEach((s) => expanded.add(s.stop_id));
    expandBtn.textContent = allOpen ? '▸ Ver itens de todas' : '▾ Ocultar itens';
    renderRows();
  });

  routeCostInput.addEventListener('input', renderSummary);

  renderRows();
  renderSummary();
}

// ----------------------- regras (iguais ao orçamento) -----------------------
function effectiveTaxPct(t) {
  const icms = toNum(t.icms) * (1 - toNum(t.reducao_bc) / 100);
  return Math.max(0, icms + toNum(t.pis) + toNum(t.cofins) + toNum(t.ipi) + toNum(t.fcp));
}

function taxTitle(it) {
  const t = it.tax;
  if (!t) return 'Produto sem cadastro fiscal';
  const parts = [
    `ICMS ${fmtPct(t.icms)}${toNum(t.reducao_bc) > 0 ? ` (redução BC ${fmtPct(t.reducao_bc)})` : ''}`,
    `PIS ${fmtPct(t.pis)}`,
    `COFINS ${fmtPct(t.cofins)}`,
  ];
  if (toNum(t.ipi) > 0) parts.push(`IPI ${fmtPct(t.ipi)}`);
  if (toNum(t.fcp) > 0) parts.push(`FCP ${fmtPct(t.fcp)}`);
  const extra = [t.profile_name && `Perfil: ${t.profile_name}`, t.ncm && `NCM ${t.ncm}`].filter(Boolean).join(' • ');
  return `${parts.join(' + ')} = ${fmtPct(it.tax_pct)}${extra ? `\n${extra}` : ''}`;
}

// ----------------------- helpers -----------------------
function docLabel(s) {
  if (s.nfe_number) return `NF-e ${s.nfe_number}`;
  if (s.order_id) return `Pedido ${s.order_id}`;
  if (s.budget_id) return `Orçamento ${s.budget_id}`;
  return 'Avulsa';
}

function docOrigin(s) {
  if (s.order_id) return `Pedido ${s.order_id}`;
  if (s.budget_id) return `Orçamento ${s.budget_id}`;
  return '';
}

function statusVariant(st) {
  if (st === 'CONCLUIDA') return 'success';
  if (st === 'FALHOU' || st === 'CANCELADA') return 'danger';
  return 'info';
}

function marginVariant(m, profit) {
  return profit < 0 ? 'danger' : m < 10 ? 'warning' : 'success';
}

function pill(variant, text, title = '') {
  return `<span class="summary-pill summary-pill--${variant} summary-height-4"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
}

async function fetchJson(url, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const token = getAuthToken();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : null;
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error ? `${res.status} — ${data.error}` : `HTTP ${res.status}`);
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function uniq(arr) { return Array.from(new Set(arr)); }

function normUnitDisplay(u) {
  const s = String(u || '').trim().toUpperCase();
  return s.endsWith('.') ? s.slice(0, -1) : s;
}
function normUnitLookup(u) {
  return normUnitDisplay(u).replace(/\.\d+$/, '');
}

function toNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') {
    let s = v.trim();
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
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
  return `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
function fmtQty(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}
function fmtFactor(v) {
  const n = Number(v || 1);
  return Number.isFinite(n) && n > 0 ? n.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : '1';
}
function fmtDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}
function esc(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
