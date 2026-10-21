// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tmsEngine.js — motor das telas do Transporte (TMS)                  ║
// ║ CONSART LOGISTICS | Frontend (ESM)                                  ║
// ║ Cada tela descreve abas, colunas, filtros, formulário e ações       ║
// ║ (ex.: cte.js) e chama mountTmsPage(config). O motor monta o mesmo   ║
// ║ layout do Design System (header + tabs + table-layout-integrated +  ║
// ║ modal) usado em Entregas e Motoristas.                              ║
// ║ API: /api/tms (JWT)                                                  ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import { getAuthToken } from '/public/includes/js/apiFetch.js';
import { Modal } from '/public/includes/js/modal.js';

export const API = '/api/tms';

// ==========================================================
// Textos
// ==========================================================
export const UF = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
  'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const ERROR_MESSAGES = {
  CTE_LOCKED: 'CT-e emitido ou cancelado não pode ser alterado.',
  CTE_NOT_DIGITADO: 'Só é possível emitir um CT-e digitado.',
  CTE_NOT_ISSUED: 'O CT-e precisa estar emitido.',
  CTE_INCOMPLETE: 'Faltam dados para emitir',
  CTE_IN_OPEN_MDFE: 'O CT-e está em um MDF-e aberto. Encerre ou cancele o MDF-e primeiro.',
  CTE_IN_INVOICE: 'O CT-e está em uma fatura. Cancele a fatura primeiro.',
  CTE_ALREADY_BILLED: 'Um dos CT-es já está em outra fatura.',
  CTE_CANCELADO: 'CT-e cancelado não pode entrar na carga.',
  CANCEL_REASON_MIN_15: 'Informe o motivo do cancelamento (mínimo de 15 letras).',
  EMITTER_NOT_CONFIGURED: 'Cadastre a empresa emitente (CNPJ e UF) antes de emitir.',
  MDFE_LOCKED: 'MDF-e emitido não pode ser alterado.',
  MDFE_NOT_DIGITADO: 'Só é possível emitir um MDF-e digitado.',
  MDFE_NOT_ISSUED: 'O MDF-e precisa estar emitido.',
  MDFE_INCOMPLETE: 'Faltam dados para emitir',
  CLOSING_PLACE_REQUIRED: 'Informe a cidade e a UF de encerramento.',
  POLICY_REQUIRED: 'Selecione a apólice de seguro.',
  POLICY_INACTIVE: 'A apólice está inativa.',
  INSURANCE_NUMBER_REQUIRED: 'Informe o número da averbação.',
  INVOICE_LOCKED: 'Fatura emitida não pode ser alterada.',
  INVOICE_NOT_OPEN: 'A fatura não está aberta.',
  INVOICE_NOT_ISSUED: 'A fatura precisa estar emitida.',
  INVOICE_WITHOUT_CTE: 'A fatura não tem CT-es.',
  INVOICE_PAID: 'Fatura paga não pode ser cancelada.',
  LOAD_PLAN_LOCKED: 'Carga liberada ou cancelada não pode ser alterada.',
  LOAD_PLAN_EMPTY: 'A carga não tem itens.',
  OVER_WEIGHT_CAPACITY: 'O peso passa da capacidade do veículo.',
  OVER_CUBAGE_CAPACITY: 'O volume (m³) passa da capacidade do veículo.',
  VEHICLE_REQUIRED: 'Selecione o veículo.',
  CONTRACT_LOCKED: 'Contrato com CIOT ou quitado não pode ser excluído.',
  CIOT_REQUIRED: 'Informe o número do CIOT.',
  SCHEDULED_DATE_REQUIRED: 'Informe a data agendada.',
  END_BEFORE_START: 'O fim da jornada é antes do início.',
  TIRE_ALREADY_MOUNTED: 'O pneu já está montado. Use rodízio ou desmontagem.',
  TIRE_SCRAPPED: 'Pneu sucateado não pode ser movimentado.',
  VEHICLE_AND_POSITION_REQUIRED: 'Informe o veículo e a posição.',
  MOVEMENT_LOCKED: 'Movimentação não pode ser alterada. Exclua e lance de novo.',
  FIRE_NUMBER_ALREADY_EXISTS: 'Já existe um pneu com este número de fogo.',
  NUMBER_ALREADY_USED: 'Número já usado nesta série.',
  QUOTE_ALREADY_CONVERTED: 'A cotação já virou CT-e.',
  QUOTE_NOT_OPEN: 'A cotação não está aberta nem aprovada.',
  NO_FREIGHT_RANGE: 'A tabela não tem faixa para esta origem, destino e peso.',
  TABLE_ID_REQUIRED: 'Selecione a tabela de frete.',
  NOTFIS_EMPTY: 'Nenhuma nota fiscal encontrada no arquivo.',
  FREIGHT_INVOICE_REQUIRED: 'Selecione a fatura.',
  IN_USE: 'Registro em uso. Inative em vez de excluir.',
  DUPLICATE: 'Registro duplicado.',
  INVALID_DATE: 'Data inválida.',
  INVALID_VALUE: 'Valor inválido.',
};

const FIELD_LABELS = {};

// ==========================================================
// Helpers
// ==========================================================
export const $ = (id) => document.getElementById(id);

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d ? `${d}/${m}/${y}` : String(iso);
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || v === '') return '';
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: digits });
}

export function fmtMinutes(min) {
  if (min === null || min === undefined || min === '') return '';
  const m = Math.round(Number(min));
  const sign = m < 0 ? '-' : '';
  const a = Math.abs(m);
  return `${sign}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}

export function todayIso() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function label(value) {
  return String(value ?? '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export function badge(value, text) {
  if (value === null || value === undefined || value === '') return '';
  return `<span class="tms-badge tms-badge--${esc(value)}">${esc(text ?? label(value))}</span>`;
}

/** ISO → valor de <input type="datetime-local"> (horário local) */
function toLocalInput(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function notifyError(err) {
  const code = String(err?.message || '').replace(/^\d+:\s*/, '');
  let msg = ERROR_MESSAGES[code] || FIELD_LABELS[code] || code || 'Falha na operação.';
  if (/_REQUIRED$/.test(code) && !ERROR_MESSAGES[code]) {
    msg = `Preencha o campo: ${label(code.replace(/_REQUIRED$/, ''))}.`;
  }
  if (err?.details?.missing) msg += `: ${err.details.missing.join(', ')}.`;
  if (window.Alert?.error) window.Alert.error('Atenção', esc(msg));
  else alert(msg);
}

export function notifyOk(msg) {
  if (window.Alert?.success) window.Alert.success('Pronto', esc(msg), 2600);
}

/** Aviso com várias linhas (texto puro) */
export function notifyInfo(title, lines, ms = 15000) {
  if (window.Alert?.info) window.Alert.info(esc(title), lines.map(esc).join('<br>'), ms);
  else alert(`${title}\n${lines.join('\n')}`);
}

export async function api(path, { method = 'GET', body } = {}) {
  const token = getAuthToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (res.status === 401) throw new Error('Sessão expirada. Faça login novamente.');
  if (!res.ok || json?.ok === false) {
    const err = new Error(json?.error || json?.message || `HTTP ${res.status}`);
    err.details = json?.details;
    err.status = res.status;
    throw err;
  }
  return json?.data;
}

/** Baixa um arquivo da API (com JWT) */
export async function download(path, fallbackName) {
  const token = getAuthToken();
  const res = await fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, v);
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ==========================================================
// Listas (lookups) com cache por tela
// ==========================================================
const lookupCache = new Map();

export async function loadLookup(name, { fresh = false } = {}) {
  if (fresh || !lookupCache.has(name)) lookupCache.set(name, api(`/lookups/${name}`).catch((e) => { lookupCache.delete(name); throw e; }));
  return lookupCache.get(name);
}

// ==========================================================
// Formatação de células
// ==========================================================
function cell(col, row) {
  const v = row[col.key];
  if (typeof col.render === 'function') return col.render(row);
  switch (col.fmt) {
    case 'date': return esc(fmtDate(v));
    case 'datetime': return esc(fmtDateTime(v));
    case 'money': return esc(fmtMoney(v));
    case 'num': return esc(fmtNum(v, col.digits ?? 2));
    case 'int': return esc(fmtNum(v, 0));
    case 'badge': return badge(v, col.labels?.[v]);
    case 'bool': return v ? '✅' : '—';
    case 'min': return esc(fmtMinutes(v));
    default: return esc(v);
  }
}

const isNumFmt = (fmt) => ['money', 'num', 'int', 'min'].includes(fmt);

// ==========================================================
// Campos do formulário
// ==========================================================
let uid = 0;
const nextId = (p) => `${p}_${++uid}`;

function optionsHtml(options, value, { empty = true, emptyLabel = '— selecione —' } = {}) {
  const list = (options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: label(o) }));
  return `${empty ? `<option value="">${emptyLabel}</option>` : ''}${list.map((o) =>
    `<option value="${esc(o.value)}" ${String(o.value) === String(value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}`;
}

function inputHtml(f, id, value, disabled) {
  const dis = disabled || f.readonly ? 'disabled' : '';
  const req = f.required ? 'required' : '';
  const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '';
  switch (f.type) {
    case 'select':
      return `<select id="${id}" ${dis} ${req}>${optionsHtml(f.options, value ?? f.default, { empty: !f.noEmpty })}</select>`;
    case 'uf':
      return `<select id="${id}" ${dis} ${req}>${optionsHtml(UF.map((u) => ({ value: u, label: u })), value ?? f.default, { emptyLabel: '—' })}</select>`;
    case 'bool':
      return `<select id="${id}" ${dis}>${optionsHtml([{ value: 'true', label: f.yes || 'Sim' }, { value: 'false', label: f.no || 'Não' }],
        value === null || value === undefined || value === '' ? String(f.default ?? false) : String(value), { empty: false })}</select>`;
    case 'lookup':
      return `<select id="${id}" ${dis} ${req} data-lookup="${esc(f.lookup)}" data-value="${esc(value ?? '')}"><option value="">Carregando…</option></select>`;
    case 'customer':
      return `<input id="${id}" type="text" ${dis} ${req} ${ph} list="${id}_list" autocomplete="off" value="${esc(value ?? '')}" />
              <datalist id="${id}_list"></datalist>`;
    case 'textarea':
      return `<textarea id="${id}" rows="${f.rows || 3}" ${dis} ${req} ${ph}>${esc(value ?? '')}</textarea>`;
    case 'date':
      return `<input id="${id}" type="date" ${dis} ${req} value="${esc(value ?? '')}" />`;
    case 'datetime':
      return `<input id="${id}" type="datetime-local" ${dis} ${req} value="${esc(toLocalInput(value))}" />`;
    case 'number': case 'money': case 'int':
      return `<input id="${id}" type="number" ${dis} ${req} ${ph} step="${f.step ?? (f.type === 'int' ? 1 : 0.01)}" ${f.min !== undefined ? `min="${f.min}"` : ''} value="${esc(value ?? '')}" />`;
    default:
      return `<input id="${id}" type="text" ${dis} ${req} ${ph} ${f.max ? `maxlength="${f.max}"` : ''} value="${esc(value ?? '')}" />`;
  }
}

function readInput(f, el) {
  if (!el) return undefined;
  const v = el.value;
  if (f.type === 'datetime') return v ? new Date(v).toISOString() : '';
  if (f.type === 'uf' || f.upper) return v.toUpperCase();
  return v;
}

async function fillLookups(root) {
  const selects = [...root.querySelectorAll('select[data-lookup]')];
  await Promise.all(selects.map(async (sel) => {
    try {
      const rows = await loadLookup(sel.dataset.lookup);
      const value = sel.dataset.value;
      sel.innerHTML = `<option value="">— selecione —</option>${rows.map((r) =>
        `<option value="${esc(r.id)}" ${String(r.id) === String(value) ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}`;
      if (value && !rows.some((r) => String(r.id) === String(value))) {
        sel.insertAdjacentHTML('beforeend', `<option value="${esc(value)}" selected>#${esc(value)}</option>`);
      }
    } catch {
      sel.innerHTML = '<option value="">(falha ao carregar)</option>';
    }
  }));
}

/** Autocomplete de clientes: digita → lista; escolheu → preenche os campos ligados */
function wireCustomer(f, input, form) {
  const list = document.getElementById(`${input.id}_list`);
  let found = [];
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const term = input.value.trim();
    const hit = found.find((c) => c.label === term);
    if (hit) {
      input.value = hit.name;
      Object.entries(f.fill || {}).forEach(([src, dst]) => form.set(dst, hit[src] ?? ''));
      if (f.idField) form.set(f.idField, hit.id);
      form.changed();
      return;
    }
    if (f.idField) form.set(f.idField, '');
    if (term.length < 2) return;
    timer = setTimeout(async () => {
      try {
        found = await api(`/lookups/customers${qs({ q: term })}`);
        list.innerHTML = found.map((c) => `<option value="${esc(c.label)}"></option>`).join('');
      } catch { /* sem sugestões */ }
    }, 250);
  });
}

// ==========================================================
// Modal de formulário (um por aba)
// ==========================================================
function buildModalShell(id, width, title) {
  const html = `
  <div class="modal" id="${id}" aria-hidden="true">
    <div class="modal__backdrop" data-modal-close></div>
    <div class="modal__dialog">
      <div class="modal__panel modal-width-${width} modal-header-color-2 modal-footer-color-1" role="dialog" aria-modal="true">
        <header class="modal__header">
          <h2 class="modal__title" data-role="title">${esc(title)}</h2>
          <button type="button" class="modal__close" data-modal-close aria-label="Fechar modal" title="Fechar">×</button>
        </header>
        <form autocomplete="off" novalidate>
          <div class="modal__body" data-role="body"></div>
          <footer class="modal__footer" data-role="footer"></footer>
        </form>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  return document.getElementById(id);
}

/**
 * Formulário: sections [{ title, fields: [{ key, label, type, w, ... }] }] + children (grades)
 */
class TmsForm {
  constructor(tab, page) {
    this.tab = tab;
    this.page = page;
    this.cfg = tab.form;
    this.modalId = nextId('tmsModal');
    this.modal = buildModalShell(this.modalId, this.cfg.width || 12, this.cfg.title || tab.label);
    this.form = this.modal.querySelector('form');
    this.body = this.modal.querySelector('[data-role="body"]');
    this.footer = this.modal.querySelector('[data-role="footer"]');
    this.ids = new Map();
    this.childRows = {};
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
    this.form.addEventListener('input', () => this.changed());
    this.form.addEventListener('change', () => this.changed());
  }

  fields() {
    return this.cfg.sections.flatMap((s) => s.fields);
  }

  get(key) {
    const f = this.fields().find((x) => x.key === key);
    const id = this.ids.get(key);
    if (!f || !id) return this.row?.[key];
    return readInput(f, document.getElementById(id));
  }

  set(key, value) {
    const id = this.ids.get(key);
    const el = id && document.getElementById(id);
    if (!el) { if (this.row) this.row[key] = value; return; }
    if (el.tagName === 'SELECT' && value !== '' && value !== null && value !== undefined
      && ![...el.options].some((o) => o.value === String(value))) {
      el.insertAdjacentHTML('beforeend', `<option value="${esc(value)}">${esc(value)}</option>`);
    }
    el.value = value ?? '';
  }

  values() {
    const out = {};
    for (const f of this.fields()) {
      if (f.readonly || f.display) continue;
      out[f.key] = this.get(f.key);
    }
    for (const ch of this.cfg.children || []) {
      if (ch.readonly) continue;
      out[ch.key] = this.readChild(ch);
    }
    return out;
  }

  changed() {
    clearTimeout(this.computeTimer);
    if (!this.cfg.compute || this.locked) return;
    this.computeTimer = setTimeout(() => {
      Promise.resolve(this.cfg.compute(this.values(), this)).catch(() => {});
    }, 300);
  }

  async open(row = null) {
    this.row = row ? { ...row } : { ...(this.cfg.defaults ? this.cfg.defaults() : {}) };
    this.isNew = !row?.[this.tab.pk];
    this.locked = !this.isNew && this.tab.canEdit && !this.tab.canEdit(row);
    const title = this.isNew ? (this.cfg.newTitle || `➕ ${this.cfg.title || 'Novo'}`) : (this.cfg.editTitle ? this.cfg.editTitle(row) : `✏️ ${this.cfg.title || 'Editar'} ${row[this.tab.pk]}`);
    this.modal.querySelector('[data-role="title"]').textContent = this.locked ? `${title} (somente leitura)` : title;
    this.render();
    await fillLookups(this.body);
    this.fields().filter((f) => f.type === 'customer').forEach((f) => wireCustomer(f, document.getElementById(this.ids.get(f.key)), this));
    if (this.cfg.onOpen) await this.cfg.onOpen(this);
    Modal.open(this.modalId);
  }

  render() {
    this.ids.clear();
    const parts = [];
    this.cfg.sections.forEach((s, i) => {
      if (s.when && !s.when(this.row, this)) return;
      if (i) parts.push('<div class="modal-divider"></div>');
      parts.push(`<section class="modal-section">${s.title ? `<h3 class="tms-section-title">${esc(s.title)}</h3>` : ''}
        <div class="fields-inline fields-inline-wrap fields-gap-3">`);
      for (const f of s.fields) {
        const id = nextId('f');
        this.ids.set(f.key, id);
        const v = f.value ? f.value(this.row) : this.row[f.key];
        if (f.type === 'hidden') {
          parts.push(`<input type="hidden" id="${id}" value="${esc(v ?? '')}" />`);
          continue;
        }
        parts.push(`<div class="fields fields-h-5 fields-w-${f.w || 12} fields-font-3">
          <label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>
          ${inputHtml(f, id, v ?? (this.isNew ? f.default : undefined), this.locked || (f.lockOnEdit && !this.isNew))}
        </div>`);
      }
      parts.push('</div></section>');
    });
    for (const ch of this.cfg.children || []) {
      this.childRows[ch.key] = (this.row[ch.key] || []).map((r) => ({ ...r }));
      parts.push(`<div class="modal-divider"></div><section class="modal-section" data-child="${ch.key}"></section>`);
    }
    this.body.innerHTML = parts.join('');
    for (const ch of this.cfg.children || []) this.renderChild(ch);

    const extra = (this.cfg.footerButtons || [])
      .filter((b) => !b.when || b.when(this.row, this))
      .map((b, i) => `<button type="button" class="btn ${b.cls || 'btn-toolbar'} btn-sm" data-extra="${i}">${esc(b.label)}</button>`).join('');
    this.footer.innerHTML = `${extra}
      <button type="button" class="btn btn-cancel btn-sm" data-act="close">${this.locked ? 'Fechar' : 'Cancelar'}</button>
      ${this.locked ? '' : `<button type="submit" class="btn btn-save btn-sm">💾 Salvar</button>`}`;
    this.footer.querySelector('[data-act="close"]').onclick = () => Modal.close(this.modalId);
    this.footer.querySelectorAll('[data-extra]').forEach((btn) => {
      const b = (this.cfg.footerButtons || []).filter((x) => !x.when || x.when(this.row, this))[Number(btn.dataset.extra)];
      btn.onclick = () => Promise.resolve(b.run(this)).catch(notifyError);
    });
  }

  // ───────── grades filhas ─────────
  renderChild(ch) {
    const host = this.body.querySelector(`[data-child="${ch.key}"]`);
    const rows = this.childRows[ch.key];
    const editable = !this.locked && !ch.readonly;
    const toolbar = (ch.toolbar || []).filter((b) => editable || b.always).map((b, i) =>
      `<button type="button" class="btn btn-toolbar btn-sm" data-tool="${i}">${esc(b.label)}</button>`).join('');
    const head = ch.columns.map((c) => `<th style="${c.width ? `width:${c.width}px;` : ''}" class="${isNumFmt(c.fmt) || ['number', 'money', 'int'].includes(c.type) ? 'tms-num' : ''}">${esc(c.label)}</th>`).join('');
    const body = rows.length ? rows.map((r, idx) => `<tr data-idx="${idx}">${ch.columns.map((c) => {
      if (!editable || c.readonly) return `<td class="${isNumFmt(c.fmt) ? 'tms-num' : ''}">${cell(c, r)}</td>`;
      const id = `${this.modalId}_${ch.key}_${idx}_${c.key}`;
      return `<td>${inputHtml({ ...c, required: false }, id, r[c.key] ?? c.default, false)}</td>`;
    }).join('')}${editable ? '<td class="tms-actions"><button type="button" class="btn btn-delete btn-sm" data-del="1" title="Remover">🗑️</button></td>' : ''}</tr>`).join('')
      : `<tr><td class="tms-empty" colspan="${ch.columns.length + 1}">${esc(ch.empty || 'Nenhuma linha.')}</td></tr>`;
    const total = ch.footer ? `<div class="tms-child-footer">${ch.footer(rows)}</div>` : '';
    host.innerHTML = `
      <div class="tms-child-head">
        <h3 class="tms-section-title">${esc(ch.title)}</h3>
        <div class="tms-actions">${toolbar}${editable && ch.allowAdd !== false ? `<button type="button" class="btn btn-new btn-sm" data-add="1">➕ ${esc(ch.addLabel || 'Adicionar linha')}</button>` : ''}</div>
      </div>
      <div class="table-scroll tms-child-table">
        <table class="table table-zebra table-sticky-head">
          <thead><tr>${head}${editable ? '<th class="col-actions" style="width:50px;"></th>' : ''}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>${total}`;
    host.querySelector('[data-add]')?.addEventListener('click', () => {
      this.syncChild(ch);
      rows.push(ch.newRow ? ch.newRow(this) : {});
      this.renderChild(ch);
      fillLookups(host);
    });
    host.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', () => {
      this.syncChild(ch);
      rows.splice(Number(btn.closest('tr').dataset.idx), 1);
      this.renderChild(ch);
      fillLookups(host);
      this.changed();
    }));
    host.querySelectorAll('[data-tool]').forEach((btn) => btn.addEventListener('click', () => {
      this.syncChild(ch);
      const tool = (ch.toolbar || []).filter((b) => editable || b.always)[Number(btn.dataset.tool)];
      Promise.resolve(tool.run(this, ch)).catch(notifyError);
    }));
    host.addEventListener('change', () => { this.syncChild(ch); if (ch.footer) host.querySelector('.tms-child-footer').innerHTML = ch.footer(rows); });
    fillLookups(host);
  }

  syncChild(ch) {
    if (this.locked || ch.readonly) return;
    const rows = this.childRows[ch.key];
    rows.forEach((r, idx) => {
      for (const c of ch.columns) {
        if (c.readonly) continue;
        const el = document.getElementById(`${this.modalId}_${ch.key}_${idx}_${c.key}`);
        if (el) r[c.key] = readInput(c, el);
      }
    });
  }

  readChild(ch) {
    this.syncChild(ch);
    return this.childRows[ch.key].map((r) => {
      const out = {};
      for (const c of ch.columns) if (!c.display) out[c.key] = r[c.key];
      for (const k of ch.keep || []) out[k] = r[k];
      return out;
    });
  }

  addChildRows(key, rows) {
    const ch = this.cfg.children.find((c) => c.key === key);
    this.syncChild(ch);
    this.childRows[key].push(...rows);
    this.renderChild(ch);
    this.changed();
  }

  async save() {
    const payload = this.values();
    if (this.cfg.beforeSave) this.cfg.beforeSave(payload, this);
    try {
      const pk = this.row?.[this.tab.pk];
      const saved = pk
        ? await api(`/${this.tab.resource}/${pk}`, { method: 'PUT', body: payload })
        : await api(`/${this.tab.resource}`, { method: 'POST', body: payload });
      Modal.close(this.modalId);
      notifyOk('Registro salvo.');
      await this.page.reloadAll();
      if (this.cfg.afterSave) await this.cfg.afterSave(saved, this);
    } catch (err) {
      notifyError(err);
    }
  }

  close() {
    Modal.close(this.modalId);
  }
}

// ==========================================================
// Modal de seleção (lista com checkboxes)
// ==========================================================
let pickerModal = null;

export function pickRows({ title, rows, columns, confirmLabel = '✅ Adicionar selecionados' }) {
  if (!pickerModal) pickerModal = buildModalShell('tmsPickerModal', 12, '');
  return new Promise((resolve) => {
    pickerModal.querySelector('[data-role="title"]').textContent = title;
    const bodyEl = pickerModal.querySelector('[data-role="body"]');
    const footer = pickerModal.querySelector('[data-role="footer"]');
    bodyEl.innerHTML = rows.length ? `
      <div class="table-scroll tms-child-table tms-picker-table">
        <table class="table table-zebra table-zebra-hover table-sticky-head">
          <thead><tr><th style="width:36px;"><input type="checkbox" data-all="1" /></th>${columns.map((c) =>
    `<th class="${isNumFmt(c.fmt) ? 'tms-num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map((r, i) => `<tr><td><input type="checkbox" data-i="${i}" /></td>${columns.map((c) =>
    `<td class="${isNumFmt(c.fmt) ? 'tms-num' : ''}">${cell(c, r)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>` : '<p class="tms-empty">Nada disponível para adicionar.</p>';
    footer.innerHTML = `<button type="button" class="btn btn-cancel btn-sm" data-act="cancel">Cancelar</button>
      ${rows.length ? `<button type="button" class="btn btn-save btn-sm" data-act="ok">${esc(confirmLabel)}</button>` : ''}`;
    bodyEl.querySelector('[data-all]')?.addEventListener('change', (e) => {
      bodyEl.querySelectorAll('[data-i]').forEach((c) => { c.checked = e.target.checked; });
    });
    let done = false;
    const finish = (val) => { if (done) return; done = true; Modal.close('tmsPickerModal'); resolve(val); };
    footer.querySelector('[data-act="cancel"]').onclick = () => finish([]);
    const okBtn = footer.querySelector('[data-act="ok"]');
    if (okBtn) okBtn.onclick = () => finish([...bodyEl.querySelectorAll('[data-i]:checked')].map((c) => rows[Number(c.dataset.i)]));
    pickerModal.querySelectorAll('[data-modal-close]').forEach((el) => { el.onclick = () => finish([]); });
    Modal.open('tmsPickerModal');
  });
}

// ==========================================================
// Modal de perguntas (motivo, nº da averbação, data...)
// ==========================================================
let askModal = null;

export function ask({ title, fields, confirmLabel = '✅ Confirmar' }) {
  if (!askModal) askModal = buildModalShell('tmsAskModal', 8, '');
  return new Promise((resolve) => {
    askModal.querySelector('[data-role="title"]').textContent = title;
    const bodyEl = askModal.querySelector('[data-role="body"]');
    const footer = askModal.querySelector('[data-role="footer"]');
    const ids = fields.map(() => nextId('ask'));
    bodyEl.innerHTML = `<section class="modal-section"><div class="fields-inline fields-inline-wrap fields-gap-3">${fields.map((f, i) => `
      <div class="fields fields-h-5 fields-w-${f.w || 40} fields-font-3">
        <label for="${ids[i]}">${esc(f.label)}${f.required ? ' *' : ''}</label>
        ${inputHtml(f, ids[i], f.value ?? f.default, false)}
      </div>`).join('')}</div></section>`;
    footer.innerHTML = `<button type="button" class="btn btn-cancel btn-sm" data-act="cancel">Cancelar</button>
      <button type="button" class="btn btn-save btn-sm" data-act="ok">${esc(confirmLabel)}</button>`;
    fillLookups(bodyEl);
    let done = false;
    const finish = (val) => { if (done) return; done = true; Modal.close('tmsAskModal'); resolve(val); };
    footer.querySelector('[data-act="cancel"]').onclick = () => finish(null);
    footer.querySelector('[data-act="ok"]').onclick = () => {
      const out = {};
      fields.forEach((f, i) => { out[f.key] = readInput(f, document.getElementById(ids[i])); });
      finish(out);
    };
    askModal.querySelectorAll('[data-modal-close]').forEach((el) => { el.onclick = () => finish(null); });
    Modal.open('tmsAskModal', { focusSelector: `#${ids[0]}` });
  });
}

// ==========================================================
// Aba com tabela (lista + filtros + paginação)
// ==========================================================
class TmsTab {
  constructor(cfg, page) {
    this.cfg = cfg;
    this.page = page;
    this.state = { page: 1, limit: 30, total: 0, rows: [] };
    this.pk = cfg.pk;
    this.resource = cfg.resource;
    this.canEdit = cfg.canEdit;
    this.form = cfg.form ? new TmsForm({ ...cfg, label: cfg.label }, page) : null;
  }

  html() {
    const c = this.cfg;
    if (c.custom) return `<div id="${this.panelId}" class="tab-panel" role="tabpanel" tabindex="0" hidden><div data-role="custom"></div></div>`;
    const filters = (c.filters || []).map((f) => {
      const id = `${this.panelId}_f_${f.key}`;
      if (f.type === 'daterange') {
        return `<div class="fields fields-h-6 fields-w-12 fields-font-3"><label for="${id}_from">${esc(f.label || 'De')}</label>
          <input id="${id}_from" type="date" /></div>
          <div class="fields fields-h-6 fields-w-12 fields-font-3"><label for="${id}_to">Até</label><input id="${id}_to" type="date" /></div>`;
      }
      if (f.type === 'lookup') {
        return `<div class="fields fields-h-6 fields-w-${f.w || 15} fields-font-3"><label for="${id}">${esc(f.label)}</label>
          <select id="${id}" data-lookup="${esc(f.lookup)}"><option value="">Todos</option></select></div>`;
      }
      return `<div class="fields fields-h-6 fields-w-${f.w || 12} fields-font-3"><label for="${id}">${esc(f.label)}</label>
        <select id="${id}"><option value="">Todos</option>${(f.options || []).map((o) => {
  const ob = typeof o === 'object' ? o : { value: o, label: label(o) };
  return `<option value="${esc(ob.value)}">${esc(ob.label)}</option>`;
}).join('')}</select></div>`;
    }).join('');
    const head = c.columns.map((col) => `<th style="${col.width ? `width:${col.width}px;` : ''}" class="${isNumFmt(col.fmt) ? 'tms-num' : ''}">${esc(col.label)}</th>`).join('');
    return `
    <div id="${this.panelId}" class="tab-panel" role="tabpanel" tabindex="0" hidden>
      ${c.intro ? `<p class="tms-intro">${c.intro}</p>` : ''}
      <section class="table-layout-integrated table-max-height-${c.maxHeight || 500}">
        <div class="table-layout-integrated__filter">
          <div class="fields fields-inline fields-gap-3">
            <div class="fields fields-h-6 fields-w-25 fields-font-3">
              <label for="${this.panelId}_q">🔎 Pesquisar</label>
              <input id="${this.panelId}_q" type="text" placeholder="${esc(c.searchPlaceholder || 'Pesquisar...')}" autocomplete="off" />
            </div>
            ${filters}
            <div class="btn-inline">
              <button data-role="search" class="btn btn-filter btn-sm" type="button">Filtrar</button>
              <button data-role="clear" class="btn btn-clean btn-sm" type="button">Limpar</button>
              ${c.form && c.allowNew !== false ? `<button data-role="new" class="btn btn-new btn-sm" type="button">${esc(c.newLabel || '➕ Novo')}</button>` : ''}
              ${(c.toolbar || []).map((b, i) => `<button data-tool="${i}" class="btn ${b.cls || 'btn-toolbar'} btn-sm" type="button">${esc(b.label)}</button>`).join('')}
            </div>
          </div>
        </div>
        <div class="table-scroll table-height-flex table-row-h-28">
          <table class="table table-zebra table-zebra-hover table-sticky-head">
            <thead><tr>${head}<th class="col-actions" style="width:${c.actionsWidth || 220}px;">Ações</th></tr></thead>
            <tbody data-role="tbody"></tbody>
          </table>
        </div>
        <footer class="table-footer">
          <div class="table-footer__info">
            <div class="summary-pill summary-pill--success summary-width-5 summary-left-space-3"><span data-role="count">0 registro(s)</span></div>
            <span data-role="summary" class="tms-summary-inline"></span>
          </div>
          <div class="table-footer__pagination">
            <button data-role="prev" type="button" class="btn btn-toolbar btn-sm" disabled>Anterior</button>
            <span data-role="pageLbl">Página 1 de 1</span>
            <button data-role="next" type="button" class="btn btn-toolbar btn-sm" disabled>Próxima</button>
          </div>
          <div class="table-footer__page-size">
            <label>Mostrar</label>
            <div class="fields fields-h-6 fields-w-3 fields-font-3">
              <select data-role="limit" class="table-footer__page-size-select">
                <option value="10">10</option><option value="20">20</option><option value="30" selected>30</option>
                <option value="50">50</option><option value="100">100</option>
              </select>
            </div>
          </div>
        </footer>
      </section>
    </div>`;
  }

  el(role) {
    return this.panel.querySelector(`[data-role="${role}"]`);
  }

  wire() {
    this.panel = $(this.panelId);
    const c = this.cfg;
    if (c.custom) {
      this.custom = c.custom;
      return;
    }
    fillLookups(this.panel).then(() => {
      this.panel.querySelectorAll('select[data-lookup] option[value=""]').forEach((o) => { o.textContent = 'Todos'; });
    });
    this.el('search').onclick = () => { this.state.page = 1; this.load().catch(notifyError); };
    this.el('clear').onclick = () => {
      this.panel.querySelectorAll('.table-layout-integrated__filter input, .table-layout-integrated__filter select').forEach((x) => { x.value = ''; });
      this.state.page = 1;
      this.load().catch(notifyError);
    };
    $(`${this.panelId}_q`).addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.state.page = 1; this.load().catch(notifyError); } });
    this.el('new')?.addEventListener('click', () => this.form.open(null).catch(notifyError));
    this.panel.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.onclick = () => Promise.resolve(c.toolbar[Number(btn.dataset.tool)].run(this.page, this)).catch(notifyError);
    });
    this.el('prev').onclick = () => { this.state.page -= 1; this.load().catch(notifyError); };
    this.el('next').onclick = () => { this.state.page += 1; this.load().catch(notifyError); };
    this.el('limit').onchange = (e) => { this.state.limit = Number(e.target.value); this.state.page = 1; this.load().catch(notifyError); };
  }

  query() {
    const q = { q: $(`${this.panelId}_q`)?.value, page: this.state.page, limit: this.state.limit, ...(this.cfg.baseQuery || {}) };
    for (const f of this.cfg.filters || []) {
      const id = `${this.panelId}_f_${f.key}`;
      if (f.type === 'daterange') {
        q.date_from = $(`${id}_from`).value;
        q.date_to = $(`${id}_to`).value;
      } else {
        q[f.key] = $(id).value;
      }
    }
    return q;
  }

  async load() {
    if (this.custom) return this.custom.load(this.panel.querySelector('[data-role="custom"]'), this.page);
    const data = await api(`/${this.resource}${qs(this.query())}`);
    Object.assign(this.state, { rows: data.rows, total: data.total, page: data.page });
    this.render();
  }

  render() {
    const c = this.cfg;
    const { rows, total, page, limit } = this.state;
    const tbody = this.el('tbody');
    tbody.innerHTML = rows.length ? rows.map((r, idx) => {
      const acts = [];
      if (c.form) acts.push(`<button class="btn btn-edit btn-sm" type="button" data-act="open">${c.canEdit && !c.canEdit(r) ? '👁️ Ver' : '✏️ Abrir'}</button>`);
      (c.actions || []).forEach((a, i) => {
        if (!a.when || a.when(r)) acts.push(`<button class="btn ${a.cls || 'btn-toolbar'} btn-sm" type="button" data-custom="${i}" title="${esc(a.title || '')}">${esc(a.label)}</button>`);
      });
      if (c.allowDelete !== false && (!c.canDelete || c.canDelete(r))) acts.push('<button class="btn btn-delete btn-sm" type="button" data-act="delete" title="Excluir">🗑️</button>');
      const cls = c.rowClass ? c.rowClass(r) : '';
      return `<tr data-idx="${idx}" class="${cls}">${c.columns.map((col) => `<td class="${isNumFmt(col.fmt) ? 'tms-num' : ''}">${cell(col, r)}</td>`).join('')}
        <td class="col-actions"><div class="tms-actions">${acts.join('')}</div></td></tr>`;
    }).join('') : `<tr><td class="tms-empty" colspan="${c.columns.length + 1}">Nenhum registro encontrado.</td></tr>`;

    tbody.querySelectorAll('tr[data-idx]').forEach((tr) => {
      const row = rows[Number(tr.dataset.idx)];
      tr.querySelector('[data-act="open"]')?.addEventListener('click', () => this.openRow(row).catch(notifyError));
      tr.querySelector('[data-act="delete"]')?.addEventListener('click', () => this.deleteRow(row).catch(notifyError));
      tr.querySelectorAll('[data-custom]').forEach((btn) => btn.addEventListener('click', () => {
        const a = c.actions[Number(btn.dataset.custom)];
        Promise.resolve(a.run(row, this.page, this)).catch(notifyError);
      }));
    });
    const pages = Math.max(1, Math.ceil(total / limit));
    this.el('count').textContent = `${total} registro(s)`;
    this.el('pageLbl').textContent = `Página ${page} de ${pages}`;
    this.el('prev').disabled = page <= 1;
    this.el('next').disabled = page >= pages;
    this.el('summary').innerHTML = c.summary ? c.summary(rows) : '';
  }

  async openRow(row) {
    const full = await api(`/${this.resource}/${row[this.pk]}`);
    await this.form.open(full);
  }

  async deleteRow(row) {
    if (!confirm(this.cfg.deleteConfirm ? this.cfg.deleteConfirm(row) : 'Excluir este registro?')) return;
    await api(`/${this.resource}/${row[this.pk]}`, { method: 'DELETE' });
    notifyOk('Registro excluído.');
    await this.page.reloadAll();
  }
}

// ==========================================================
// Página
// ==========================================================
class TmsPage {
  constructor(cfg) {
    this.cfg = cfg;
    this.tabs = cfg.tabs.map((t, i) => {
      const tab = new TmsTab(t, this);
      tab.panelId = `tmsTab_${i}`;
      return tab;
    });
    this.active = 0;
  }

  mount() {
    Modal.setup();
    const root = $('tmsApp');
    const c = this.cfg;
    root.innerHTML = `
      <div class="header">
        <div class="fields fields-inline fields-gap-3">
          <div class="fields fields-h-6 fields-w-40 fields-font-3">
            <div>
              <h2 class="page-header__title">${esc(c.title)}</h2>
              <p class="page-header__subtitle">${esc(c.subtitle || '')}</p>
            </div>
          </div>
          <div class="btn-position-right">
            <button type="button" class="btn btn-new btn-sm" data-role="reload">⟳ Atualizar</button>
          </div>
        </div>
      </div>
      ${c.notice ? `<div class="tms-notice">${c.notice}</div>` : ''}
      ${this.tabs.length > 1 ? `<section class="tabs"><div class="tab-list" role="tablist">${this.tabs.map((t, i) =>
    `<button type="button" class="tab ${i === 0 ? 'is-active' : ''}" role="tab" aria-selected="${i === 0}" data-tab="${i}">${esc(t.cfg.label)}</button>`).join('')}</div></section>` : ''}
      ${this.tabs.map((t) => t.html()).join('')}`;
    this.tabs.forEach((t) => t.wire());
    root.querySelector('[data-role="reload"]').onclick = () => { lookupCache.clear(); this.reloadAll().catch(notifyError); };
    root.querySelectorAll('.tabs .tab').forEach((btn) => btn.addEventListener('click', () => this.go(Number(btn.dataset.tab))));
    this.go(0);
  }

  go(i) {
    this.active = i;
    document.querySelectorAll('.tabs .tab').forEach((btn) => {
      const on = Number(btn.dataset.tab) === i;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    this.tabs.forEach((t, k) => {
      t.panel.toggleAttribute('hidden', k !== i);
      t.panel.classList.toggle('is-active', k === i);
    });
    this.tabs[i].load().catch(notifyError);
  }

  tab(key) {
    return this.tabs.find((t) => t.cfg.key === key);
  }

  async reloadAll() {
    lookupCache.clear();
    await this.tabs[this.active].load();
  }
}

export function mountTmsPage(cfg) {
  const page = new TmsPage(cfg);
  page.mount();
  return page;
}

// ==========================================================
// Impressão simples (DACTE / DAMDFE / documentos) — sem valor fiscal
// ==========================================================
export function printHtml(title, inner) {
  const w = window.open('', '_blank');
  if (!w) { alert('Libere as janelas pop-up para imprimir.'); return; }
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(title)}</title>
    <style>
      body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#0f172a;margin:18px}
      h1{font-size:16px;margin:0 0 4px} h2{font-size:13px;margin:14px 0 6px;border-bottom:1px solid #94a3b8;padding-bottom:2px}
      table{width:100%;border-collapse:collapse} td,th{border:1px solid #cbd5e1;padding:4px 6px;text-align:left;vertical-align:top}
      th{background:#f1f5f9;font-size:11px} .r{text-align:right} .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .box{border:1px solid #cbd5e1;padding:6px 8px;border-radius:4px} .muted{color:#64748b;font-size:11px}
      .key{font-family:monospace;font-size:13px;letter-spacing:1px} .warn{color:#b91c1c;font-weight:bold}
      @media print{button{display:none}}
    </style></head><body>${inner}<p><button onclick="window.print()">🖨️ Imprimir</button></p></body></html>`);
  w.document.close();
}

export function formatKey(key) {
  return String(key || '').replace(/(\d{4})(?=\d)/g, '$1 ');
}
