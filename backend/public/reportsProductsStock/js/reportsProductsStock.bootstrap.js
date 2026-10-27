    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║ reportsProductsStock.bootstrap.js — Bootstrap                       ║
    // ╚══════════════════════════════════════════════════════════════════════╝

    'use strict';

    import { getEls } from './reportsProductsStock.dom.js';
    import { state } from './reportsProductsStock.state.js';
    import { loadRows, downloadPdf, downloadExcel } from './reportsProductsStock.api.js';
    import { loadGroups, loadBrands } from './reportsProductsStock.lookups.js';
    import { bindFilters } from './reportsProductsStock.filters.js';
    import { bindFiltersModal } from './reportsProductsStock.filtersModal.js';
    import { mapRow, renderTable } from './reportsProductsStock.table.js';
    import { createSortableTable } from '/public/includes/js/sortableTable.js';
    import { renderPagination, setFooter, bindPagination } from './reportsProductsStock.pagination.js';
    import { setSummary } from './reportsProductsStock.summary.js';
    import { sanitize } from './reportsProductsStock.utils.js';

    // Ordenação pelos cabeçalhos (feita no backend → vale para a lista inteira).
    // A coluna/direção fica em state.order no formato "<coluna>_<asc|desc>".
    let sortable = null;

    function parseOrder(order) {
    const m = /^(.+)_(asc|desc)$/.exec(String(order || ''));
    return m ? { column: m[1], direction: m[2] } : { column: 'description', direction: 'asc' };
    }

    function syncSortHeader() {
    if (!sortable) return;
    const { column, direction } = parseOrder(state.order);
    const cur = sortable.getState();
    if (cur.column === column && cur.direction === direction) return;
    sortable.setSort(column, direction, { notify: false }).catch(() => {});
    }

    function bindSortableHeaders() {
    const { column, direction } = parseOrder(state.order);

    sortable = createSortableTable({
        table: '#stockTable',
        defaultColumn: column,
        defaultDirection: direction,
        async onSort({ column: col, direction: dir }) {
        state.order = `${col}_${dir}`;
        state.page = 1;
        await load();
        },
    });
    }

    function setStatus(msg, type = 'info') {
    const els = getEls();
    if (!els.statusArea) return;
    els.statusArea.textContent = msg || '';
    els.statusArea.dataset.type = type;
    }

async function load() {
  if (state.loading) state.aborter?.abort?.();
  const aborter = new AbortController();
  state.aborter = aborter;
  state.loading = true;

  try {

    syncSortHeader();
    setStatus('Carregando...', 'info');
    setFooter({ total: null, page: null, pages: null });

    const api = await loadRows();
    const mapped = api.rows.map(mapRow);

    // O backend já devolve a página ordenada (state.order).
    const sorted = mapped;

    renderTable(sorted);

    renderPagination({ total: api.total, page: api.page, limit: api.limit });

    // Custo total do rodapé: soma de TODOS os registros filtrados (não só a página).
    const pageSumCost = sorted.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    const sumCost = Number(api?.summary?.sum_cost);
    setSummary({ sum_cost: Number.isFinite(sumCost) ? sumCost : pageSumCost });

    setStatus(`${api.total} item(ns) carregado(s).`, 'success');
  } catch (err) {
    if (err?.name === 'AbortError') return;
    console.error('[reportsProductsStock] load error:', err);
    setStatus(`Erro: ${err.message || err}`, 'error');
    setFooter({ total: null, page: null, pages: null });
    setSummary(null);
  } finally {
    if (state.aborter === aborter) state.loading = false;
  }
}

    async function bootstrapLookups() {
    const els = getEls();

    try {
        const groups = await loadGroups();
        if (els.selGrupo) {
        els.selGrupo.innerHTML =
            '<option value="">Todos</option>' +
            groups.map(g => `<option value="${sanitize(g.id)}">${sanitize(g.name)}</option>`).join('');
        }
    } catch (e) {
        console.warn('[groups] falhou:', e);
    }

    try {
        const brands = await loadBrands();
        if (els.selMarca) {
        els.selMarca.innerHTML =
            '<option value="">Todas</option>' +
            brands.map(b => `<option value="${sanitize(b.id)}">${sanitize(b.name)}</option>`).join('');
        }
    } catch (e) {
        console.warn('[brands] falhou:', e);
    }
    }

    function bindExports() {
    const els = getEls();

    els.btnPdf?.addEventListener('click', async () => {
        try {
        setStatus('Gerando PDF...', 'info');
        const blob = await downloadPdf();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `posicao_estoque_${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setStatus('PDF gerado com sucesso.', 'success');
        } catch (err) {
        setStatus(`Falha ao gerar PDF: ${err.message || err}`, 'error');
        }
    });

    els.btnExcel?.addEventListener('click', async () => {
        try {
        setStatus('Gerando Excel...', 'info');
        const blob = await downloadExcel();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `posicao_estoque_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setStatus('Excel exportado com sucesso.', 'success');
        } catch (err) {
        setStatus(`Falha ao exportar Excel: ${err.message || err}`, 'error');
        }
    });
    }

    export async function bootstrapReportsProductsStock() {
    bindFilters(load);
    bindFiltersModal(load);
    bindPagination(load);
    bindSortableHeaders();
    bindExports();
    await bootstrapLookups();
    await load();
    }