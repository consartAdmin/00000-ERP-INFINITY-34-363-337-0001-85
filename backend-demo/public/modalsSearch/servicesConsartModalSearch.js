// ╔══════════════════════════════════════════════════════════════════════╗
// ║ servicesConsartModalSearch.js — Modal "Buscar Serviço" (CONSART ERP) ║
// ║ • Busca no cadastro de serviços (/api/services-consart)             ║
// ║ • Filtros: texto, status, categoria                                 ║
// ║ • Clique (ou Enter na linha) escolhe o serviço → onPick(service)    ║
// ║ • "Novo serviço" cadastra na hora e já devolve o serviço criado     ║
// ║ Uso:                                                                ║
// ║   openServicesConsartModalSearch({ onPick(service) { ... } });      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { Modal } from '/public/includes/js/modal.js';
import { apiFetch } from '/public/includes/js/apiFetch.js';

const API = '/api/services-consart';
const STYLE_ID = 'services-consart-search-styles';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .svc-search-modal { --modal-max-height: calc(100vh - 80px); }
    .svc-search-modal .modal__dialog { padding-top: 56px; }

    .svc-search__filters {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 8px;
    }
    .svc-search__filters .svc-search__q { flex: 1 1 260px; }
    .svc-search__filters .svc-search__sel { flex: 0 0 150px; }

    .svc-search__table-wrap {
      margin-top: 12px;
      height: 420px;
      overflow: auto;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
    }
    .svc-search__table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .svc-search__table th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 8px 6px;
      background: #f8fafc;
      border-bottom: 1px solid #0f172a;
      font-weight: 700;
      text-align: center;
    }
    .svc-search__table td {
      padding: 7px 6px;
      border-bottom: 1px solid #e2e8f0;
      text-align: center;
    }
    .svc-search__table td.svc-left { text-align: left; }
    .svc-search__table td.svc-money { text-align: right; white-space: nowrap; }
    .svc-search__table tbody tr { cursor: pointer; }
    .svc-search__table tbody tr:hover,
    .svc-search__table tbody tr:focus { background: #dbeafe; outline: none; }
    .svc-search__table tbody tr.is-inactive { color: #94a3b8; }
    .svc-search__desc { font-weight: 700; color: #0f172a; }
    .svc-search__details { font-size: 11px; color: #64748b; }
    .svc-search__msg { padding: 24px; text-align: center; color: #64748b; }
    .svc-search__msg--error { color: #b91c1c; }

    .svc-search__new {
      margin-top: 12px;
      padding: 10px;
      border: 1px dashed #0f6b5c;
      border-radius: 8px;
      background: #f0fdf4;
    }
    .svc-search__new-grid {
      display: grid;
      grid-template-columns: 110px 1fr 80px 120px 110px auto;
      gap: 8px;
      align-items: end;
    }
    .svc-search__footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .svc-search__info { font-size: 11px; color: #2563eb; }
  `;
  document.head.appendChild(style);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function openServicesConsartModalSearch({ onPick, initialQuery = '' } = {}) {
  ensureStyles();

  const uid = `svcSearch${Date.now()}`;
  const overlay = document.createElement('div');
  overlay.className = 'modal svc-search-modal';
  overlay.setAttribute('aria-hidden', 'true');

  overlay.innerHTML = `
    <div class="modal__backdrop" data-modal-close></div>
    <div class="modal__dialog">
      <section class="modal__panel modal-width-9" role="dialog" aria-modal="true" aria-labelledby="${uid}Title">
        <header class="modal__header modal-header-color-3">
          <h2 class="modal__title" id="${uid}Title">Buscar Serviço</h2>
          <button type="button" class="modal__close" data-modal-close aria-label="Fechar" title="Fechar">&times;</button>
        </header>

        <div class="modal__body">
          <div class="svc-search__filters">
            <div class="fields fields-h-6 svc-search__q">
              <label for="${uid}Q">Serviço</label>
              <input type="search" id="${uid}Q" autocomplete="off" placeholder="Código, descrição, cód. serviço...">
            </div>
            <button type="button" class="btn btn-search btn-sm" data-search>Buscar</button>
            <div class="fields fields-h-6 svc-search__sel">
              <label for="${uid}Active">Status</label>
              <select id="${uid}Active">
                <option value="true">Ativos</option>
                <option value="false">Inativos</option>
                <option value="">Todos</option>
              </select>
            </div>
            <div class="fields fields-h-6 svc-search__sel">
              <label for="${uid}Cat">Categoria</label>
              <select id="${uid}Cat"><option value="">Todas</option></select>
            </div>
            <button type="button" class="btn btn-load btn-sm" data-clear>Limpar</button>
            <button type="button" class="btn btn-new btn-sm" data-new>➕ Novo serviço</button>
          </div>

          <div class="svc-search__new" data-new-form hidden>
            <div class="svc-search__new-grid">
              <div class="fields fields-h-6">
                <label for="${uid}NCode">Código</label>
                <input id="${uid}NCode" maxlength="30" placeholder="Automático">
              </div>
              <div class="fields fields-h-6">
                <label for="${uid}NDesc">Descrição *</label>
                <input id="${uid}NDesc" maxlength="500" placeholder="Ex.: Hora técnica de implantação">
              </div>
              <div class="fields fields-h-6">
                <label for="${uid}NUnit">Un.</label>
                <input id="${uid}NUnit" maxlength="10" value="SV">
              </div>
              <div class="fields fields-h-6">
                <label for="${uid}NPrice">Preço</label>
                <input id="${uid}NPrice" inputmode="decimal" placeholder="0,00">
              </div>
              <div class="fields fields-h-6">
                <label for="${uid}NLc">Cód. serviço</label>
                <input id="${uid}NLc" maxlength="20" placeholder="LC 116 (ex.: 1.07)">
              </div>
              <button type="button" class="btn btn-save btn-sm" data-new-save>Salvar e usar</button>
            </div>
          </div>

          <div class="svc-search__table-wrap">
            <table class="svc-search__table">
              <thead>
                <tr>
                  <th style="width:90px">Código</th>
                  <th>Descrição</th>
                  <th style="width:70px">Unidade</th>
                  <th style="width:100px">Cód. serviço</th>
                  <th style="width:140px">Categoria</th>
                  <th style="width:110px">Preço</th>
                </tr>
              </thead>
              <tbody data-body></tbody>
            </table>
          </div>
        </div>

        <footer class="modal__footer modal-footer-color-3 svc-search__footer">
          <span class="svc-search__info" data-info></span>
          <button type="button" class="btn btn-cancel btn-sm" data-modal-close>Fechar</button>
        </footer>
      </section>
    </div>
  `;

  const $ = (sel) => overlay.querySelector(sel);
  const input = $(`#${uid}Q`);
  const activeSel = $(`#${uid}Active`);
  const catSel = $(`#${uid}Cat`);
  const body = $('[data-body]');
  const info = $('[data-info]');
  const newForm = $('[data-new-form]');
  let rows = [];

  input.value = initialQuery;

  function close() {
    if (!Modal.close(overlay)) overlay.remove();
  }

  function pick(service) {
    if (typeof onPick === 'function') onPick(service);
    close();
  }

  function setMessage(text, isError = false) {
    body.innerHTML = `<tr><td colspan="6" class="svc-search__msg${isError ? ' svc-search__msg--error' : ''}">${esc(text)}</td></tr>`;
  }

  async function loadCategories() {
    try {
      const json = await apiFetch(`${API}/categories`);
      (json.data || []).forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        catSel.appendChild(opt);
      });
    } catch (error) {
      console.warn('[servicesConsartModalSearch] categorias:', error);
    }
  }

  async function search() {
    const params = new URLSearchParams({ limit: '200' });
    const q = input.value.trim();
    if (q) params.set('q', q);
    if (activeSel.value) params.set('active', activeSel.value);
    if (catSel.value) params.set('category', catSel.value);

    setMessage('Buscando serviços...');
    try {
      const json = await apiFetch(`${API}?${params}`);
      rows = json.data || [];
      info.textContent = rows.length < json.count
        ? `Exibindo ${rows.length} de ${json.count} serviços. Refine a busca ou os filtros.`
        : `${json.count} ${json.count === 1 ? 'serviço' : 'serviços'}`;

      if (!rows.length) {
        setMessage('Nenhum serviço encontrado. Use "➕ Novo serviço" para cadastrar.');
        return;
      }

      body.innerHTML = rows.map((s, i) => `
        <tr tabindex="0" data-index="${i}" class="${s.active ? '' : 'is-inactive'}">
          <td><strong>${esc(s.code)}</strong></td>
          <td class="svc-left">
            <div class="svc-search__desc">${esc(s.description)}</div>
            ${s.details ? `<div class="svc-search__details">${esc(s.details)}</div>` : ''}
          </td>
          <td>${esc(s.unit)}</td>
          <td>${esc(s.service_code || '-')}</td>
          <td>${esc(s.category || '-')}</td>
          <td class="svc-money">${money(s.price)}</td>
        </tr>
      `).join('');
    } catch (error) {
      console.error('[servicesConsartModalSearch] busca:', error);
      info.textContent = '';
      setMessage(`Erro ao buscar serviços: ${error.message}`, true);
    }
  }

  async function saveNew() {
    const description = $(`#${uid}NDesc`).value.trim();
    if (!description) {
      $(`#${uid}NDesc`).focus();
      return;
    }
    const btn = $('[data-new-save]');
    btn.disabled = true;
    try {
      const json = await apiFetch(API, {
        method: 'POST',
        body: JSON.stringify({
          code: $(`#${uid}NCode`).value,
          description,
          unit: $(`#${uid}NUnit`).value,
          price: $(`#${uid}NPrice`).value,
          service_code: $(`#${uid}NLc`).value,
        }),
      });
      pick(json.data);
    } catch (error) {
      alert(`Erro ao cadastrar o serviço: ${error.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  body.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-index]');
    if (tr) pick(rows[Number(tr.dataset.index)]);
  });
  body.addEventListener('keydown', (e) => {
    const tr = e.target.closest('tr[data-index]');
    if (tr && e.key === 'Enter') pick(rows[Number(tr.dataset.index)]);
  });

  $('[data-search]').addEventListener('click', search);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); search(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); body.querySelector('tr[data-index]')?.focus(); }
  });
  activeSel.addEventListener('change', search);
  catSel.addEventListener('change', search);
  $('[data-clear]').addEventListener('click', () => {
    input.value = '';
    activeSel.value = 'true';
    catSel.value = '';
    search();
  });
  $('[data-new]').addEventListener('click', () => {
    newForm.hidden = !newForm.hidden;
    if (!newForm.hidden) {
      $(`#${uid}NDesc`).value = input.value.trim();
      $(`#${uid}NDesc`).focus();
    }
  });
  $('[data-new-save]').addEventListener('click', saveNew);

  // Fechou (X, Fechar, backdrop ou ESC pelo modal.js) → remove do DOM
  overlay.addEventListener('modal:close', () => overlay.remove());

  Modal.setup();
  document.body.appendChild(overlay);
  Modal.open(overlay);
  input.focus();

  loadCategories();
  search();
}

export default openServicesConsartModalSearch;
