import { showCenterModal } from './accountsReceivable.alert.js';
import { boletoUrl, cancelBoleto, excelUrl, listAccounts, pdfUrl, syncAsaas } from './accountsReceivable.api.js';
import { openEdit } from './accountsReceivable.form.js';
import { openReceiveModal } from './accountsReceivable.modal.js';
import { renderTable, updatePagination, updateSummary } from './accountsReceivable.render.js';
import { state } from './accountsReceivable.state.js';
import { $ } from './accountsReceivable.utils.js';

function filterParams(withPaging = true) {
  const params = new URLSearchParams();

  if (withPaging) {
    params.set('page', String(state.page));
    params.set('pageSize', String(state.pageSize));

    params.set(
      'orderBy',
      state.orderBy || 'created_at'
    );

    params.set(
      'orderDirection',
      state.orderDirection || 'desc'
    );
  }

  const fields = {
    search: '#filterSearch',
    status: '#filterStatus',
    bankAccountId: '#filterBankAccount',
  };

  Object.entries(fields).forEach(([name, selector]) => {
    const value = $(selector)?.value?.trim();

    if (value) {
      params.set(name, value);
    }
  });

  const dateType = $('#filterDateType')?.value === 'issue_date'
    ? 'issue_date'
    : 'due_date';
  const fromDate = $('#filterFromDue')?.value?.trim();
  const toDate = $('#filterToDue')?.value?.trim();

  if (fromDate) {
    params.set(dateType === 'issue_date' ? 'fromIssueDate' : 'fromDueDate', fromDate);
  }

  if (toDate) {
    params.set(dateType === 'issue_date' ? 'toIssueDate' : 'toDueDate', toDate);
  }

  // Também informa explicitamente o campo escolhido para APIs que usam
  // um intervalo genérico (dateType/fromDate/toDate).
  params.set('dateType', dateType);
  if (fromDate) params.set('fromDate', fromDate);
  if (toDate) params.set('toDate', toDate);

  return params;
}

function responseItems(json) {
  return Array.isArray(json)
    ? json
    : (json?.items || json?.rows || json?.data || []);
}

function responseTotals(json) {
  return json?.totals ?? json?.summary ?? json?.resume ?? null;
}

const OPEN_STATUSES = new Set([
  'PENDING',
  'OVERDUE',
  'PARTIAL',
]);

function sumItems(items) {
  return items.reduce((totals, item) => {
    const total = Number(item.value ?? item.total ?? 0) || 0;
    const paid = Number(item.paid_value ?? item.received ?? 0) || 0;
    const status = String(item.status ?? '').trim().toUpperCase();

    totals.total += total;
    totals.paid += paid;

    // O saldo em aberto considera somente títulos ativos.
    // Pagos e cancelados não entram no valor a receber.
    if (OPEN_STATUSES.has(status)) {
      totals.balance += Math.max(0, total - paid);
    }

    return totals;
  }, { total: 0, paid: 0, balance: 0 });
}

async function loadFilteredTotals() {
  const params = filterParams(false);

  // Solicita o maior lote possível. Se a API limitar o tamanho,
  // as páginas restantes serão carregadas logo abaixo.
  params.set('page', '1');
  params.set('pageSize', '500');
  params.set('orderBy', 'created_at');
  params.set('orderDirection', 'desc');

  const firstJson = await listAccounts(params);
  const apiTotals = responseTotals(firstJson);

  // Quando o backend já entrega agregados globais, não faz chamadas extras.
  if (apiTotals) {
    return apiTotals;
  }

  const firstItems = responseItems(firstJson);
  const totalRecords = Number(
    firstJson?.total ??
    firstJson?.totalCount ??
    firstJson?.count ??
    firstItems.length
  );

  const effectivePageSize = Math.max(
    1,
    Number(firstJson?.pageSize ?? firstJson?.page_size ?? firstItems.length ?? 1)
  );

  const totalPages = Number(
    firstJson?.totalPages ??
    firstJson?.total_pages ??
    Math.max(1, Math.ceil(totalRecords / effectivePageSize))
  );

  const allItems = [...firstItems];

  if (totalPages > 1) {
    const requests = [];

    for (let page = 2; page <= totalPages; page += 1) {
      const pageParams = new URLSearchParams(params);
      pageParams.set('page', String(page));
      pageParams.set('pageSize', String(effectivePageSize));
      requests.push(listAccounts(pageParams));
    }

    const remainingPages = await Promise.all(requests);

    remainingPages.forEach((json) => {
      allItems.push(...responseItems(json));
    });
  }

  const totals = sumItems(allItems);

  return totals;
}

export async function loadAccounts(options = {}) {
  const {
    page,
    orderBy,
    orderDirection,
  } = options;

  // Atualiza a página quando ela for informada
  if (Number.isInteger(Number(page)) && Number(page) > 0) {
    state.page = Number(page);
  }

  // Proteção no frontend: somente colunas autorizadas
  const allowedOrderColumns = [
    'id',
    'customer_id',
    'customer_name',
    'account_bank',
    'document_type_name',
    'invoice_number',
    'issue_date',
    'created_at',
    'due_date',
    'status',
    'total',
    'received',
    'balance',
  ];

  if (allowedOrderColumns.includes(orderBy)) {
    state.orderBy = orderBy;
  }

  // Aceita somente ASC ou DESC
  const normalizedDirection =
    String(orderDirection || '').toLowerCase();

  if (
    normalizedDirection === 'asc' ||
    normalizedDirection === 'desc'
  ) {
    state.orderDirection = normalizedDirection;
  }

  try {
    const json = await listAccounts(filterParams());

    const items = responseItems(json);

    const total = Number(
      json.total ??
      json.totalCount ??
      items.length
    );

    state.page = Number(
      json.page ?? state.page
    );

    state.pageSize = Number(
      json.pageSize ?? state.pageSize
    );

    state.totalPages = Number(
      json.totalPages ??
      Math.max(
        1,
        Math.ceil(total / state.pageSize)
      )
    );

    renderTable(items, {
      receive: openReceiveModal,
      boleto: openBoleto,
      cancelBoleto: cancelBoletoFromRow,
      edit: openEdit,
    });

    const totals = responseTotals(json) ?? await loadFilteredTotals();

    updateSummary(items, totals);
    updatePagination(total);
  } catch (error) {
    showCenterModal({
      type: 'error',
      title: 'Erro ao listar contas a receber',
      message:
        error.message ||
        'Falha na comunicação com a API.',
    });
  }
}

export function openBoleto(row) {
  const id = row?.dataset.id;
  if (!id) return showCenterModal({ type: 'error', title: 'Conta não identificada', message: 'ID da conta não localizado na linha.' });
  window.open(boletoUrl(id), '_blank', 'noopener');
}

export async function cancelBoletoFromRow(row, button) {
  const id = row?.dataset.id;
  if (!id) return showCenterModal({ type: 'error', title: 'Conta não identificada', message: 'ID da conta não localizado na linha.' });
  if (!confirm('Confirmar CANCELAMENTO do boleto?\n\n✅ Isso cancela a cobrança no ASAAS e marca como CANCELLED no ERP.\n⚠️ Não é reversível no ASAAS.')) return;
  const oldText = button.textContent;
  try {
    button.disabled = true; button.textContent = 'Cancelando...';
    const result = await cancelBoleto(id);
    showCenterModal({ type: 'success', title: 'Boleto cancelado', message: result?.message || 'Cobrança cancelada no Asaas e atualizada no ERP.' });
    await loadAccounts();
  } catch (error) { showCenterModal({ type: 'error', title: 'Falha ao cancelar boleto', message: error.message || 'Erro ao comunicar com a API.' }); }
  finally { button.disabled = false; button.textContent = oldText; }
}

export async function syncWithAsaas() {
  if (!confirm('Deseja sincronizar as cobranças com o Asaas usando os filtros atuais?')) return;
  const button = $('#btnSyncAsaas');
  const oldText = button?.textContent;
  const payload = {};
  const from = $('#filterFromDue')?.value;
  const to = $('#filterToDue')?.value;
  const status = $('#filterStatus')?.value;
  const dateType = $('#filterDateType')?.value === 'issue_date' ? 'issue_date' : 'due_date';
  if (from) payload.from = from;
  if (to) payload.to = to;
  if (status) payload.status = status;
  payload.dateType = dateType;
  try {
    if (button) { button.disabled = true; button.textContent = 'Sincronizando...'; }
    const result = await syncAsaas(payload);
    showCenterModal({ type: 'success', title: 'Sincronização com Asaas', message: `Sincronização concluída. Registros sincronizados: ${result.synced ?? 0}.` });
    await loadAccounts();
  } catch (error) { showCenterModal({ type: 'error', title: 'Erro ao sincronizar com Asaas', message: error.message || 'Falha ao comunicar com a API do Asaas.' }); }
  finally { if (button) { button.disabled = false; button.textContent = oldText; } }
}

export function exportExcel() { window.open(excelUrl(filterParams(false)), '_blank'); }
export function exportPdf() { window.open(pdfUrl(filterParams(false)), '_blank'); }
