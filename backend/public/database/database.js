// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: backend/public/database/database.js                           ║
// ║ MODULE: Database Viewer / Editor                                    ║
// ╚══════════════════════════════════════════════════════════════════════╝

const API = '/api/database';

const state = {
    schema: 'public',
    tables: [],
    currentTable: null,
    columns: [],
    primaryKey: [],
    rows: [],
    page: 1,
    limit: 50,
    total: 0,
    search: '',
    editingRow: null,
};

const $ = (sel) => document.querySelector(sel);

const els = {
    tablesList: $('#tablesList'),
    tableSearch: $('#tableSearch'),
    rowSearch: $('#rowSearch'),
    limitSelect: $('#limitSelect'),
    currentTableTitle: $('#currentTableTitle'),
    currentTableSubtitle: $('#currentTableSubtitle'),
    totalRows: $('#totalRows'),
    pageInfo: $('#pageInfo'),
    primaryKeyInfo: $('#primaryKeyInfo'),
    tableHead: $('#tableHead'),
    tableBody: $('#tableBody'),
    btnReload: $('#btnReload'),
    btnNewRow: $('#btnNewRow'),
    btnPrev: $('#btnPrev'),
    btnNext: $('#btnNext'),
    paginationLabel: $('#paginationLabel'),
    rowModal: $('#rowModal'),
    modalBackdrop: $('#modalBackdrop'),
    modalTitle: $('#modalTitle'),
    modalFields: $('#modalFields'),
    btnCloseModal: $('#btnCloseModal'),
    btnCancelModal: $('#btnCancelModal'),
    btnSaveRow: $('#btnSaveRow'),
    btnDeleteRow: $('#btnDeleteRow'),
};

async function apiGet(url) {
    const res = await fetch(url);
    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.success === false) {
        throw new Error(json.message || 'Erro na API.');
    }

    return json.data;
}

async function apiSend(url, method, body) {
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.success === false) {
        throw new Error(json.message || 'Erro na API.');
    }

    return json.data;
}

function showModal() {
    els.rowModal.classList.remove('hidden');
    els.rowModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    els.rowModal.classList.add('hidden');
    els.rowModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    state.editingRow = null;
}

function formatValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function getPkObject(row) {
    const out = {};

    for (const col of state.primaryKey) {
        out[col] = row[col];
    }

    return out;
}

async function loadTables() {
    els.tablesList.innerHTML = '<div class="empty">Carregando tabelas...</div>';

    try {
        state.tables = await apiGet(`${API}/tables?schema=${state.schema}`);
        renderTables();
    } catch (err) {
        els.tablesList.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
}

function renderTables() {
    const term = els.tableSearch.value.trim().toLowerCase();

    const filtered = state.tables.filter((t) =>
        String(t.table_name || '').toLowerCase().includes(term)
    );

    if (!filtered.length) {
        els.tablesList.innerHTML = '<div class="empty">Nenhuma tabela encontrada.</div>';
        return;
    }

    els.tablesList.innerHTML = filtered
        .map((t) => {
            const tableName = String(t.table_name || '');
            const active = state.currentTable === tableName ? 'active' : '';

            return `
                <button class="table-item ${active}" data-table="${escapeHtml(tableName)}">
                    ${escapeHtml(tableName)}
                </button>
            `;
        })
        .join('');

    els.tablesList.querySelectorAll('.table-item').forEach((btn) => {
        btn.addEventListener('click', () => selectTable(btn.dataset.table));
    });
}

async function selectTable(tableName) {
    closeModal();

    state.currentTable = tableName;
    state.page = 1;
    state.search = '';

    els.rowSearch.value = '';
    els.currentTableTitle.textContent = tableName;
    els.currentTableSubtitle.textContent = `Schema: ${state.schema}`;
    els.btnNewRow.disabled = false;

    renderTables();
    await loadRows();
}

async function loadRows() {
    if (!state.currentTable) return;

    els.tableBody.innerHTML = `
        <tr>
            <td class="empty">Carregando registros...</td>
        </tr>
    `;

    const params = new URLSearchParams({
        schema: state.schema,
        page: String(state.page),
        limit: String(state.limit),
        search: state.search,
    });

    try {
        const data = await apiGet(`${API}/tables/${state.currentTable}/rows?${params}`);

        state.columns = data.columns || [];
        state.primaryKey = data.primaryKey || [];
        state.rows = data.rows || [];
        state.total = Number(data.total || 0);
        state.page = Number(data.page || 1);
        state.limit = Number(data.limit || 50);

        renderMeta();
        renderTable();
    } catch (err) {
        els.tableBody.innerHTML = `
            <tr>
                <td class="empty">${escapeHtml(err.message)}</td>
            </tr>
        `;
    }
}

function renderMeta() {
    els.totalRows.textContent = state.total;
    els.pageInfo.textContent = state.page;
    els.primaryKeyInfo.textContent = state.primaryKey.length
        ? state.primaryKey.join(', ')
        : 'Sem PK';

    els.paginationLabel.textContent = `Página ${state.page}`;
}

function renderTable() {
    if (!state.columns.length) {
        els.tableHead.innerHTML = '';
        els.tableBody.innerHTML = `
            <tr>
                <td class="empty">Nenhuma coluna encontrada.</td>
            </tr>
        `;
        return;
    }

    els.tableHead.innerHTML = `
        <tr>
            <th>Ações</th>
            ${state.columns.map((c) => `<th>${escapeHtml(c.column_name)}</th>`).join('')}
        </tr>
    `;

    if (!state.rows.length) {
        els.tableBody.innerHTML = `
            <tr>
                <td class="empty" colspan="${state.columns.length + 1}">
                    Nenhum registro encontrado.
                </td>
            </tr>
        `;
        return;
    }

    els.tableBody.innerHTML = state.rows
        .map((row, index) => {
            return `
                <tr>
                    <td>
                        <div class="row-actions">
                            <button class="btn-mini" data-edit="${index}">Editar</button>
                        </div>
                    </td>

                    ${state.columns
                        .map((c) => {
                            const value = formatValue(row[c.column_name]);
                            return `<td title="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
                        })
                        .join('')}
                </tr>
            `;
        })
        .join('');

    els.tableBody.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const row = state.rows[Number(btn.dataset.edit)];
            openEditModal(row);
        });
    });
}

function openNewModal() {
    if (!state.currentTable) return;

    state.editingRow = null;

    els.modalTitle.textContent = `Novo registro em ${state.currentTable}`;
    els.btnDeleteRow.classList.add('hidden');

    renderModalFields({});
    showModal();
}

function openEditModal(row) {
    if (!row) return;

    state.editingRow = row;

    els.modalTitle.textContent = `Editar registro em ${state.currentTable}`;
    els.btnDeleteRow.classList.remove('hidden');

    renderModalFields(row);
    showModal();
}

function renderModalFields(row) {
    els.modalFields.innerHTML = state.columns
        .map((col) => {
            const name = col.column_name;
            const value = formatValue(row[name]);
            const isPk = state.primaryKey.includes(name);
            const typeInfo = `${col.data_type}${isPk ? ' | PK' : ''}`;

            const input = col.data_type === 'text'
                ? `<textarea data-field="${escapeHtml(name)}" ${isPk ? 'readonly' : ''}>${escapeHtml(value)}</textarea>`
                : `<input data-field="${escapeHtml(name)}" value="${escapeHtml(value)}" ${isPk ? 'readonly' : ''} />`;

            return `
                <div class="field">
                    <label>${escapeHtml(name)}</label>
                    ${input}
                    <small>${escapeHtml(typeInfo)}</small>
                </div>
            `;
        })
        .join('');
}

function collectModalData() {
    const data = {};

    els.modalFields.querySelectorAll('[data-field]').forEach((input) => {
        const key = input.dataset.field;
        let value = input.value;

        if (value === '') value = null;

        data[key] = value;
    });

    return data;
}

async function saveRow() {
    if (!state.currentTable) return;

    const data = collectModalData();

    try {
        if (state.editingRow) {
            await apiSend(`${API}/tables/${state.currentTable}/rows?schema=${state.schema}`, 'PUT', {
                pk: getPkObject(state.editingRow),
                data,
            });
        } else {
            await apiSend(`${API}/tables/${state.currentTable}/rows?schema=${state.schema}`, 'POST', {
                data,
            });
        }

        closeModal();
        await loadRows();
    } catch (err) {
        alert(err.message);
    }
}

async function removeRow() {
    if (!state.editingRow) return;

    const confirmDelete = confirm('Tem certeza que deseja excluir este registro?');

    if (!confirmDelete) return;

    try {
        await apiSend(`${API}/tables/${state.currentTable}/rows?schema=${state.schema}`, 'DELETE', {
            pk: getPkObject(state.editingRow),
        });

        closeModal();
        await loadRows();
    } catch (err) {
        alert(err.message);
    }
}

function setupEvents() {
    closeModal();

    els.tableSearch.addEventListener('input', renderTables);

    els.rowSearch.addEventListener('input', () => {
        clearTimeout(window.__dbSearchTimer);

        window.__dbSearchTimer = setTimeout(async () => {
            state.search = els.rowSearch.value.trim();
            state.page = 1;
            await loadRows();
        }, 350);
    });

    els.limitSelect.addEventListener('change', async () => {
        state.limit = Number(els.limitSelect.value || 50);
        state.page = 1;
        await loadRows();
    });

    els.btnReload.addEventListener('click', async () => {
        await loadTables();

        if (state.currentTable) {
            await loadRows();
        }
    });

    els.btnNewRow.addEventListener('click', openNewModal);

    els.btnPrev.addEventListener('click', async () => {
        if (state.page <= 1) return;

        state.page -= 1;
        await loadRows();
    });

    els.btnNext.addEventListener('click', async () => {
        const maxPage = Math.ceil(state.total / state.limit);

        if (state.page >= maxPage) return;

        state.page += 1;
        await loadRows();
    });

    els.btnCloseModal.addEventListener('click', closeModal);
    els.btnCancelModal.addEventListener('click', closeModal);
    els.modalBackdrop.addEventListener('click', closeModal);
    els.btnSaveRow.addEventListener('click', saveRow);
    els.btnDeleteRow.addEventListener('click', removeRow);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeModal();
        }
    });
}

async function init() {
    setupEvents();
    await loadTables();
}

init();