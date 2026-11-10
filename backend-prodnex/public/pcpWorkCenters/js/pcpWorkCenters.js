// ╔════════════════════════════════════════════════════════════╗
// ║ pcpWorkCenters.js — Cadastro de Centros de Trabalho (PCP)  ║
// ╚════════════════════════════════════════════════════════════╝

import { Modal } from '/public/includes/js/modal.js';
import { actionIconsHtml } from '/public/includes/js/actionIcons.js';
import {
  pcpApi, escapeHtml, fmtNum, fmtMoney, activeBadge, messageRow, showMessage, notify, confirmCenter,
  paginate, bindPagination, renderPagination,
} from '/public/pcp/js/pcp.common.js';

const $ = (id) => document.getElementById(id);
const PAGER = { info: 'wcTableInfo', pageInfo: 'wcPageInfo', prev: 'wcPrevPage', next: 'wcNextPage', size: 'wcRowsPerPage' };
const state = { rows: [], page: 1, pageSize: 50 };

function filtered() {
  const q = $('search').value.trim().toLowerCase();
  const st = $('statusFilter').value;
  return state.rows.filter((r) =>
    (st === 'all' || (st === 'active' ? r.is_active : !r.is_active)) &&
    (!q || `${r.code} ${r.name}`.toLowerCase().includes(q)));
}

function render() {
  const pg = paginate(filtered(), state);
  $('tableBody').innerHTML = pg.slice.length ? pg.slice.map((r) => `
    <tr>
      <td><strong>${escapeHtml(r.code)}</strong></td>
      <td class="td-left">${escapeHtml(r.name)}</td>
      <td class="td-right">${fmtMoney(r.hourly_cost)}</td>
      <td class="td-right">${fmtNum(r.capacity_hours_day, 2)}</td>
      <td>${activeBadge(r.is_active)}</td>
      <td>${actionIconsHtml([
        { action: 'edit', title: `Editar ${r.code}`, attrs: { 'data-edit': r.work_center_id } },
        { action: 'delete', title: `Excluir ${r.code}`, attrs: { 'data-delete': r.work_center_id } },
      ])}</td>
    </tr>`).join('')
    : messageRow(6, 'Nenhum centro de trabalho encontrado.');
  renderPagination(PAGER, pg, state, 'centros');
}

async function load() {
  try {
    state.rows = await pcpApi('/work-centers') || [];
    render();
  } catch (e) {
    $('tableBody').innerHTML = messageRow(6, `Erro ao carregar: ${e.message}`);
  }
}

function openModal(row = null) {
  $('form').reset();
  $('modalTitle').textContent = row ? `Editar ${row.code}` : 'Novo centro de trabalho';
  $('workCenterId').value = row?.work_center_id || '';
  $('code').value = row?.code || '';
  $('name').value = row?.name || '';
  $('hourlyCost').value = row?.hourly_cost ?? 0;
  $('capacity').value = row?.capacity_hours_day ?? 8;
  $('notes').value = row?.notes || '';
  $('isActive').value = String(row ? row.is_active : true);
  Modal.open('modal', { focusSelector: '#code' });
}

async function save(e) {
  e.preventDefault();
  const id = $('workCenterId').value;
  const body = {
    code: $('code').value,
    name: $('name').value,
    hourly_cost: $('hourlyCost').value,
    capacity_hours_day: $('capacity').value,
    notes: $('notes').value,
    is_active: $('isActive').value === 'true',
  };
  try {
    await pcpApi(id ? `/work-centers/${id}` : '/work-centers', { method: id ? 'PUT' : 'POST', body });
    Modal.close('modal');
    notify('success', 'Centro de trabalho salvo');
    load();
  } catch (err) {
    showMessage(null, err.message);
  }
}

async function remove(id) {
  const row = state.rows.find((r) => r.work_center_id === id);
  if (!await confirmCenter(`Excluir o centro de trabalho ${row?.code}?`, { title: 'Excluir', confirmLabel: 'Excluir', variant: 'error' })) return;
  try {
    const res = await pcpApi(`/work-centers/${id}`, { method: 'DELETE' });
    if (res?.deactivated) notify('info', 'Centro inativado', 'Ele é usado em roteiros ou apontamentos, então foi apenas inativado.');
    load();
  } catch (err) {
    notify('error', 'Não foi possível excluir', err.message);
  }
}

$('btnNew').addEventListener('click', () => openModal());
$('form').addEventListener('submit', save);
$('search').addEventListener('input', () => { state.page = 1; render(); });
$('statusFilter').addEventListener('change', () => { state.page = 1; render(); });
$('tableBody').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-delete]');
  if (edit) openModal(state.rows.find((r) => r.work_center_id === Number(edit.dataset.edit)));
  if (del) remove(Number(del.dataset.delete));
});
Modal.setup();
bindPagination(state, PAGER, render);
load();
